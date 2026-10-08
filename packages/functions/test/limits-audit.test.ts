import { definePolicy, defineFunctions } from '@lupinum/better-convex-functions'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { people } from './app/people'
import schema from './rules/schema'

const modules = import.meta.glob(['./limits/*.ts', './limits/_generated/*.ts'])
const fn = (name: string) => makeFunctionReference<any>(`ops:${name}`)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** Org A: Ann and Cat own it, Vic views it. Org B: Bob. */
async function setup() {
  const t = convexTest({ schema, modules, transactionLimits: true })
  const ids = await t.run(async (ctx) => {
    const user = (authId: string) => ctx.db.insert('users', { authId })
    const [ann, cat, vic, bob] = [
      await user('ann'),
      await user('cat'),
      await user('vic'),
      await user('bob'),
    ]
    const a = await ctx.db.insert('orgs', { name: 'A' })
    const b = await ctx.db.insert('orgs', { name: 'B' })
    const member = (orgId: typeof a, userId: typeof ann, role: 'owner' | 'viewer') =>
      ctx.db.insert('memberships', { orgId, userId, role })
    await member(a, ann, 'owner')
    await member(a, cat, 'owner')
    await member(a, vic, 'viewer')
    await member(b, bob, 'owner')
    const pa = await ctx.db.insert('projects', { orgId: a, name: 'A one', archived: false })
    const pb = await ctx.db.insert('projects', { orgId: b, name: 'B one', archived: false })
    return { a, b, pa, pb, ann }
  })
  const as = (authId: string) => t.withIdentity({ subject: authId })
  const buckets = () => t.run((ctx) => ctx.db.query('rateLimits').collect())
  const audit = () => t.run((ctx) => ctx.db.query('auditLog').collect())
  return {
    t,
    ...ids,
    ann: as('ann'),
    cat: as('cat'),
    vic: as('vic'),
    bob: as('bob'),
    buckets,
    audit,
    userId: ids.ann,
  }
}

// Catches: a limited action that never refuses, or refuses without saying when to retry.
test('a call over the limit fails with RATE_LIMITED and the seconds to wait', async () => {
  const { ann, pa } = await setup()
  for (const name of ['1', '2', '3']) await ann.mutation(fn('rename'), { projectId: pa, name })
  await expect(ann.mutation(fn('rename'), { projectId: pa, name: '4' })).rejects.toThrow(
    /RATE_LIMITED.*Too many requests\. Try again in 20 seconds\./,
  )
})

// Catches: tokens that never come back, or come back all at once instead of continuously.
test('tokens refill over time', async () => {
  const { t, ann, pa } = await setup()
  const rename = (name: string) => ann.mutation(fn('rename'), { projectId: pa, name })
  for (const name of ['1', '2', '3']) await rename(name)
  vi.advanceTimersByTime(10_000)
  await expect(rename('early')).rejects.toThrow(/Try again in 10 seconds/)
  vi.advanceTimersByTime(10_000)
  await rename('after 20s')
  await expect(rename('again')).rejects.toThrow(/Try again in 20 seconds/)
  expect(await t.run((ctx) => ctx.db.get(pa))).toMatchObject({ name: 'after 20s' })
})

// Catches: one person's calls using up another person's, or a tenant's limit counted per person.
test('user, tenant and everyone limits keep separate buckets', async () => {
  const { ann, cat, bob, a, b, pa, pb } = await setup()
  // Per user: Ann's three renames leave Cat's and Bob's untouched.
  for (const name of ['1', '2', '3']) await ann.mutation(fn('rename'), { projectId: pa, name })
  await expect(ann.mutation(fn('rename'), { projectId: pa, name: '4' })).rejects.toThrow(
    /RATE_LIMITED/,
  )
  await cat.mutation(fn('rename'), { projectId: pa, name: 'cat' })
  await bob.mutation(fn('rename'), { projectId: pb, name: 'bob' })
  // Per tenant: Ann and Cat share org A's two reports; Bob has org B's own.
  await ann.mutation(fn('report'), { orgId: a })
  await cat.mutation(fn('report'), { orgId: a })
  await expect(ann.mutation(fn('report'), { orgId: a })).rejects.toThrow(/RATE_LIMITED/)
  await expect(cat.mutation(fn('report'), { orgId: a })).rejects.toThrow(/RATE_LIMITED/)
  await bob.mutation(fn('report'), { orgId: b })
  // Everyone: one bucket whoever calls.
  await ann.mutation(fn('contact'), {})
  await bob.mutation(fn('contact'), {})
  await expect(cat.mutation(fn('contact'), {})).rejects.toThrow(/RATE_LIMITED/)
})

// Catches: a visitor on a public action finding no key (a crash) or an unlimited path.
test('a visitor on a public action uses the everyone bucket', async () => {
  const { t, ann, buckets } = await setup()
  await t.mutation(fn('feedback'), {})
  await expect(t.mutation(fn('feedback'), {})).rejects.toThrow(/RATE_LIMITED/)
  // A signed-in person has a bucket of their own for the same action.
  await ann.mutation(fn('feedback'), {})
  expect((await buckets()).map((row) => row.key).sort()).toEqual([
    `everyone|limit:feedback.send`,
    expect.stringMatching(/^person:[^|]+\|limit:feedback\.send$/),
  ])
})

// Catches: a denied call spending a token, which would let strangers lock a person out of their own limit.
test('a call the policy denies takes no token', async () => {
  const { t, vic, pa, buckets } = await setup()
  await expect(vic.mutation(fn('rename'), { projectId: pa, name: 'x' })).rejects.toThrow(
    /FORBIDDEN/,
  )
  await expect(t.mutation(fn('rename'), { projectId: pa, name: 'x' })).rejects.toThrow(
    /NOT_SIGNED_IN/,
  )
  expect(await buckets()).toEqual([])
})

// Catches: a failed call using up a token (the bucket write must roll back with the call).
test('a call that fails does not count', async () => {
  const { ann, pa, buckets } = await setup()
  for (let i = 0; i < 5; i++)
    await expect(ann.mutation(fn('renameThenFail'), { projectId: pa })).rejects.toThrow(/boom/)
  expect(await buckets()).toEqual([])
  for (const name of ['1', '2', '3']) await ann.mutation(fn('rename'), { projectId: pa, name })
})

// Catches: a wrong definition passing silently until production traffic.
test('wrong limit or audit definitions fail when the policy is defined', () => {
  const base = { actions: ['a.read', 'a.write'], roles: {}, scopes: {} } as const
  const define = (extra: object) => () => definePolicy({ ...base, ...extra } as never)
  expect(define({ limits: { 'a.nope': { max: 1, every: 'minute' } } })).toThrow(
    /"a\.nope".*not in the policy's actions/,
  )
  expect(define({ limits: { 'a.write': { max: 0, every: 'minute' } } })).toThrow(/max.*at least 1/)
  expect(define({ limits: { 'a.write': { max: 1.5, every: 'minute' } } })).toThrow(
    /max.*at least 1/,
  )
  expect(define({ limits: { 'a.write': { max: 1, every: 'week' } } })).toThrow(/every/)
  expect(define({ limits: { 'a.write': { max: 1, every: 'hour', per: 'planet' } } })).toThrow(/per/)
  expect(define({ audit: ['b.*'] })).toThrow(/"b\.\*".*matches no action/)
  expect(define({ audit: ['a.*'], limits: { 'a.write': { max: 1, every: 'day' } } })).not.toThrow()
})

// Catches: a limit on an action only a query uses, which could never be enforced (queries cannot write).
test('a query cannot use a limited action', () => {
  const limited = definePolicy({
    actions: ['x.read'],
    roles: {},
    scopes: {},
    limits: { 'x.read': { max: 1, every: 'minute' } },
  })
  const kit = defineFunctions({
    auth: people(),
    policy: limited,
    user: async () => null,
    roleOf: async () => null,
    rules: {} as never,
  })
  const read = { action: 'x.read', args: {}, returns: {} as never, handler: async () => null }
  expect(() => kit.query(read as never)).toThrow(
    'x.read is limited, but no mutation uses it. Put the limit on the action of a mutation.',
  )
  expect(() => kit.internalQuery(read as never)).toThrow(/no mutation uses it/)
})

// Catches: the audit log missing who/what/where, or recording values instead of ids.
test('an audited mutation writes one row with actor, action, tenant and written ids', async () => {
  const { ann, a, pa, audit, userId } = await setup()
  expect(await ann.mutation(fn('archiveAll'), { orgId: a })).toBe(1)
  expect(await audit()).toMatchObject([
    {
      actor: { key: `person:${userId}`, kind: 'person', door: 'web', userId },
      action: 'projects.archive',
      tenantId: a,
      rows: [pa],
      more: 0,
    },
  ])
})

// Catches: an insert, replace or delete missing from the written ids (only patches were counted).
test('the audit row lists every id the call inserted, replaced, patched or deleted', async () => {
  const { t, ann, a, pa, audit } = await setup()
  const [patched, gone] = await t.run(async (ctx) => [
    await ctx.db.insert('projects', { orgId: a, name: 'patch me', archived: false }),
    await ctx.db.insert('projects', { orgId: a, name: 'gone', archived: false }),
  ])
  const created = await ann.mutation(fn('reshape'), {
    patchId: patched!,
    replaceId: pa,
    deleteId: gone!,
  })
  const [row] = await audit()
  expect([...row!.rows].sort()).toEqual([created, patched, pa, gone].sort())
})

// Catches: an audit row that grows with the call (a bulk change would exceed the document size).
test('an audit row holds at most 50 ids and counts the rest', async () => {
  const { t, ann, a, audit } = await setup()
  await t.run(async (ctx) => {
    for (let i = 0; i < 51; i++)
      await ctx.db.insert('projects', { orgId: a, name: `p${i}`, archived: false })
  })
  await ann.mutation(fn('archiveAll'), { orgId: a })
  const [row] = await audit()
  expect(row!.rows).toHaveLength(50)
  expect(row!.more).toBe(2)
})

// Catches: auditing everything, and keeping a row for work that was rolled back.
test('unaudited writes and failed calls leave no audit row', async () => {
  const { ann, pa, audit } = await setup()
  await ann.mutation(fn('rename'), { projectId: pa, name: 'new' })
  await ann.mutation(fn('addNote'), {})
  await expect(ann.mutation(fn('touchThenFail'), { projectId: pa })).rejects.toThrow(/boom/)
  expect(await audit()).toEqual([])
})

// Catches: a trail in the wrong order, without paging, or leaking another tenant's rows.
test('auditTrail returns a tenant newest first, a page at a time', async () => {
  const { ann, bob, a, b, audit } = await setup()
  for (let i = 0; i < 3; i++) {
    await ann.mutation(fn('archiveAll'), { orgId: a })
    vi.advanceTimersByTime(1000)
  }
  await bob.mutation(fn('archiveAll'), { orgId: b })
  const first = await ann.query(fn('trail'), {
    orgId: a,
    paginationOpts: { numItems: 2, cursor: null },
  })
  expect(first.page).toHaveLength(2)
  expect(first.page[0]._creationTime).toBeGreaterThan(first.page[1]._creationTime)
  const second = await ann.query(fn('trail'), {
    orgId: a,
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  })
  expect(second.page).toHaveLength(1)
  expect(second.page[0]._creationTime).toBeLessThan(first.page[1]._creationTime)
  expect(second.isDone).toBe(true)
  const all = await audit()
  expect(all).toHaveLength(4)
  expect(first.page.every((row: { tenantId: string }) => row.tenantId === a)).toBe(true)
})

// Catches: an audited action leaving no trace when it is reached through an internal operation, or twice (one row per layer).
test('a public mutation that runs an internal operation writes one row with both calls ids', async () => {
  const { t, ann, a, pa, audit } = await setup()
  const second = await t.run((ctx) =>
    ctx.db.insert('projects', { orgId: a, name: 'second', archived: false }),
  )
  await ann.mutation(fn('archiveNested'), { first: pa, second })
  const rows = await audit()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ action: 'projects.nest', more: 0 })
  expect([...rows[0]!.rows].sort()).toEqual([pa, second].sort())
})

// Catches: the system being audited as a person, or a job's nested operation writing a row of its own.
test('a system job writes no audit row', async () => {
  const { t, pa, audit } = await setup()
  await t.mutation(fn('sweep'), { projectId: pa })
  expect(await t.run((ctx) => ctx.db.get(pa))).toMatchObject({ name: 'bumped' })
  expect(await audit()).toEqual([])
})

// Catches: a limited action that escapes its limit when an unlimited public mutation reaches it through an internal mutation.
test('an unlimited public mutation that runs a limited internal action is limited', async () => {
  const { t, ann, pa } = await setup()
  await ann.mutation(fn('runTask'), { projectId: pa, name: 'one' })
  await expect(ann.mutation(fn('runTask'), { projectId: pa, name: 'two' })).rejects.toThrow(
    /RATE_LIMITED/,
  )
  expect(await t.run((ctx) => ctx.db.get(pa))).toMatchObject({ name: 'one' })
})

// Catches: scheduled work on a limited action running without a token (the schedule is a second door).
test('a scheduled internal mutation on a limited action is limited', async () => {
  const { t, ann, pa, buckets } = await setup()
  await ann.mutation(fn('scheduleTask'), { projectId: pa, name: 'first' })
  await ann.mutation(fn('scheduleTask'), { projectId: pa, name: 'second' })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await t.run((ctx) => ctx.db.get(pa))).toMatchObject({ name: 'first' })
  expect((await buckets()).map((row) => row.key)).toEqual([
    expect.stringMatching(/\|limit:tasks\.run$/),
  ])
})

// Catches: a nested call of the same action taking a second token, so max 1 could never be used.
test('a limited public mutation that runs the same limited internal action takes one token', async () => {
  const { t, ann, pa } = await setup()
  await ann.mutation(fn('taskOuter'), { projectId: pa, name: 'once' })
  expect(await t.run((ctx) => ctx.db.get(pa))).toMatchObject({ name: 'once' })
  await expect(ann.mutation(fn('taskOuter'), { projectId: pa, name: 'twice' })).rejects.toThrow(
    /RATE_LIMITED/,
  )
})

// Catches: an audited internal mutation under an unaudited outer call leaving no row at all.
test('an audited internal mutation under an unaudited call writes its own row', async () => {
  const { ann, pa, a, audit, userId } = await setup()
  await ann.mutation(fn('runBump'), { projectId: pa })
  expect(await audit()).toMatchObject([
    {
      action: 'projects.touch',
      actor: { kind: 'person', userId },
      tenantId: a,
      rows: [pa],
      more: 0,
    },
  ])
})

// Catches: a limit or audit entry written past the types that is accepted and then never enforced.
// Each row also defines a valid limit and audit, so a setup that refuses everything fails too.
test.each([
  [
    'max is NaN',
    { limits: { 'a.write': { max: Number.NaN, every: 'minute' } } },
    /max.*at least 1/,
  ],
  [
    'max is Infinity',
    { limits: { 'a.write': { max: Infinity, every: 'minute' } } },
    /max.*at least 1/,
  ],
  ['max is a string', { limits: { 'a.write': { max: '5', every: 'minute' } } }, /max.*at least 1/],
  ['every is missing', { limits: { 'a.write': { max: 1 } } }, /every/],
  ['every is a prototype key', { limits: { 'a.write': { max: 1, every: 'toString' } } }, /every/],
  ['an audit pattern is empty', { audit: [''] }, /"".*matches no action/],
  [
    'an audit pattern is a prefix of nothing',
    { audit: ['a.write.*'] },
    /"a\.write\.\*".*matches no action/,
  ],
] as const)('a limit or audit entry fails at definition: %s', (_name, extra, message) => {
  const base = { actions: ['a.read', 'a.write'], roles: {}, scopes: {} }
  expect(() => definePolicy({ ...base, ...extra } as never)).toThrow(message)
  expect(() =>
    definePolicy({
      ...base,
      audit: ['a.*'],
      limits: { 'a.write': { max: 1, every: 'day', per: undefined } },
    } as never),
  ).not.toThrow()
})
