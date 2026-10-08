import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import schema from './rules/schema'

// One table per guarantee, one row per way into the same internal mutation (`guardInternal`,
// action `projects.guard`: owner only, 2 a minute, audited). A rule built on one door and
// forgotten on another turns a cell red. Contract: docs/content/docs/3.build/8.functions/
// 8.limits-and-audit.md (limits, audit) and 3.row-rules.md (row rules).
const modules = import.meta.glob(['./limits/*.ts', './limits/_generated/*.ts'])
const fn = (name: string) => makeFunctionReference<any>(`ops:${name}`)

/** The ways in. `scheduled`: the outer call only schedules, the guarded mutation runs later. */
const doors = [
  { door: 'public mutation', outer: 'guard', scheduled: false },
  { door: 'internal mutation run by an action', outer: 'scheduleGuardViaAction', scheduled: true },
  { door: 'internal mutation scheduled', outer: 'scheduleGuard', scheduled: true },
  { door: 'nested under an unaudited outer', outer: 'guardUnderPlain', scheduled: false },
  { door: 'nested under an audited outer', outer: 'guardUnderAudited', scheduled: false },
  {
    door: 'nested under a limited outer of the same action',
    outer: 'guardUnderSame',
    scheduled: false,
  },
] as const
type Door = (typeof doors)[number]
const forDoors = doors.map((door) => [door.door, door] as const)

let failures: string[] = []
beforeEach(() => {
  vi.useFakeTimers()
  failures = []
  // convex-test logs a failed scheduled function and keeps no error: read the code from the log.
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const error = args.find((arg) => (arg as { data?: unknown })?.data !== undefined) as
      | { data: { code?: string } }
      | undefined
    failures.push(error?.data.code ?? String(args[0]))
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Org A: Ann owns it, Vic views it. Org B: Bob, with a project of its own. */
async function setup() {
  const t = convexTest({ schema, modules, transactionLimits: true })
  const ids = await t.run(async (ctx) => {
    const [ann, vic, bob] = [
      await ctx.db.insert('users', { authId: 'ann' }),
      await ctx.db.insert('users', { authId: 'vic' }),
      await ctx.db.insert('users', { authId: 'bob' }),
    ]
    const a = await ctx.db.insert('orgs', { name: 'A' })
    const b = await ctx.db.insert('orgs', { name: 'B' })
    await ctx.db.insert('memberships', { orgId: a, userId: ann, role: 'owner' })
    await ctx.db.insert('memberships', { orgId: a, userId: vic, role: 'viewer' })
    await ctx.db.insert('memberships', { orgId: b, userId: bob, role: 'owner' })
    const pa = await ctx.db.insert('projects', { orgId: a, name: 'A one', archived: false })
    const pb = await ctx.db.insert('projects', { orgId: b, name: 'B one', archived: false })
    return { a, pa, pb, annId: ann }
  })
  const name = (id: typeof ids.pa) => t.run(async (ctx) => (await ctx.db.get(id))!.name)
  return {
    t,
    ...ids,
    ann: t.withIdentity({ subject: 'ann' }),
    vic: t.withIdentity({ subject: 'vic' }),
    name,
    buckets: () => t.run((ctx) => ctx.db.query('rateLimits').collect()),
    audit: () => t.run((ctx) => ctx.db.query('auditLog').collect()),
    locks: () => t.run((ctx) => ctx.db.query('locks').collect()),
    activity: () => t.run((ctx) => ctx.db.query('activity').collect()),
  }
}

/** Runs one call through a door; answers 'ok' or the error code, also for a scheduled call. */
async function attempt(
  t: Awaited<ReturnType<typeof setup>>['t'],
  as: Awaited<ReturnType<typeof setup>>['ann'],
  { outer, scheduled }: Door,
  args: { projectId: string; name: string; elsewhere?: string; quiet?: boolean },
) {
  const before = failures.length
  try {
    await as.mutation(fn(outer), args)
  } catch (error) {
    return (error as { data?: { code?: string } }).data?.code ?? `ERROR ${String(error)}`
  }
  if (scheduled) await t.finishAllScheduledFunctions(vi.runAllTimers)
  return failures.length > before ? failures.at(-1)! : 'ok'
}

// Catches: a policy deny that holds on the public door but not on the internal doors. The call
// writes no project row, so no row rule stands behind the policy: only the deny can refuse it.
test.each(forDoors)('policy deny on %s: FORBIDDEN, nothing written', async (_name, door) => {
  const { t, ann, vic, pa, name, buckets, audit, locks } = await setup()
  expect(await attempt(t, vic, door, { projectId: pa, name: 'by vic', quiet: true })).toBe(
    'FORBIDDEN',
  )
  expect(await name(pa)).toBe('A one')
  expect(await locks()).toEqual([])
  expect(await audit()).toEqual([])
  expect(await buckets()).toEqual([])
  // Control: the owner passes the same door.
  expect(await attempt(t, ann, door, { projectId: pa, name: 'by ann' })).toBe('ok')
  expect(await name(pa)).toBe('by ann')
  expect((await locks()).map((lock) => lock.name)).toEqual(['by ann'])
})

// Catches: the row rules checked on the public door only (an internal door writing another place's row).
test.each(forDoors)(
  'row rules on %s: a foreign row is refused, the call rolls back',
  async (_name, door) => {
    const { t, ann, pa, pb, name, buckets, audit, locks } = await setup()
    expect(await attempt(t, ann, door, { projectId: pa, name: 'x', elsewhere: pb })).toBe(
      'NOT_FOUND',
    )
    expect(await name(pa)).toBe('A one')
    expect(await name(pb)).toBe('B one')
    expect(await locks()).toEqual([])
    expect(await audit()).toEqual([])
    expect(await buckets()).toEqual([])
    // Control: the same call without the foreign row passes.
    expect(await attempt(t, ann, door, { projectId: pa, name: 'ok' })).toBe('ok')
    expect(await name(pa)).toBe('ok')
  },
)

// Catches: a limited action that is limited on the public door only, or that takes two tokens when
// an outer call of the same action already took one. 8.limits-and-audit.md: "A mutation run with
// ctx.runMutation takes no token for an action that a call above it already took one for."
test.each(forDoors)('limit on %s: 2 calls pass, the 3rd is RATE_LIMITED', async (_name, door) => {
  const { t, ann, pa, name, buckets } = await setup()
  const tokens = async () => (await buckets()).map((row) => row.tokens)
  expect(await attempt(t, ann, door, { projectId: pa, name: 'n1' })).toBe('ok')
  expect(await tokens()).toEqual([1])
  expect(await attempt(t, ann, door, { projectId: pa, name: 'n2' })).toBe('ok')
  expect(await tokens()).toEqual([0])
  expect(await attempt(t, ann, door, { projectId: pa, name: 'n3' })).toBe('RATE_LIMITED')
  expect(await tokens()).toEqual([0])
  expect(await name(pa)).toBe('n2')
  expect((await buckets()).map((row) => row.key)).toEqual([
    expect.stringMatching(/^person:[^|]+\|limit:projects\.guard$/),
  ])
})

// Catches: an audited action leaving no row, or two rows, on some door; or the outer call's action
// lost. 8.limits-and-audit.md: "an operation that an audited call runs with ctx.runMutation: its ids
// join the outer call's row. Under a call that is not audited, it writes its own row."
test.each(forDoors)(
  'audit on %s: one row with the person, the outer action and the ids',
  async (_name, door) => {
    const { t, ann, a, pa, annId, audit, locks } = await setup()
    expect(await attempt(t, ann, door, { projectId: pa, name: 'once' })).toBe('ok')
    expect(await audit()).toMatchObject([
      {
        action: door.outer === 'guardUnderAudited' ? 'projects.peek' : 'projects.guard',
        actor: { key: `person:${annId}`, kind: 'person', door: 'web', userId: annId },
        tenantId: a,
        rows: [pa, (await locks())[0]!._id],
        more: 0,
      },
    ])
  },
)

// Contract differences, each a literal cell.

// Catches: a job being limited or audited. 8.limits-and-audit.md: "Jobs and other system calls are
// never limited." and "System actors (jobs) ... have no row"; a job writes one `activity` row.
test('a job runs the guarded mutation unlimited, without an audit row, with one activity row each', async () => {
  const { t, pa, name, buckets, audit, activity } = await setup()
  for (const n of ['j1', 'j2', 'j3']) await t.mutation(fn('guardJob'), { projectId: pa, name: n })
  expect(await name(pa)).toBe('j3')
  expect(await buckets()).toEqual([])
  expect(await audit()).toEqual([])
  expect((await activity()).map((row) => [row.action, row.status])).toEqual([
    ['job.guardJob', 'done'],
    ['job.guardJob', 'done'],
    ['job.guardJob', 'done'],
  ])
})

// Catches: row rules applied to the system. 3.row-rules.md: "A system job (job) gets the database
// without rules": a job may write the row of any place.
test('a job may write a row of any place', async () => {
  const { t, pa, pb, name } = await setup()
  await t.mutation(fn('guardJob'), { projectId: pa, name: 'swept', elsewhere: pb })
  expect(await name(pb)).toBe('swept')
})

// Catches: a visitor leaving an audit row, or a person's public call leaving none.
// 8.limits-and-audit.md: "signed-out visitors have no row".
test('a visitor on an audited public action writes no audit row; a person does', async () => {
  const { t, ann, annId, audit } = await setup()
  await t.mutation(fn('feedback'), {})
  expect(await audit()).toEqual([])
  await ann.mutation(fn('feedback'), {})
  expect(await audit()).toMatchObject([
    { action: 'feedback.send', actor: { kind: 'person', userId: annId }, rows: [], more: 0 },
  ])
})
