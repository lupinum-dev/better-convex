import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { expect, test, vi } from 'vitest'

import schema from './rules/schema'

const modules = import.meta.glob(['./rules/*.ts', './rules/_generated/*.ts'])
const fn = (name: string) => makeFunctionReference<any>(`ops:${name}`)

/** Two orgs. Ann owns A, Vic only views A, Bob owns B. */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const [ann, vic, bob] = await Promise.all(
      ['ann', 'vic', 'bob'].map((authId) => ctx.db.insert('users', { authId })),
    )
    const a = await ctx.db.insert('orgs', { name: 'A' })
    const b = await ctx.db.insert('orgs', { name: 'B' })
    const annA = await ctx.db.insert('memberships', { orgId: a, userId: ann!, role: 'owner' })
    await ctx.db.insert('memberships', { orgId: a, userId: vic!, role: 'viewer' })
    await ctx.db.insert('memberships', { orgId: b, userId: bob!, role: 'owner' })
    const pa = await ctx.db.insert('projects', { orgId: a, name: 'A secret', archived: false })
    const pb = await ctx.db.insert('projects', { orgId: b, name: 'B secret', archived: false })
    return { a, b, pa, pb, annA }
  })
  const as = (authId: string) => t.withIdentity({ subject: authId })
  return { t, ...ids, ann: as('ann'), vic: as('vic'), bob: as('bob') }
}

// Catches: a query without a tenant filter handing out other tenants' rows.
test('a query that returns a foreign row fails instead of leaking it', async () => {
  const { ann, a } = await setup()
  await expect(ann.query(fn('allProjects'), {})).rejects.toThrow(/may not read/)
  expect(await ann.query(fn('orgProjects'), { orgId: a })).toEqual(['A secret'])
})

// Catches: a lookup by an ID the argument check never saw.
test('a get of a foreign row returns null', async () => {
  const { ann, pa, pb } = await setup()
  expect(await ann.query(fn('projectName'), { id: pb })).toBeNull()
  expect(await ann.query(fn('projectName'), { id: pa })).toBe('A secret')
})

// Catches: writes outside the actor's tenants, and writes the role does not allow.
test('writes check the row tenant and the role there', async () => {
  const { t, ann, vic, pa, pb, b } = await setup()
  await expect(ann.mutation(fn('archiveByString'), { id: pb })).rejects.toThrow(/NOT_FOUND/)
  await expect(vic.mutation(fn('archiveByString'), { id: pa })).rejects.toThrow(/FORBIDDEN/)
  await expect(ann.mutation(fn('createInOrg'), { orgId: b })).rejects.toThrow(/NOT_FOUND/)
  // V14: the row after a patch is checked too, so a row cannot be moved into a foreign tenant.
  await expect(ann.mutation(fn('moveByString'), { id: pa, orgId: b })).rejects.toThrow(/NOT_FOUND/)
  await ann.mutation(fn('archiveByString'), { id: pa })
  const rows = await t.run((ctx) => ctx.db.query('projects').collect())
  expect(rows.map((p) => [p.name, p.archived])).toEqual([
    ['A secret', true],
    ['B secret', false],
  ])
})

// Catches: the owner rule letting one person read another's rows.
test('owner rows of other people fail the query', async () => {
  const { ann } = await setup()
  await expect(ann.query(fn('allMemberships'), {})).rejects.toThrow(/may not read/)
})

// Catches: an operation reaching rows through the app's own functions, which run without rules.
test("operations cannot call or schedule the app's raw functions", async () => {
  const { t, ann, pb } = await setup()
  await expect(ann.mutation(fn('nested'), { id: pb, how: 'call' })).rejects.toThrow(
    /ops:rawRead is not an internal operation/,
  )
  vi.useFakeTimers()
  await ann.mutation(fn('nested'), { id: pb, how: 'schedule' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  vi.useRealTimers()
  const [job] = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
  expect(job!.state.kind).toBe('failed')
})

// Catches: scheduled-function arguments of every user readable through db.system.
test('system tables are closed to operations', async () => {
  const { ann } = await setup()
  await expect(ann.query(fn('scheduled'), {})).rejects.toThrow(/System tables/)
})

// Catches: an agent learning that a foreign ID exists from a different error.
test('a foreign ID next to an own one answers like a missing ID', async () => {
  const { t, ann, a, pb } = await setup()
  const gone = await t.run(async (ctx) => {
    const id = await ctx.db.insert('projects', { orgId: a, name: 'gone', archived: false })
    await ctx.db.delete(id)
    return id
  })
  await expect(ann.query(fn('pair'), { orgId: a, projectId: pb })).rejects.toThrow(/NOT_FOUND/)
  await expect(ann.query(fn('pair'), { orgId: a, projectId: gone })).rejects.toThrow(/NOT_FOUND/)
})

// V1, S17: a state condition only in handlers fails open for the first operation that forgets it.
test('every part of an allOf rule holds, even for an operation without its own check', async () => {
  const { t, ann, pa, pb } = await setup()
  await ann.mutation(fn('renameProject'), { projectId: pa, name: 'Renamed' })
  await ann.mutation(fn('archiveByString'), { id: pa })
  await expect(ann.mutation(fn('renameProject'), { projectId: pa, name: 'Late' })).rejects.toThrow(
    /FORBIDDEN/,
  )
  await expect(ann.mutation(fn('renameProject'), { projectId: pb, name: 'Pwned' })).rejects.toThrow(
    /NOT_FOUND/,
  )
  const rows = await t.run((ctx) => ctx.db.query('projects').collect())
  expect(rows.map((p) => [p.name, p.archived])).toEqual([
    ['Renamed', true],
    ['B secret', false],
  ])
})

// E15: library failures carry codes the UI can switch on.
test('the web client sees coded failures', async () => {
  const { t, ann, vic, b, pa } = await setup()
  const codeOf = (promise: Promise<unknown>) =>
    promise.then(
      () => 'no error',
      (error) => (error as { data?: { code?: string } }).data?.code ?? 'uncoded',
    )
  expect({
    signedOut: await codeOf(t.query(fn('orgProjects'), { orgId: b })),
    foreignTenant: await codeOf(ann.query(fn('orgProjects'), { orgId: b })),
    roleTooLow: await codeOf(vic.mutation(fn('archiveByString'), { id: pa })),
  }).toEqual({
    signedOut: 'NOT_SIGNED_IN',
    foreignTenant: 'NOT_FOUND',
    roleTooLow: 'FORBIDDEN',
  })
})

// Catches: a table-qualified get applying another table's (looser) rule.
test('a table-qualified get only finds rows of that table', async () => {
  const { ann, pb } = await setup()
  expect(await ann.query(fn('wrongTable'), { id: pb })).toBeNull()
})

// A7, S3: every way of reading a query checks the rows it hands out (next() once skipped the check;
// unique() handed out a single foreign row, and Convex's own unique() error lists foreign IDs).
test.each(['take', 'first', 'unique', 'paginate', 'search', 'forAwait', 'next'])(
  'reading a query with %s checks the rows',
  async (how) => {
    const { ann } = await setup()
    await expect(ann.query(fn('readVia'), { how })).rejects.toThrow(/may not read/)
  },
)

// Catches: any operation creating a new tenant.
test('only the named action creates a tenant', async () => {
  const { vic } = await setup()
  await expect(vic.mutation(fn('plantOrg'), {})).rejects.toThrow(/FORBIDDEN/)
})

// Catches: a role kept from before a write that changed it.
test('a membership change applies to the rest of the mutation', async () => {
  const { t, ann, pa, annA } = await setup()
  await expect(
    ann.mutation(fn('demoteThenArchive'), { projectId: pa, membershipId: annA }),
  ).rejects.toThrow(/FORBIDDEN/)
  expect(((await t.run((ctx) => ctx.db.get(pa))) as { archived: boolean }).archived).toBe(false)
})

// Rules v2: a query method the library does not check must not hand out rows.
test('a query method the library does not know fails instead of passing rows through', async () => {
  const { ann, a } = await setup()
  await expect(ann.query(fn('unknownMethod'), { orgId: a })).rejects.toThrow(/do not support count/)
})

async function withPages() {
  const s = await setup()
  await s.t.run(async (ctx) => {
    await ctx.db.insert('pages', { orgId: s.a, title: 'Home', published: true })
    await ctx.db.insert('pages', { orgId: s.a, title: 'Draft', published: false })
  })
  return s
}

// K4 / W5: signed-out visitors could call nothing.
test('a visitor reads published pages; drafts and edits need a member', async () => {
  const { t, ann, bob, a } = await withPages()
  expect(await t.query(fn('publishedPages'), { orgId: a })).toEqual(['Home'])
  await expect(t.query(fn('allPages'), { orgId: a })).rejects.toThrow(/may not read/)
  expect(await ann.query(fn('allPages'), { orgId: a })).toEqual(['Home', 'Draft'])
  expect(await bob.query(fn('publishedPages'), { orgId: a })).toEqual(['Home'])
  // V14: an internal operation the public action reaches still needs a member.
  await expect(t.query(fn('peekVia'), {})).rejects.toThrow(/NOT_SIGNED_IN/)
  const home = await t.run(async (ctx) => (await ctx.db.query('pages').first())!._id)
  await expect(t.mutation(fn('editPage'), { pageId: home, title: 'Hacked' })).rejects.toThrow(
    /NOT_SIGNED_IN/,
  )
  await expect(bob.mutation(fn('editPage'), { pageId: home, title: 'Hacked' })).rejects.toThrow(
    /NOT_FOUND|FORBIDDEN/,
  )
})

// X3, X4 / W9: an operation could not call the outside world or schedule follow-ups that act for the person.
test.each(['now', 'later', 'action'] as const)(
  'an internal operation run %s acts as the caller, with the rules',
  async (how) => {
    vi.useFakeTimers()
    const { t, ann, vic, pa, pb } = await setup()
    await ann.mutation(fn('archiveVia'), { projectId: pa, how })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await t.run((ctx) => ctx.db.get(pa)))?.archived).toBe(true)
    // The same path as someone without the role: refused at the start…
    await expect(vic.mutation(fn('archiveVia'), { projectId: pa, how })).rejects.toThrow(
      /FORBIDDEN/,
    )
    // …and a foreign row stays out of reach.
    await expect(ann.mutation(fn('archiveVia'), { projectId: pb, how })).rejects.toThrow(
      /NOT_FOUND/,
    )
    vi.useRealTimers()
  },
)

// X4: a follow-up scheduled for later must stop when the person may no longer act.
test('a scheduled follow-up checks the actor again when it runs', async () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { t, ann, pa } = await setup()
  await ann.mutation(fn('archiveVia'), { projectId: pa, how: 'later' })
  await t.run(async (ctx) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', 'ann'))
      .unique()
    await ctx.db.patch(user!._id, { active: false })
  })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect((await t.run((ctx) => ctx.db.get(pa)))?.archived).toBe(false)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// A13: a suspended person was told "Sign in first." while signed in.
test('a suspended person is told the account cannot be used, not to sign in', async () => {
  const { t, ann, a } = await setup()
  await t.run(async (ctx) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', 'ann'))
      .unique()
    await ctx.db.patch(user!._id, { active: false })
  })
  await expect(ann.query(fn('orgProjects'), { orgId: a })).rejects.toThrow(/ACCOUNT_DISABLED/)
})

// D1: 5,000 IDs in one call ran into the platform's read limit mid-way.
test('a call with more IDs than the limit is refused before the handler runs', async () => {
  const { ann, pa } = await setup()
  expect(await ann.query(fn('many'), { ids: Array(1000).fill(pa) })).toBe(1000)
  await expect(ann.query(fn('many'), { ids: Array(1001).fill(pa) })).rejects.toThrow(/TOO_LARGE/)
})

// Codex review: a raw internal function without validators accepted the wrapped call and leaked rows.
test('a raw internal function without validators cannot hand rows to an operation', async () => {
  const { ann } = await setup()
  await expect(ann.query(fn('nestedAnyArgs'), {})).rejects.toThrow(
    /ops:rawAnyArgs is not an internal operation/,
  )
})

// Codex review: a nested mutation changed the caller's role, and the outer mutation kept the old one.
test('a membership change in a nested mutation applies to the rest of the call', async () => {
  const { t, ann, pa, annA } = await setup()
  await expect(
    ann.mutation(fn('demoteNestedThenArchive'), { projectId: pa, membershipId: annA }),
  ).rejects.toThrow(/FORBIDDEN/)
  expect(((await t.run((ctx) => ctx.db.get(pa))) as { archived: boolean }).archived).toBe(false)
})

// Second review: a raw mutation's write committed when the handler caught the envelope error.
test('a raw function reached from an operation keeps none of its writes, even if the handler catches', async () => {
  const { t, ann, pb } = await setup()
  await expect(ann.mutation(fn('swallowRaw'), { id: pb })).rejects.toThrow(
    /not an internal operation/,
  )
  expect(((await t.run((ctx) => ctx.db.get(pb))) as { archived: boolean }).archived).toBe(false)
})

// Third review: an internal action reached a raw mutation and reported success. An action cannot roll
// the write back (no transaction); it must fail loudly. Only the no-bypass test prevents the write.
test('an internal action that reached a raw function fails', async () => {
  vi.useFakeTimers()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { t, ann, pa } = await setup()
  await ann.mutation(fn('scheduleRawAction'), { id: pa })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const [job] = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
  expect(job!.state.kind).toBe('failed')
  expect(String(error.mock.calls.flat().join(' '))).toMatch(
    /Raw function reached from an internal action/,
  )
  vi.useRealTimers()
  vi.restoreAllMocks()
})
