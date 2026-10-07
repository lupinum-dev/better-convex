import { callTool } from '@lupinum/better-convex-agents/test'
import betterAuth, { grantMcp, signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { seen, type Bad } from './fns'
import schema from './schema'
import { tools } from './tools'

// What the library hands each app callback (review-checklist classes 2 and 10), and what it
// does with a decision callback that returns a value outside its type (class 4).

const modules = import.meta.glob(['./*.ts', './_generated/*.ts'])
const api = anyApi as any
const week = 7 * 86_400_000

beforeEach(() => {
  vi.useFakeTimers()
  seen.clear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Org A: Ann and Olga own it. Ann connected a host with every scope. */
async function setup() {
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  const ids = await t.run(async (ctx) => {
    const [ann, olga] = await Promise.all(
      ['ann', 'olga'].map((authId) => ctx.db.insert('users', { authId, active: true })),
    )
    const orgId = await ctx.db.insert('orgs', { name: 'A' })
    const annMember = await ctx.db.insert('memberships', { orgId, userId: ann!, role: 'owner' })
    const olgaMember = await ctx.db.insert('memberships', { orgId, userId: olga!, role: 'owner' })
    const checkedId = await ctx.db.insert('checked', { verdict: 'true' })
    return { annId: ann!, olgaId: olga!, orgId, annMember, olgaMember, checkedId }
  })
  const ann = await signInAs(t, 'ann', { expiresInMs: week })
  const olga = await signInAs(t, 'olga', { expiresInMs: week })
  const principal = {
    ...(await grantMcp(t, 'ann', ['all'])),
    expiresAt: Math.floor((Date.now() + week) / 1000),
  }
  const tool = (name: string, input: Record<string, unknown>) =>
    callTool(t, tools, principal, name, input)
  /** Runs the work a call scheduled, and only that. */
  const due = async () => {
    vi.advanceTimersByTime(1)
    await t.finishInProgressScheduledFunctions()
  }
  return { t, ann, olga, tool, due, ...ids }
}
type Setup = Awaited<ReturnType<typeof setup>>

/** An in-app agent run in turn 2 on a live grant for everything, as the runtime leaves it. */
async function inAppRun(s: Setup) {
  return await s.t.run(async (ctx) => {
    const grantId = await ctx.db.insert('agentGrants', {
      authId: 'ann',
      userId: s.annId,
      agent: 'helper',
      scopes: ['all'],
      expiresAt: Date.now() + 86_400_000,
    })
    return await ctx.db.insert('agentRuns', {
      grantId,
      userId: s.annId,
      agent: 'helper',
      step: 'agent:step',
      task: 'probe',
      status: 'running',
      turn: 2,
      steps: 1,
      stepAt: Date.now(),
    })
  })
}

/** Ann's agent asks for `probe.ask` and Ann approves; the approved handler has run. */
async function approved(s: Setup, input: Record<string, unknown> = {}) {
  const asked = await s.tool('probe_ask', { orgId: s.orgId, ...input })
  if (asked.status !== 'needs_approval') throw new Error('probe_ask ran without asking a person')
  expect(await s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })).toEqual({
    status: 'approved',
  })
}

/** The work the approved request scheduled has run, and nothing before it is in `seen`. */
async function followUps(s: Setup, input: Record<string, unknown> = {}) {
  await approved(s, input)
  seen.clear()
  await s.due()
}

// --- Table 1: the exact keys each callback point receives -------------------------------------
//
// Catches: a callback that gets more than its job (class 2), such as runMutation, scheduler or
// runQuery in an approval summary, or db write methods where it may only read; and a credential
// in what app code can store (class 10), such as an approvalId, a follow-up token or a grant in
// `ctx.actor`. Keys are listed sorted; nested objects list their keys, never values that vary.
// `meta` and `vectorSearch` are convex-test's own context fields.

const queryCtx = ['actor', 'auth', 'db', 'meta', 'runQuery', 'storage']
const mutationCtx = [
  'actor',
  'auth',
  'db',
  'meta',
  'runMutation',
  'runQuery',
  'scheduler',
  'storage',
]
const actionCtx = [
  'actor',
  'auth',
  'meta',
  'runAction',
  'runMutation',
  'runQuery',
  'scheduler',
  'storage',
  'vectorSearch',
]
/** `ctx.db` with the row rules. Queries list the write methods too; Convex's query db has none, so they throw. */
const checkedDb = ['delete', 'get', 'insert', 'normalizeId', 'patch', 'query', 'replace', 'system']
/** A job's db: the system's, without rules. */
const systemDb = [
  'delete',
  'get',
  'insert',
  'normalizeId',
  'patch',
  'query',
  'replace',
  'system',
  'table',
]
const readDb = ['get', 'normalizeId', 'query']
const ruleCtx = ['action', 'actor', 'allows', 'db', 'mode', 'roleIn', 'tenant']

const person = ['authId', 'door', 'kind', 'user']
const mcpAgent = {
  actor: ['caller', 'clientId', 'door', 'kind', 'scopes', 'user'],
  caller: ['door', 'principal'],
  principal: [
    'clientId',
    'expiresAt',
    'grantId',
    'issuer',
    'kind',
    'resource',
    'scopes',
    'sessionId',
    'userId',
  ],
}
const appAgent = {
  actor: ['agent', 'caller', 'door', 'kind', 'runId', 'scopes', 'user'],
  caller: ['door', 'runId', 'turn'],
}
/** What an internal action gets as its actor: who it acts for, as its caller handed it over. */
const mcpActingAs = {
  actor: ['caller', 'kind'],
  caller: mcpAgent.caller,
  principal: mcpAgent.principal,
}

type Row = {
  row: string
  run: (s: Setup) => Promise<unknown>
  point: string
  /** Compare only this part of what the point received. */
  part?: 'actor'
  expected: unknown
}

const holds: Row[] = [
  {
    row: 'query handler, person at the web door',
    run: (s) => s.ann.query(api.ops.probeQuery, { orgId: s.orgId }),
    point: 'query',
    expected: { ctx: queryCtx, db: checkedDb, actor: person },
  },
  {
    row: 'mutation handler, person at the web door',
    run: (s) => s.ann.mutation(api.ops.probeMutation, { orgId: s.orgId }),
    point: 'mutation',
    expected: { ctx: mutationCtx, db: checkedDb, actor: person },
  },
  {
    row: 'query handler, signed-out visitor',
    run: (s) => s.t.query(api.ops.probePublic, {}),
    point: 'query',
    expected: { ctx: queryCtx, db: checkedDb, actor: ['kind'] },
  },
  {
    row: 'internal query run by a person’s mutation',
    run: (s) => s.ann.mutation(api.ops.probeMutation, { orgId: s.orgId }),
    point: 'internal query',
    expected: { ctx: queryCtx, db: checkedDb, actor: person },
  },
  {
    row: 'internal mutation scheduled by a person’s mutation',
    run: async (s) => {
      await s.ann.mutation(api.ops.probeMutation, { orgId: s.orgId })
      await s.due()
    },
    point: 'internal mutation',
    expected: { ctx: mutationCtx, db: checkedDb, actor: person },
  },
  {
    row: 'internal action scheduled by a person’s mutation',
    run: async (s) => {
      await s.ann.mutation(api.ops.probeMutation, { orgId: s.orgId })
      await s.due()
    },
    point: 'internal action',
    expected: { ctx: actionCtx, actor: ['authId', 'kind'] },
  },
  {
    row: 'job, the system',
    run: (s) => s.t.mutation(api.ops.probeJob, { orgId: s.orgId }),
    point: 'job',
    expected: { ctx: mutationCtx, db: systemDb, actor: ['job', 'kind'] },
  },
  {
    row: 'internal mutation run by a job, the system',
    run: (s) => s.t.mutation(api.ops.probeJob, { orgId: s.orgId }),
    point: 'internal mutation',
    expected: { ctx: mutationCtx, db: systemDb, actor: ['job', 'kind'] },
  },
  {
    row: 'mutation handler, agent at the MCP door',
    run: (s) => s.tool('probe_edit', { orgId: s.orgId }),
    point: 'mutation',
    expected: { ctx: mutationCtx, db: checkedDb, ...mcpAgent },
  },
  {
    row: 'internal mutation scheduled by an MCP agent',
    run: async (s) => {
      await s.tool('probe_edit', { orgId: s.orgId })
      await s.due()
    },
    point: 'internal mutation',
    expected: { ctx: mutationCtx, db: checkedDb, ...mcpAgent },
  },
  {
    row: 'internal action scheduled by an MCP agent',
    run: async (s) => {
      await s.tool('probe_edit', { orgId: s.orgId })
      await s.due()
    },
    point: 'internal action',
    expected: { ctx: actionCtx, ...mcpActingAs },
  },
  {
    row: 'mutation handler, in-app agent',
    run: async (s) =>
      s.t.mutation(api.tools.probe_edit, {
        caller: { door: 'app', runId: await inAppRun(s), turn: 2 },
        input: { orgId: s.orgId },
      }),
    point: 'mutation',
    expected: { ctx: mutationCtx, db: checkedDb, ...appAgent },
  },
  {
    row: 'internal action scheduled by an in-app agent',
    run: async (s) => {
      await s.t.mutation(api.tools.probe_edit, {
        caller: { door: 'app', runId: await inAppRun(s), turn: 2 },
        input: { orgId: s.orgId },
      })
      await s.due()
    },
    point: 'internal action',
    expected: { ctx: actionCtx, actor: ['caller', 'kind'], caller: appAgent.caller },
  },
  {
    row: 'approval summary, agent at the MCP door',
    run: (s) => s.tool('probe_ask', { orgId: s.orgId }),
    point: 'approval summary',
    expected: { ctx: ['actor', 'auth', 'db', 'meta', 'storage'], db: readDb, ...mcpAgent },
  },
  {
    row: 'mutation handler, agent acting under a person’s approval',
    run: (s) => approved(s),
    point: 'mutation',
    expected: { ctx: mutationCtx, db: checkedDb, ...mcpAgent },
  },
  {
    row: 'internal query run under a person’s approval',
    run: (s) => approved(s),
    point: 'internal query',
    expected: { ctx: queryCtx, db: checkedDb, ...mcpAgent },
  },
  {
    row: 'internal mutation, follow-up of an approved request',
    run: (s) => followUps(s),
    point: 'internal mutation',
    expected: { ctx: mutationCtx, db: checkedDb, ...mcpAgent },
  },
  {
    row: 'internal action, follow-up of an approved request',
    run: (s) => followUps(s),
    point: 'internal action',
    expected: { ctx: actionCtx, ...mcpActingAs },
  },
  {
    row: 'agent rule',
    run: (s) => s.tool('probe_rule', { orgId: s.orgId, note: 'x' }),
    point: 'agent rule',
    expected: { arguments: 1, input: ['note', 'orgId'] },
  },
]

// Found by this table. Each row states what the callback should get; `test.fails` keeps the
// suite green while the library still hands out more. Drop `.fails` with the fix.
const overPowered: Row[] = [
  {
    // Class 10: the rule gets the actor before `shown`, with the approval ID.
    row: 'custom row rule, actor of an agent acting under a person’s approval',
    run: (s) => approved(s, { checkedId: s.checkedId }),
    point: 'custom rule',
    part: 'actor',
    expected: mcpAgent.actor,
  },
  {
    // Class 10: the rule gets the actor before `shown`, with the approval ID and follow-up token.
    row: 'custom row rule, actor of a follow-up of an approved request',
    run: (s) => followUps(s, { checkedId: s.checkedId }),
    point: 'custom rule',
    part: 'actor',
    expected: mcpAgent.actor,
  },
  {
    // Class 2: `ctx.db` of a rule is the raw writer (insert, patch, replace, delete), not a reader.
    row: 'custom row rule, person at the web door',
    run: (s) => s.ann.mutation(api.ops.editRow, { table: 'checked', id: s.checkedId }),
    point: 'custom rule',
    expected: { ctx: ruleCtx, db: readDb, actor: person },
  },
  {
    // Class 2: a part of anyOf gets the same raw writer.
    row: 'custom row rule in anyOf',
    run: async (s) => {
      const id = await s.t.run((ctx) =>
        ctx.db.insert('eitherChecked', { ownerId: s.olgaId, verdict: 'true' }),
      )
      await s.ann.mutation(api.ops.editRow, { table: 'eitherChecked', id })
    },
    point: 'custom rule in anyOf',
    expected: { ctx: ruleCtx, db: readDb, actor: person },
  },
  {
    // Class 2: a part of allOf gets the same raw writer.
    row: 'custom row rule in allOf',
    run: async (s) => {
      const id = await s.t.run((ctx) =>
        ctx.db.insert('bothChecked', { orgId: s.orgId, verdict: 'true' }),
      )
      await s.ann.mutation(api.ops.editRow, { table: 'bothChecked', id })
    },
    point: 'custom rule in allOf',
    expected: { ctx: ruleCtx, db: readDb, actor: person },
  },
  {
    // Class 2: roleOf decides a role, typed with a query context; at runtime it gets the whole
    // mutation context: the raw db writer, the scheduler and runMutation without the wrappers.
    row: 'roleOf during a mutation',
    run: (s) => s.ann.mutation(api.ops.probeMutation, { orgId: s.orgId }),
    point: 'roleOf',
    expected: {
      ctx: ['auth', 'db', 'meta', 'storage'],
      db: readDb,
      user: ['_creationTime', '_id', 'active', 'authId'],
      tenant: ['id', 'table'],
    },
  },
  {
    // Class 2: the user lookup, the same.
    row: 'user lookup during a mutation',
    run: (s) => s.ann.mutation(api.ops.probeMutation, { orgId: s.orgId }),
    point: 'user',
    expected: { ctx: ['auth', 'db', 'meta', 'storage'], db: readDb },
  },
]

const receives = async ({ run, point, part, expected }: Row) => {
  const s = await setup()
  await run(s)
  const received = seen.get(point) as Record<string, unknown> | undefined
  expect(part ? received?.[part] : received).toEqual(expected)
}
const named = (rows: Row[]) => rows.map((row) => [row.row, row] as const)
test.each(named(holds))('%s receives exactly these keys', (_, row) => receives(row))
test.fails.each(named(overPowered))('%s receives exactly these keys', (_, row) => receives(row))

// --- Table 2: bad return values at each decision point -----------------------------------------
//
// Catches: a decision callback whose answer is outside its type (no decision, a near-miss
// string, a truthy object, an unawaited promise) or that throws, counted as "allow" (class 4).
// Every row is refused; only the control row in each table passes.

/** A call's answer, or the code (or message) it failed with. */
const outcome = (call: Promise<unknown>) =>
  call.then(
    (value) => value,
    (error: { data?: { code?: string }; message?: string }) =>
      error.data?.code ?? String(error.message),
  )

const broke = expect.stringContaining('The app callback broke.')

/** The stored form of a bad value, which the fixture's callbacks return (fns.ts). */
const verdict = (value: Bad) => `bad:${value}`

type RuleRow = { returns: Bad | 'true'; read: unknown; write: unknown }
const refused = (returns: Bad): RuleRow => ({ returns, read: 'hidden', write: 'NOT_FOUND' })
const ruleRows: RuleRow[] = [
  { returns: 'true', read: 'read', write: 'edited' },
  refused('undefined'),
  refused('null'),
  refused('a Promise of undefined'),
  { returns: 'a thrown Error', read: broke, write: broke },
]
/** Truthy values outside `boolean`: the rule counts them as a pass today. */
const ruleFailsOpen: RuleRow[] = [
  refused("'ALLOW'"),
  refused("'allow '"),
  refused('1'),
  refused('{}'),
]

const rowOf = {
  checked: (s: Setup, verdict: string) => s.t.run((ctx) => ctx.db.insert('checked', { verdict })),
  eitherChecked: (s: Setup, verdict: string) =>
    s.t.run((ctx) => ctx.db.insert('eitherChecked', { ownerId: s.olgaId, verdict })),
  bothChecked: (s: Setup, verdict: string) =>
    s.t.run((ctx) => ctx.db.insert('bothChecked', { orgId: s.orgId, verdict })),
}

for (const [point, table] of [
  ['custom rule', 'checked'],
  ['custom rule in anyOf', 'eitherChecked'],
  ['custom rule in allOf', 'bothChecked'],
] as const) {
  const judged = async ({ returns, read, write }: RuleRow) => {
    const s = await setup()
    const id = await rowOf[table](s, returns === 'true' ? 'true' : verdict(returns))
    expect({
      read: await outcome(s.ann.query(api.ops.readRow, { table, id })),
      write: await outcome(s.ann.mutation(api.ops.editRow, { table, id })),
    }).toEqual({ read, write })
  }
  const rows = (list: RuleRow[]) => list.map((row) => [row.returns, row] as const)
  test.each(rows(ruleRows))(`a ${point} that returns %s`, (_, row) => judged(row))
  // Fail open today: the row is read and changed. Drop `.fails` with the fix.
  test.fails.each(rows(ruleFailsOpen))(`a ${point} that returns %s`, (_, row) => judged(row))
}

/** Stores the bad value `roleOf` returns for this member (fns.ts). */
const setRole = (s: Setup, member: 'annMember' | 'olgaMember', returns: Bad) =>
  s.t.run((ctx) => ctx.db.patch(s[member], { role: verdict(returns) }))

// roleOf at the call's role layer: only `null` hides the tenant (NOT_FOUND); any other value
// that is no role of the policy is refused (FORBIDDEN).
test.each([
  ['owner', null],
  ['undefined', 'FORBIDDEN'],
  ['null', 'NOT_FOUND'],
  ["'ALLOW'", 'FORBIDDEN'],
  ["'allow '", 'FORBIDDEN'],
  ['1', 'FORBIDDEN'],
  ['{}', 'FORBIDDEN'],
  ['a Promise of undefined', 'FORBIDDEN'],
  ['a thrown Error', broke],
] as const)('a call whose roleOf returns %s', async (returns, expected) => {
  const s = await setup()
  if (returns !== 'owner') await setRole(s, 'annMember', returns)
  expect(await outcome(s.ann.query(api.ops.probeQuery, { orgId: s.orgId }))).toEqual(expected)
})

// roleOf where an approver decides a request of another person's agent.
test.each([
  ['owner', { status: 'approved' }],
  ['undefined', 'APPROVAL_NOT_FOUND'],
  ['null', 'APPROVAL_NOT_FOUND'],
  ["'ALLOW'", 'APPROVAL_NOT_FOUND'],
  ["'allow '", 'APPROVAL_NOT_FOUND'],
  ['1', 'APPROVAL_NOT_FOUND'],
  ['{}', 'APPROVAL_NOT_FOUND'],
  ['a Promise of undefined', 'APPROVAL_NOT_FOUND'],
  ['a thrown Error', broke],
] as const)('an approver whose roleOf returns %s', async (returns, expected) => {
  const s = await setup()
  const asked = await s.tool('probe_ask', { orgId: s.orgId })
  if (asked.status !== 'needs_approval') throw new Error('probe_ask ran without asking a person')
  if (returns !== 'owner') await setRole(s, 'olgaMember', returns)
  expect(
    await outcome(s.olga.mutation(api.tools.approve, { approvalId: asked.approvalId })),
  ).toEqual(expected)
})
