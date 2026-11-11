// The call event of `defineFunctions({ observe: true })`: one JSON console line per call.
// Contract: docs/content/docs/3.build/8.functions (observe), internal/observability/plan.md.
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import schema from './rules/schema'

const modules = import.meta.glob(['./observe/*.ts', './observe/_generated/*.ts'])
const fn = (name: string) => makeFunctionReference<any>(name)

/** The event lines the calls wrote, parsed. */
let lines: string[] = []
beforeEach(() => {
  lines = []
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    if (typeof line === 'string' && line.startsWith('{"type":"better-convex.call"'))
      lines.push(line)
  })
})
afterEach(() => vi.restoreAllMocks())
const events = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>)

/** Org A: Ann owns it, Vic views it. Bob has no role there. */
async function setup() {
  const t = convexTest({ schema, modules })
  const ids = await t.run(async (ctx) => {
    const user = (authId: string) => ctx.db.insert('users', { authId })
    const [ann, vic, bob] = [await user('ann'), await user('vic'), await user('bob')]
    const orgId = await ctx.db.insert('orgs', { name: 'A' })
    await ctx.db.insert('memberships', { orgId, userId: ann, role: 'owner' })
    await ctx.db.insert('memberships', { orgId, userId: vic, role: 'viewer' })
    const projectId = await ctx.db.insert('projects', { orgId, name: 'One', archived: false })
    return { ann, vic, bob, orgId, projectId }
  })
  const as = (authId: string) => t.withIdentity({ subject: authId })
  const person = (userId: string) => ({
    key: `person:${userId}`,
    kind: 'person',
    door: 'web',
    userId,
  })
  return { t, ...ids, as, person }
}

// Catches: an event that misses who acted, where, with which result, or the fields the handler added.
test('a call writes one event with actor, tenant, outcome, code and fields', async () => {
  const { t, as, person, ann, vic, orgId, projectId } = await setup()
  const calls: [string, () => Promise<unknown>, Record<string, unknown>][] = [
    [
      'a write that succeeds',
      () => as('ann').mutation(fn('ops:rename'), { projectId, name: 'Two' }),
      {
        actor: person(ann),
        tenant: orgId,
        outcome: 'ok',
        written: 1,
        fields: { project: { id: projectId } },
      },
    ],
    [
      'a refusal by the handler, with help',
      () => as('ann').mutation(fn('ops:rename'), { projectId, name: 'X!' }),
      {
        actor: person(ann),
        tenant: orgId,
        outcome: 'error',
        code: 'INVALID_INPUT',
        fields: { project: { id: projectId } },
      },
    ],
    [
      'a refusal by the policy',
      () => as('vic').mutation(fn('ops:rename'), { projectId, name: 'Three' }),
      { actor: person(vic), tenant: orgId, outcome: 'error', code: 'FORBIDDEN' },
    ],
    [
      "an app's own code",
      () => as('ann').mutation(fn('ops:lock'), { projectId }),
      { actor: person(ann), tenant: orgId, outcome: 'error', code: 'PROJECT_LOCKED' },
    ],
    [
      'a crash after a write: no code, and no rows, since none are kept',
      () => as('ann').mutation(fn('ops:crash'), { projectId }),
      { actor: person(ann), tenant: orgId, outcome: 'error' },
    ],
  ]
  for (const [name, call, expected] of calls) {
    lines = []
    await call().catch(() => {})
    expect(events(), name).toEqual([
      {
        type: 'better-convex.call',
        action: expected.action ?? 'projects.rename',
        kind: 'mutation',
        ...expected,
      },
    ])
  }
  await expect(t.run((ctx) => ctx.db.get(projectId))).resolves.toMatchObject({ name: 'Two' })
})

// Catches: a value a person typed, a message or help text copied to the log service.
test('an event holds IDs and codes, never arguments, messages or help', async () => {
  const { as, projectId } = await setup()
  await as('ann')
    .mutation(fn('ops:rename'), { projectId, name: 'X!' })
    .catch(() => {})
  await as('ann')
    .mutation(fn('ops:lock'), { projectId })
    .catch(() => {})
  await as('ann')
    .mutation(fn('ops:crash'), { projectId })
    .catch(() => {})
  expect(lines).toHaveLength(3)
  for (const leak of ['X!', 'too short', 'Names appear', 'Use 3', 'Ann Example', 'internal detail'])
    expect(lines.join('\n')).not.toContain(leak)
})

// Catches: reactive queries flooding the log on every data change, or a refused read that leaves no trace.
test('a query writes an event only when it fails', async () => {
  const { t, as, person, bob, projectId } = await setup()
  await as('ann').query(fn('ops:read'), { projectId })
  await as('vic').query(fn('ops:read'), { projectId })
  expect(lines).toEqual([])
  await t.query(fn('ops:read'), { projectId }).catch(() => {})
  await as('bob')
    .query(fn('ops:read'), { projectId })
    .catch(() => {})
  expect(events()).toEqual([
    {
      type: 'better-convex.call',
      action: 'projects.read',
      kind: 'query',
      outcome: 'error',
      code: 'NOT_SIGNED_IN',
    },
    {
      type: 'better-convex.call',
      action: 'projects.read',
      kind: 'query',
      actor: person(bob),
      outcome: 'error',
      code: 'NOT_FOUND',
    },
  ])
})

// Catches: a public action, a job or an internal action that leaves no event, or one per inner check.
test('public actions, jobs and internal actions write one event each', async () => {
  const { t, as, person, ann, orgId } = await setup()
  await as('ann').action(fn('ops:report'), { orgId })
  await t.mutation(fn('ops:sweep'), {})
  await t.action(fn('ops:fetchSite'), { actingAs: { kind: 'system', job: 'nightly' }, input: {} })
  const system = (job: string) => ({ key: `system:${job}`, kind: 'system', door: 'job', job })
  expect(events()).toEqual([
    {
      type: 'better-convex.call',
      action: 'reports.make',
      kind: 'action',
      actor: person(ann),
      outcome: 'ok',
      fields: { org: orgId },
    },
    {
      type: 'better-convex.call',
      action: 'job.sweep',
      kind: 'mutation',
      actor: system('sweep'),
      outcome: 'ok',
      fields: { swept: 0 },
    },
    { type: 'better-convex.call', kind: 'action', actor: system('nightly'), outcome: 'ok' },
  ])
})

// Catches: an inner call reporting "ok" and rows written when the transaction it ran in rolled
// back, or the outer event missing the rows its inner calls wrote.
test("a call run inside another call's transaction writes no event of its own", async () => {
  const { t, as, person, ann, orgId, projectId } = await setup()
  await as('ann').mutation(fn('ops:renameVia'), { projectId, name: 'Via', thenFail: false })
  await as('ann')
    .mutation(fn('ops:renameVia'), { projectId, name: 'Lost', thenFail: true })
    .catch(() => {})
  const base = { type: 'better-convex.call', action: 'projects.rename', kind: 'mutation' }
  expect(events()).toEqual([
    { ...base, actor: person(ann), tenant: orgId, outcome: 'ok', written: 1 },
    { ...base, actor: person(ann), tenant: orgId, outcome: 'error', code: 'INVALID_INPUT' },
  ])
  await expect(t.run((ctx) => ctx.db.get(projectId))).resolves.toMatchObject({ name: 'Via' })
})

// Catches: events from an app that did not turn `observe` on, or `ctx.log.set` failing there.
test('without observe, calls write no event and ctx.log.set does nothing', async () => {
  const { t, as, projectId } = await setup()
  await as('ann').mutation(fn('quiet:rename'), { projectId, name: 'Quiet' })
  expect(lines).toEqual([])
  await expect(t.run((ctx) => ctx.db.get(projectId))).resolves.toMatchObject({ name: 'Quiet' })
})
