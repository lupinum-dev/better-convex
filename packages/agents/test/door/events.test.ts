// The call event of every function an agent reaches, with `defineFunctions({ observe: true })`.
// Contract: docs/content/docs/3.build/8.functions (observe), internal/observability/plan.md.
import { callTool } from '@lupinum/better-convex-agents/test'
import { grantMcp } from '@lupinum/better-convex-nuxt/better-auth/test'
import { expect, test } from 'vitest'

import { tools } from './agents'
import { fn, setup } from './setup'

const base = { type: 'better-convex.call', kind: 'mutation' }

/** Functions no agent calls: a cron, and the two halves of the upload route, which carry a token, not a caller. */
const noCaller = new Set(['housekeeping', 'upload_ticket', 'upload_stored'])

// Catches: a function an agent reaches that writes no line when it refuses the agent, as every
// tool did before (release review, finding 1), also one added later. The list comes from
// `tools.functions`, so a new function needs a line or a place in `noCaller`.
test('every function an agent reaches writes a line when it refuses a revoked connection', async () => {
  const { t, ann, events } = await setup()
  const principal = await grantMcp(t, 'ann', ['read', 'write'])
  await ann.mutation(fn('connections:revoke'), { clientId: 'test-host' })
  events()
  const kinds = new Map(tools.catalog.map((entry) => [entry.name, entry.kind]))
  for (const name of Object.keys(tools.functions)) {
    const kind = kinds.get(name)
    if (kind === undefined) {
      expect(noCaller, `${name} is in no catalog: say why it writes no line`).toContain(name)
      continue
    }
    const call = { caller: { door: 'mcp', principal }, input: {} }
    const ran =
      kind === 'query'
        ? t.query(fn(`agents:${name}`), call)
        : t.mutation(fn(`agents:${name}`), call)
    await ran.catch(() => {})
    expect(events(), name).toEqual([
      { ...base, kind, action: expect.any(String), outcome: 'error', code: 'AGENT_DISABLED' },
    ])
  }
})

// Catches: an agent's work, a request waiting for a person, or a person's decision on it that
// writes no line, a wrong one ("ok" for a request that only waits, or for work that failed), a
// second line for the work inside `approve`, or a decision that names only one of the two actors.
test('agent calls and decisions on their requests write one line each', async () => {
  const { t, ann, bob, a, pa, events } = await setup()
  const principal = await grantMcp(t, 'ann', ['read', 'write'])
  const tool = (name: string, input: Record<string, unknown>) =>
    callTool(t, tools, principal, name, input)
  const { annId, b, later } = await t.run(async (ctx) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', 'ann'))
      .unique()
    const b = await ctx.db.insert('orgs', { name: 'B' })
    const later = await ctx.db.insert('projects', { orgId: a, name: 'A three', status: 'active' })
    return { annId: user!._id, b, later }
  })
  const agent = {
    key: `mcp:${annId}:test-host`,
    kind: 'agent',
    door: 'mcp',
    userId: annId,
    clientId: 'test-host',
  }
  const person = (userId: string) => ({
    key: `person:${userId}`,
    kind: 'person',
    door: 'web',
    userId,
  })
  const bobId = (await t.run((ctx) =>
    ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', 'bob'))
      .unique(),
  ))!._id
  const asked = async (projectId: string) =>
    ((await tool('archive_project', { projectId })) as { approvalId: string }).approvalId

  const created = (await tool('create_project', { orgId: a, name: 'Two' })) as {
    result: { id: string }
  }
  await tool('create_project', { orgId: b, name: 'Not mine' }).catch(() => {})
  // Refused by the input check, before any policy check: the line still names the agent.
  await tool('create_project', { orgId: 'nope', name: 'x' }).catch(() => {})
  const first = await asked(pa)
  await bob.mutation(fn('agents:approve'), { approvalId: first }).catch(() => {})
  await ann.mutation(fn('agents:approve'), { approvalId: first })
  const second = await asked(created.result.id)
  await ann.mutation(fn('agents:decline'), { approvalId: second })
  const third = await asked(later)
  // Changed after the agent asked: the work fails STALE, and `approve` asks again.
  await t.run((ctx) => ctx.db.patch(later, { name: 'Renamed' }))
  await ann.mutation(fn('agents:approve'), { approvalId: third })

  const archive = { ...base, action: 'projects.archive', tenant: a }
  const decision = { ...archive, agent: agent.key }
  expect(events()).toEqual([
    { ...base, action: 'projects.create', actor: agent, tenant: a, outcome: 'ok', written: 1 },
    { ...base, action: 'projects.create', actor: agent, outcome: 'error', code: 'NOT_FOUND' },
    { ...base, action: 'projects.create', actor: agent, outcome: 'error', code: 'INVALID_INPUT' },
    { ...archive, actor: agent, outcome: 'pending', approval: first },
    {
      ...decision,
      actor: person(bobId),
      outcome: 'error',
      code: 'APPROVAL_NOT_FOUND',
      approval: first,
    },
    { ...decision, actor: person(annId), outcome: 'ok', written: 1, approval: first },
    { ...archive, actor: agent, outcome: 'pending', approval: second },
    { ...decision, actor: person(annId), outcome: 'declined', approval: second },
    { ...archive, actor: agent, outcome: 'pending', approval: third },
    { ...decision, actor: person(annId), outcome: 'error', code: 'STALE', approval: third },
  ])
  expect(await t.run((ctx) => ctx.db.get(pa))).toMatchObject({ status: 'archived' })
})
