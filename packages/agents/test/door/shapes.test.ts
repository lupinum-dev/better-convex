import { can, type Policy } from '@lupinum/better-convex-functions'
import { expect, test } from 'vitest'

import { policy } from './fns'
import { fn, setup } from './setup'

// App shapes the presets must express, and the policy edge cases. Each test
// names the STRESS.md row whose break it keeps fixed.

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
  ['anyOf(owner, tenant)', 'k6:read', 'k6:edit'],
  ['custom with ctx.allows', 'k6:readCustom', 'k6:editCustom'],
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
test.each(['k6:read', 'k6:readCustom'])(
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
  expect(await ann.query(fn('k3:clients'), { agencyId: agency })).toEqual(['Client'])
  expect(await ann.query(fn('k3:projectsOfClient'), { clientId: client })).toEqual(['Client site'])
  expect(
    await ann.query(fn('k3:projectsOfAgencyClient'), { agencyId: agency, clientId: client }),
  ).toEqual(['Client site'])
  expect(await vic.query(fn('k3:projectsOfClient'), { clientId: client })).toEqual(['Client site'])
  await expect(vic.query(fn('k3:clients'), { agencyId: agency })).rejects.toThrow(/NOT_FOUND/)
  await expect(bob.query(fn('k3:projectsOfClient'), { clientId: client })).rejects.toThrow(
    /NOT_FOUND/,
  )
})

test('K3: a client is created only under an agency where the role allows it', async () => {
  const { ann, agency, other } = await withAgency()
  await ann.mutation(fn('k3:createClient'), { agencyId: agency, name: 'New client' })
  await expect(
    ann.mutation(fn('k3:createClient'), { agencyId: agency, name: 'Planted', under: other }),
  ).rejects.toThrow(/NOT_FOUND/)
})

async function withWorkspace() {
  const s = await setup()
  const ids = await s.t.run(async (ctx) => {
    const ws = await ctx.db.insert('workspaces', { ownerId: s.users.ann, name: 'Ann personal' })
    const doc = await ctx.db.insert('docs', { workspaceId: ws, text: 'Ann idea' })
    return { ws, doc }
  })
  return { ...s, ...ids }
}

// K2: two tenant kinds through one roleOf; a call spanning them was impossible.
test('K2: a move between a workspace and an organization needs crossTenant, and a role in both', async () => {
  const { t, ann, vic, doc, a } = await withWorkspace()
  await expect(ann.mutation(fn('k2:moveToOrg'), { docId: doc, orgId: a })).rejects.toThrow(
    /different places/,
  )
  await expect(vic.mutation(fn('k2:moveToOrgAcross'), { docId: doc, orgId: a })).rejects.toThrow(
    /NOT_FOUND/,
  )
  await ann.mutation(fn('k2:moveToOrgAcross'), { docId: doc, orgId: a })
  expect(await t.run((ctx) => ctx.db.get(doc))).toBeNull()
})

// K1: a role named like a prototype key threw a TypeError instead of denying.
test.each(['superuser', 'toString', 'constructor', '__proto__'])(
  'K1: the unknown role %j is denied',
  async (role) => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      const id = await ctx.db.insert('users', { authId: role, name: role })
      await ctx.db.insert('memberships', { orgId: s.a, userId: id, role })
    })
    await expect(
      s.t
        .withIdentity({ subject: role })
        .query(fn('projects:page'), { orgId: s.a, paginationOpts: { numItems: 1, cursor: null } }),
    ).rejects.toThrow(/FORBIDDEN/)
    expect(can(policy, 'projects.search', role as never)).toBe(false)
  },
)

// E13: three-part prefixes match; the type accepts them too (stress/types/probes/E13-patterns.ts).
test('E13: a two-segment prefix matches only its own actions', () => {
  const billing = { ...policy, roles: { accountant: ['billing.invoices.*'] } } as unknown as Policy
  expect(can(billing, 'billing.invoices.create', 'accountant')).toBe(true)
  expect(can(billing, 'billing.plans.read', 'accountant')).toBe(false)
})

// E10: returning a whole document needed a hand-built validator.
test('E10: docValidator accepts the document as stored', async () => {
  const { ann, pa } = await setup()
  expect(await ann.query(fn('projects:one'), { projectId: pa })).toMatchObject({
    _id: pa,
    name: 'A one',
  })
})

// E15: library failures carry codes the UI can switch on.
test('E15: the web client sees coded failures', async () => {
  const { t, ann, vic, b, pa } = await setup()
  const codeOf = (promise: Promise<unknown>) =>
    promise.then(
      () => 'no error',
      (error) => (error as { data?: { code?: string } }).data?.code ?? 'uncoded',
    )
  const page = { paginationOpts: { numItems: 1, cursor: null } }
  expect({
    signedOut: await codeOf(t.query(fn('projects:page'), { orgId: b, ...page })),
    foreignTenant: await codeOf(ann.query(fn('projects:page'), { orgId: b, ...page })),
    roleTooLow: await codeOf(vic.mutation(fn('projects:archive'), { projectId: pa })),
    unknownApproval: await codeOf(ann.mutation(fn('agents:approve'), { approvalId: 'nope' })),
  }).toEqual({
    signedOut: 'NOT_SIGNED_IN',
    foreignTenant: 'NOT_FOUND',
    roleTooLow: 'FORBIDDEN',
    unknownApproval: 'APPROVAL_NOT_FOUND',
  })
})
