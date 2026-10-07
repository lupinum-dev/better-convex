import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { expect, test } from 'vitest'

import schema from './shapes/schema'

// App shapes the rule presets must express, and the role edge cases. Each module of the
// fixture is its own app. Each test names the STRESS.md row whose break it keeps fixed.

const modules = import.meta.glob(['./shapes/*.ts', './shapes/_generated/*.ts'])
const fn = (path: string) => makeFunctionReference<any>(path)

/** Ann owns org A, Vic views A, Bob owns B. A has one project. */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const [ann, vic, bob] = await Promise.all(
      ['ann', 'vic', 'bob'].map((authId) => ctx.db.insert('users', { authId })),
    )
    const a = await ctx.db.insert('orgs', { name: 'A' })
    const b = await ctx.db.insert('orgs', { name: 'B' })
    await ctx.db.insert('memberships', { orgId: a, userId: ann!, role: 'owner' })
    await ctx.db.insert('memberships', { orgId: a, userId: vic!, role: 'viewer' })
    await ctx.db.insert('memberships', { orgId: b, userId: bob!, role: 'owner' })
    const pa = await ctx.db.insert('projects', { orgId: a, name: 'A one' })
    return { users: { ann: ann!, vic: vic!, bob: bob! }, a, b, pa }
  })
  const as = (authId: string) => t.withIdentity({ subject: authId })
  return { t, ...ids, ann: as('ann'), vic: as('vic'), bob: as('bob') }
}

async function withNotes() {
  const s = await setup()
  const ids = await s.t.run(async (ctx) => ({
    privateNote: await ctx.db.insert('notes', { authorId: s.users.ann, text: 'Ann only' }),
    sharedNote: await ctx.db.insert('notes', {
      authorId: s.users.ann,
      orgId: s.a,
      text: 'For org A',
    }),
  }))
  return { ...s, ...ids }
}

// K6: a viewer edited a shared note: the custom rule could not see the action, and the call skipped the role layer.
test.each([
  ['anyOf(owner, tenant)', 'notes:read', 'notes:edit'],
  ['custom with ctx.allows', 'notes:readCustom', 'notes:editCustom'],
])('K6 %s: author or member reads; only a role that allows it edits', async (_, read, edit) => {
  const { t, ann, vic, bob, privateNote, sharedNote } = await withNotes()
  // Not visible: `null`, or NOT_FOUND when the note's ID names an organization the actor is not in.
  const hidden = (promise: Promise<unknown>) =>
    promise.then(
      (value) => value,
      (error) => (/NOT_FOUND/.test(String(error)) ? null : error),
    )
  expect(await ann.query(fn(read), { noteId: privateNote })).toBe('Ann only')
  expect(await vic.query(fn(read), { noteId: sharedNote })).toBe('For org A')
  expect(await hidden(vic.query(fn(read), { noteId: privateNote }))).toBeNull()
  expect(await hidden(bob.query(fn(read), { noteId: sharedNote }))).toBeNull()
  // Refused: FORBIDDEN through the role layer, or NOT_FOUND from a custom rule that says no.
  await expect(
    vic.mutation(fn(edit), { noteId: sharedNote, text: 'Overwritten by a viewer' }),
  ).rejects.toThrow(/FORBIDDEN|NOT_FOUND/)
  await ann.mutation(fn(edit), { noteId: sharedNote, text: 'Edited by the owner' })
  expect((await t.run((ctx) => ctx.db.get(sharedNote)))?.text).toBe('Edited by the owner')
})

// Codex review: the author of a note shared with an organization she is not in got NOT_FOUND.
test.each(['notes:read', 'notes:readCustom'])(
  'K6 %s: the author reads her own note in an organization she is not in',
  async (read) => {
    const s = await setup()
    const note = await s.t.run((ctx) =>
      ctx.db.insert('notes', { authorId: s.users.ann, orgId: s.b, text: 'Shared with B' }),
    )
    expect(await s.ann.query(fn(read), { noteId: note })).toBe('Shared with B')
  },
)

async function withAgency() {
  const s = await setup()
  const ids = await s.t.run(async (ctx) => {
    const agency = await ctx.db.insert('agencies', { name: 'Agency' })
    const other = await ctx.db.insert('agencies', { name: 'Other' })
    await ctx.db.insert('agencyMembers', { agencyId: agency, userId: s.users.ann, role: 'owner' })
    await ctx.db.insert('agencyMembers', { agencyId: other, userId: s.users.bob, role: 'owner' })
    const client = await ctx.db.insert('clients', { agencyId: agency, name: 'Client' })
    // Vic is a contact of the client only.
    await ctx.db.insert('clientContacts', {
      clientId: client,
      userId: s.users.vic,
      role: 'contact',
    })
    await ctx.db.insert('clientProjects', { clientId: client, name: 'Client site' })
    return { agency, other, client }
  })
  return { ...s, ...ids }
}

// K3: agency -> client -> project could not be expressed; a client ID made the agency the call's tenant.
test('K3: nested tenants: the agency reaches its clients and their projects; a client contact only theirs', async () => {
  const { ann, vic, bob, agency, client } = await withAgency()
  expect(await ann.query(fn('agencies:clients'), { agencyId: agency })).toEqual(['Client'])
  expect(await ann.query(fn('agencies:projectsOfClient'), { clientId: client })).toEqual([
    'Client site',
  ])
  expect(
    await ann.query(fn('agencies:projectsOfAgencyClient'), { agencyId: agency, clientId: client }),
  ).toEqual(['Client site'])
  expect(await vic.query(fn('agencies:projectsOfClient'), { clientId: client })).toEqual([
    'Client site',
  ])
  await expect(vic.query(fn('agencies:clients'), { agencyId: agency })).rejects.toThrow(/NOT_FOUND/)
  await expect(bob.query(fn('agencies:projectsOfClient'), { clientId: client })).rejects.toThrow(
    /NOT_FOUND/,
  )
})

test('K3: a client is created only under the agency the call names, where the role allows it', async () => {
  const { t, ann, agency, other, users } = await withAgency()
  const plant = () =>
    ann.mutation(fn('agencies:createClient'), { agencyId: agency, name: 'Planted', under: other })
  await ann.mutation(fn('agencies:createClient'), { agencyId: agency, name: 'New client' })
  await expect(plant()).rejects.toThrow(/NOT_FOUND/)
  // An owner of both agencies still cannot plant under the one the call does not name.
  await t.run((ctx) =>
    ctx.db.insert('agencyMembers', { agencyId: other, userId: users.ann, role: 'owner' }),
  )
  await expect(plant()).rejects.toThrow(/NOT_FOUND/)
})

// Round 1 review: a patch checked only the role in the client, so its owner moved it under a foreign agency.
test('K3: a client moves only under an agency inside the call, where the role allows it', async () => {
  const { t, ann, bob, client, agency, other } = await withAgency()
  await expect(
    ann.mutation(fn('agencies:moveClient'), { clientId: client, to: other }),
  ).rejects.toThrow(/NOT_FOUND/)
  expect(await t.run((ctx) => ctx.db.get(client))).toMatchObject({ agencyId: agency })
  await expect(bob.query(fn('agencies:projectsOfClient'), { clientId: client })).rejects.toThrow(
    /NOT_FOUND/,
  )
})

// Round 1 review: tenant() on a field of a non-tenant table hid every row, and inserts said NOT_FOUND.
test('a tenant rule on a field that holds no tenant ID says so at the first row', async () => {
  const { ann } = await setup()
  await expect(ann.mutation(fn('misnamed:create'), { text: 'Hi' })).rejects.toThrow(
    "notes.authorId holds a users ID, but users is not a tenant (no tenant('_id') rule).",
  )
})

// Round 1 review: creating a tenant whose rule has no createdBy failed with a role message.
test('creating a tenant whose rule names no createdBy says so', async () => {
  const { ann } = await withAgency()
  await expect(ann.mutation(fn('agencies:createAgency'), { name: 'New' })).rejects.toThrow(
    "No action may create agencies rows: their tenant('_id') rule has no createdBy.",
  )
})

// K2: two tenant kinds through one roleOf; a call spanning them was impossible.
test('K2: a move between a workspace and an organization needs crossTenant, and a role in both that allows it', async () => {
  const { t, ann, vic, a, users } = await setup()
  const doc = await t.run(async (ctx) => {
    const ws = await ctx.db.insert('workspaces', { ownerId: users.ann, name: 'Ann personal' })
    return await ctx.db.insert('docs', { workspaceId: ws, text: 'Ann idea' })
  })
  await expect(ann.mutation(fn('workspaces:moveToOrg'), { docId: doc, orgId: a })).rejects.toThrow(
    /different places/,
  )
  await expect(
    vic.mutation(fn('workspaces:moveToOrgAcross'), { docId: doc, orgId: a }),
  ).rejects.toThrow(/NOT_FOUND/)
  await ann.mutation(fn('workspaces:moveToOrgAcross'), { docId: doc, orgId: a })
  expect(await t.run((ctx) => ctx.db.get(doc))).toBeNull()
  // V14: a role in both is not enough; it must allow the action in both, even where no row changes.
  const vicDoc = await t.run(async (ctx) => {
    const ws = await ctx.db.insert('workspaces', { ownerId: users.vic, name: 'Vic personal' })
    return await ctx.db.insert('docs', { workspaceId: ws, text: 'Vic idea' })
  })
  await expect(
    vic.mutation(fn('workspaces:noteOrgAcross'), { docId: vicDoc, orgId: a }),
  ).rejects.toThrow(/FORBIDDEN/)
  expect(await t.run((ctx) => ctx.db.get(vicDoc))).toMatchObject({ text: 'Vic idea' })
})

// K1: a role named like a prototype key threw a TypeError instead of denying.
test.each(['superuser', 'toString', 'constructor', '__proto__'])(
  'K1: the unknown role %j is denied',
  async (role) => {
    const { t, a, pa } = await setup()
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('users', { authId: role })
      await ctx.db.insert('memberships', { orgId: a, userId: id, role })
    })
    await expect(
      t.withIdentity({ subject: role }).query(fn('workspaces:project'), { projectId: pa }),
    ).rejects.toThrow(/FORBIDDEN/)
  },
)

// E10: returning a whole document needed a hand-built validator.
test('E10: docValidator accepts the document as stored', async () => {
  const { ann, pa } = await setup()
  expect(await ann.query(fn('workspaces:project'), { projectId: pa })).toMatchObject({
    _id: pa,
    name: 'A one',
  })
})
