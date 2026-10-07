import { grantMcp } from '@lupinum/better-convex-nuxt/better-auth/test'
import { afterEach, expect, test, vi } from 'vitest'

import { runSeededAuthCorpus, type SeededRandom } from '../../../../test/auth-fuzz/seeded'
import { auth } from './fns'
import { api, setup } from './harness'
import { tools } from './tools'

// Seeded random sequences of agent calls, decisions, revokes, run ends, row edits and clock
// steps on the approvals fixture. Catches authority that leaks in a combination no single test
// lists (classes 1, 4, 11; S9, S10, S11, S14, S16, S18): a follow-up that outlives its hour or its
// grant, an approval ID or token that other work can use, a decision by someone who is not an
// approver, a STALE, declined or expired request that still runs, a retry that runs twice, a
// refusal that is a crash instead of a code.
//
// The oracle copies no policy logic. After every step it diffs the raw tables and holds each
// change against permission facts the test tracks from the steps it made (`may`, `decidable`),
// with the fixture's policy as literal maps. A failure prints its seed, a replay command and the
// shortest step list that still fails. Long runs: BCN_AUTH_FUZZ_CASES=500.
// Long runs still meet one open finding (I3, a request_id that names two calls): see the
// `.fails` test in approvals.test.ts.

type Agent = 'annMcp' | 'annApp' | 'malMcp'
type Person = 'ann' | 'olga' | 'vic' | 'mallory'
type Tool = 'rename_project' | 'archive_project' | 'archive_later' | 'export_project'
type Step =
  | {
      do: 'call'
      agent: Agent
      tool: Tool
      project: number
      big: boolean
      requestId?: string
      oldTurn: boolean
      /** Repeat the call of an earlier request (counted back from the newest), as a retry does. */
      again?: number
    }
  /** `request` counts back from the newest request. */
  | { do: 'decide'; person: Person; approve: boolean; request: number }
  | {
      do: 'work'
      /** The requesting agent, Ann's other agent, or any. */
      agent: Agent | 'requester' | 'other'
      /** Pick among the approved requests (or all). */
      approved: boolean
      request: number
      token: 'none' | 'made-up' | 'real'
      project: number
      rename: boolean
    }
  | { do: 'revoke'; agent: Agent; cancel: boolean }
  | { do: 'run'; to: 'done' | 'failed' | 'next turn' }
  | { do: 'edit'; project: number }
  | { do: 'clock'; ms: number }

const minute = 60_000
// The fixture (harness.ts, fns.ts) as literals. Projects 0 and 1 are org A's, project 2 org M's.
const orgOf = ['A', 'A', 'M'] as const
const ownerIn: Record<Person, 'A' | 'M' | null> = { ann: 'A', olga: 'A', vic: null, mallory: 'M' }
const userOf: Record<Agent, Person> = { annMcp: 'ann', annApp: 'ann', malMcp: 'mallory' }
const runsAlone = (tool: Tool, big: boolean) =>
  tool === 'rename_project' || (tool === 'export_project' && !big)
/** Tools whose `approvers` let an owner of the tenant decide; the rest only the requester's person. */
const ownersDecide: Record<Tool, boolean> = {
  rename_project: false,
  archive_project: true,
  archive_later: true,
  export_project: false,
}
const ttl = 30 * minute
const followUpHour = 60 * minute
/** The library's refusals that these steps may meet. */
const codes = (
  'FORBIDDEN NOT_FOUND AGENT_DISABLED APPROVAL_NOT_FOUND APPROVAL_EXPIRED APPROVAL_DECLINED ' +
  'STALE REQUEST_ID_REUSED RATE_LIMITED'
).split(' ')

function inputOf(tool: Tool, projectId: string, big: boolean) {
  if (tool === 'rename_project') return { projectId, name: 'renamed' }
  if (tool === 'export_project') return { projectId, size: big ? 500 : 5 }
  if (tool === 'archive_project') return { projectId }
  // `big`: the same follow-up again after 61 minutes, past the approval's hour.
  return { projectIds: [projectId], ...(big ? { againAfter: 61 * minute } : {}) }
}

function generate(random: SeededRandom): Step[] {
  const { pick, integer } = random
  const agent = () => pick(['annMcp', 'annMcp', 'annMcp', 'annApp', 'annApp', 'malMcp'] as const)
  const weights = { call: 5, decide: 5, work: 6, clock: 3, edit: 1, run: 1, revoke: 2 }
  const kinds = Object.entries(weights).flatMap(([kind, n]) => Array<string>(n).fill(kind))
  // The first two steps are calls: decisions and work need a request.
  return Array.from({ length: 10 + integer(15) }, (_, i): Step => {
    switch (i < 2 ? 'call' : pick(kinds)) {
      case 'call':
        return {
          do: 'call',
          agent: agent(),
          tool: pick(['rename_project', 'archive_project', 'archive_later', 'export_project']),
          project: integer(3),
          big: integer(2) === 0,
          oldTurn: integer(10) === 0,
          ...(integer(3) === 0 ? { requestId: pick(['r1', 'r2']) } : {}),
          ...(integer(3) === 0 ? { again: pick([0, 0, 1, 3]) } : {}),
        }
      case 'decide':
        return {
          do: 'decide',
          person: pick(['ann', 'ann', 'ann', 'ann', 'olga', 'vic', 'mallory']),
          approve: integer(5) > 0,
          request: pick([0, 0, 0, 1, 2, 5]),
        }
      case 'work':
        return {
          do: 'work',
          agent: pick(['requester', 'requester', 'other', 'other', agent()]),
          approved: integer(4) > 0,
          request: pick([0, 0, 1, 3]),
          rename: integer(2) === 0,
          token: pick(['none', 'made-up', 'made-up', 'real', 'real', 'real']),
          project: integer(3),
        }
      case 'revoke':
        return { do: 'revoke', agent: agent(), cancel: integer(4) === 0 }
      case 'run':
        return { do: 'run', to: pick(['done', 'failed', 'next turn', 'next turn']) }
      case 'edit':
        return { do: 'edit', project: integer(3) }
      default:
        return { do: 'clock', ms: pick([1, 5 * minute, 61 * minute]) }
    }
  })
}

/** Org A of the fixture, org M with Mallory and her MCP connection, and Ann's in-app run. */
async function world() {
  vi.useRealTimers()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const s = await setup()
  const m = await s.t.run(async (ctx) => {
    const mallory = await ctx.db.insert('users', { authId: 'mallory', active: true })
    const orgId = await ctx.db.insert('orgs', { name: 'M' })
    await ctx.db.insert('memberships', { orgId, userId: mallory, role: 'owner' })
    const project = await ctx.db.insert('projects', { orgId, name: 'mu', status: 'active' })
    const grantId = await ctx.db.insert('agentGrants', {
      authId: 'ann',
      userId: s.annId,
      agent: 'helper',
      scopes: ['projects:write'],
      expiresAt: Date.now() + 86_400_000 * 7,
    })
    const runId = await ctx.db.insert('agentRuns', {
      grantId,
      userId: s.annId,
      agent: 'helper',
      step: 'agent:step',
      task: 'fuzz',
      status: 'running',
      turn: 2,
      steps: 1,
      stepAt: Date.now(),
    })
    return { mallory, project, grantId, runId }
  })
  const people = { ann: s.ann, olga: s.olga, vic: s.vic, mallory: await s.as('mallory') }
  const malPrincipal = {
    ...(await grantMcp(s.t, 'mallory', ['projects:read', 'projects:write'])),
    expiresAt: s.principal.expiresAt,
  }
  const projects = [s.p[0]!, s.p[1]!, m.project] as string[]
  return { ...s, ...m, people, malPrincipal, projects }
}

interface Asked {
  id: string
  agent: Agent
  tool: Tool
  call: string
  project: number
  big: boolean
  at: number
  row: string
  decided?: 'approved' | 'declined' | 'refused'
  approvedAt?: number
  followUpsRan?: boolean
}

/** A refusal as its code; an error without one is a crash. */
function codeOf(outcome: unknown) {
  if (outcome instanceof Error)
    return (outcome as { data?: { code?: string } }).data?.code ?? `crash: ${outcome.message}`
  return (outcome as { error?: { code: string } } | null)?.error?.code
}

/** Plays the steps on a fresh world; throws at the first broken invariant. */
async function play(steps: Step[]) {
  const w = await world()
  const { t } = w
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const live: Record<Agent, boolean> = { annMcp: true, annApp: true, malMcp: true }
  const run = { status: 'running' as 'running' | 'done' | 'failed', turn: 2 }
  const asked: Asked[] = []
  const settle = (call: Promise<unknown>) => call.catch((error: unknown) => error)
  const rowOf = (k: number) =>
    t.run(async (ctx) => JSON.stringify(await ctx.db.get(w.projects[k] as never)))
  const caller = (agent: Agent, oldTurn = false) =>
    agent === 'annApp'
      ? { door: 'app', runId: w.runId, turn: oldTurn ? run.turn - 1 : run.turn }
      : { door: 'mcp', principal: agent === 'annMcp' ? w.principal : w.malPrincipal }
  /** The raw rows: projects and approval statuses by ID, and the activity log. */
  const snapshot = async () => {
    const raw = await t.run(async (ctx) => ({
      projects: await ctx.db.query('projects').collect(),
      approvals: await ctx.db.query('approvals').collect(),
      activity: await ctx.db.query('activity').collect(),
    }))
    return {
      projects: new Map(raw.projects.map((row) => [row._id as string, JSON.stringify(row)])),
      approvals: new Map(raw.approvals.map((row) => [row._id as string, row.status as string])),
      activity: raw.activity,
    }
  }
  let before = await snapshot()
  try {
    for (const [i, step] of steps.entries()) {
      const at = `step ${i} ${JSON.stringify(step)}`
      const now = Date.now()
      const may = new Set<number>() // projects this step may change (I1)
      const decidable = new Set<string>() // requests this step may decide (I5)
      // Decisions go to requests nobody decided yet, work to approved ones, when there are any.
      const wanted = asked.filter((r) =>
        step.do === 'decide'
          ? !r.decided
          : step.do === 'work' && step.approved
            ? r.decided === 'approved'
            : true,
      )
      const pool = wanted.length ? wanted : asked
      const back = (k: number) => pool[pool.length - 1 - (k % pool.length)]
      const request = 'request' in step ? back(step.request) : undefined
      let outcome: unknown
      if (step.do === 'call') {
        const earlier = step.again === undefined ? undefined : back(step.again)
        const { agent, tool, project, big } = earlier ?? step
        const requestId = step.requestId
        const input = inputOf(tool, w.projects[project]!, big)
        const call = `${agent} ${tool} ${JSON.stringify(input)}`
        const current = agent !== 'annApp' || (run.status === 'running' && !step.oldTurn)
        const owns = ownerIn[userOf[agent]] === orgOf[project]
        if (runsAlone(tool, big) && live[agent] && current && owns) may.add(project)
        outcome = await settle(
          agent === 'annApp'
            ? t.mutation(api.tools[tool], {
                caller: caller(agent, step.oldTurn),
                input,
                ...(requestId ? { requestId } : {}),
              })
            : w.tool(
                tool,
                { ...input, ...(requestId ? { request_id: requestId } : {}) },
                agent === 'annMcp' ? w.principal : w.malPrincipal,
              ),
        )
        const out = outcome as { status?: string; approvalId: string }
        if (out.status === 'needs_approval') {
          // I4: a call a person declined does not reach a person again while that request lives.
          const declined = asked.find(
            (r) => r.call === call && r.decided === 'declined' && now < r.at + ttl,
          )
          expect(declined, `I4: a declined call asked again at ${at}`).toBeUndefined()
          if (!asked.some((r) => r.id === out.approvalId))
            asked.push({
              id: out.approvalId,
              agent,
              tool,
              call,
              project,
              big,
              at: now,
              row: await rowOf(project),
            })
        }
      } else if (step.do === 'decide' && request) {
        const r = request
        const approver = ownersDecide[r.tool] && ownerIn[step.person] === orgOf[r.project]
        if (!r.decided && now < r.at + ttl && (userOf[r.agent] === step.person || approver)) {
          decidable.add(r.id)
          // I6: the row changed since the ask (by anyone), so approving must not run the request.
          const fresh = (await rowOf(r.project)) === r.row
          const agentOn = live[r.agent] && (r.agent !== 'annApp' || run.status === 'running')
          r.decided = !step.approve ? 'declined' : fresh && agentOn ? 'approved' : 'refused'
          if (r.decided === 'approved') {
            r.approvedAt = now
            may.add(r.project)
          }
        }
        const decide = step.approve ? api.tools.approve : api.tools.decline
        outcome = await settle(w.people[step.person].mutation(decide, { approvalId: r.id }))
      } else if (step.do === 'work' && request) {
        // Internal work that names an approval, with its token (leaked), a made-up one or none:
        // only the requesting agent's work with the real token, within the hour, on a live grant.
        const r = request
        const other = r.agent === 'annMcp' ? 'annApp' : 'annMcp'
        const agent: Agent =
          step.agent === 'requester' ? r.agent : step.agent === 'other' ? other : step.agent
        const real = await t.run(
          async (ctx) => (await ctx.db.get(ctx.db.normalizeId('approvals', r.id)!))?.followUp,
        )
        const token = { none: undefined, 'made-up': 'made-up', real }[step.token]
        const inHour = r.decided === 'approved' && now < r.approvedAt! + followUpHour
        const owns = ownerIn[userOf[agent]] === orgOf[step.project]
        if (inHour && agent === r.agent && step.token === 'real' && live[agent] && owns)
          may.add(step.project)
        const actingAs = {
          kind: 'agent',
          caller: caller(agent),
          approvalId: r.id,
          ...(token ? { followUp: token } : {}),
        }
        // Archiving needs approval; renaming does not, but always shows in the row.
        const [op, input] = step.rename
          ? [api.ops.renameRow, { projectId: w.projects[step.project], name: `work ${i}` }]
          : [api.ops.archiveRow, { projectId: w.projects[step.project] }]
        outcome = await settle(t.mutation(op, { actingAs, input }))
      } else if (step.do === 'revoke') {
        live[step.agent] = false
        const ann = step.agent !== 'malMcp'
        await t.run(async (ctx) => {
          if (step.agent === 'annApp')
            return await ctx.db.patch(w.grantId, { revokedAt: Date.now() })
          await auth.oauthConnections.revoke(ctx, {
            userId: ann ? 'ann' : 'mallory',
            clientId: 'test-host',
          })
          if (step.cancel) await tools.disconnected(ctx, ann ? w.annId : w.mallory, 'test-host')
        })
      } else if (step.do === 'run' && run.status === 'running') {
        if (step.to === 'next turn') run.turn++
        else run.status = step.to
        await t.run((ctx) => ctx.db.patch(w.runId, { status: run.status, turn: run.turn }))
      } else if (step.do === 'edit') {
        // A person changes the project (and makes it active again).
        may.add(step.project)
        await t.run((ctx) =>
          ctx.db.patch(w.projects[step.project] as never, { name: `edit ${i}`, status: 'active' }),
        )
      } else if (step.do === 'clock') {
        log.mockClear()
        vi.advanceTimersByTime(step.ms)
        await t.finishInProgressScheduledFunctions()
        // Due work starts when the timer fires and runs once the clock has moved: at Date.now().
        // The follow-ups an approval scheduled at once (`runAfter(0)`) run in the first clock step
        // after it. The one scheduled after 61 minutes is past the hour: it may change nothing.
        for (const r of asked)
          if (r.tool === 'archive_later' && r.decided === 'approved' && !r.followUpsRan) {
            r.followUpsRan = true
            if (Date.now() < r.approvedAt! + followUpHour && live[r.agent]) may.add(r.project)
          }
        for (const [text, error] of log.mock.calls)
          if (String(text).startsWith('Error when running scheduled function'))
            expect(codes, `a follow-up failed at ${at}`).toContain(codeOf(error))
      }
      // Every refusal is one of the library's codes, never a crash.
      const code = codeOf(outcome)
      if (code !== undefined) expect(codes, `outcome at ${at}`).toContain(code)

      const after = await snapshot()
      for (const [id, row] of after.projects)
        if (row !== before.projects.get(id))
          expect(
            may.has(w.projects.indexOf(id)),
            `I1: project ${w.projects.indexOf(id)} (${id}) changed at ${at}`,
          ).toBe(true)
      const decided = ['approved', 'declined', 'failed']
      for (const [id, status] of after.approvals)
        if (status !== before.approvals.get(id) && decided.includes(status))
          expect(decidable.has(id), `I5: request decided without standing at ${at}`).toBe(true)
      // I3: each approval's work, and each retry key, ran at most once.
      const ran = after.activity
        .filter((row) => row.status === 'done' || row.status === 'approved')
        .flatMap((row) => [
          row.approvalId && `approval ${row.approvalId}`,
          row.requestId && `retry ${row.actor.key} ${row.requestId}`,
        ])
        .filter((key) => key)
      const twice = ran.filter((key, k) => ran.indexOf(key) !== k)
      expect(twice, `I3 at ${at}`).toEqual([])
      before = after
    }
  } finally {
    log.mockRestore()
  }
}

/** Drops steps one at a time, from the end, while the sequence still fails. */
async function shrink(steps: Step[]) {
  let current = steps
  for (let i = current.length - 1; i >= 0; i--) {
    const candidate = current.filter((_, k) => k !== i)
    const fails = await play(candidate).catch(() => 'fails')
    if (fails) current = candidate
  }
  return current
}

afterEach(() => vi.useRealTimers())

/** Cases per seed: 12 by default, more for a long run. */
const cases = Number(process.env.BCN_AUTH_FUZZ_CASES ?? 12)

test(
  'random sequences of agent calls, decisions, revokes and clock steps change only what someone may change',
  { timeout: 20_000 + cases * 1_000 },
  async () => {
    await runSeededAuthCorpus(
      'agents-approval-sequences',
      cases,
      async (random) => {
        const steps = generate(random)
        try {
          await play(steps)
        } catch (error) {
          const minimal = (await shrink(steps)).map((step) => JSON.stringify(step)).join('\n')
          throw new Error(`${(error as Error).message}\nShortest failing steps:\n${minimal}`, {
            cause: error,
          })
        }
      },
      'agents packages/agents/test/approvals/sequence-fuzz.test.ts',
    )
  },
)
