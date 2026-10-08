import { callTool } from '@lupinum/better-convex-agents/test'
import { unguardedFunctions } from '@lupinum/better-convex-functions/test'
import { grantMcp, signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { describe, expect, it } from 'vitest'

import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { tools } from './agents'
import { initConvexTest, modules } from './test.setup'

// An agency app: agency -> clients -> sites (projects) -> findings, from website-checker.
// Roles come from two levels up: a site inherits its client's roles, a client its agency's.

type Test = ReturnType<typeof initConvexTest>

/**
 * Agency A: Ann owns it, Sam is staff. Its client Acme has Cara as its own person and one site
 * with findings; its client Beta has a site with a canary finding. Agency B (Bob) has a client,
 * Gamma, with a canary finding too.
 */
async function setup() {
  const t = initConvexTest()
  const ids = await t.run(async (ctx) => {
    const user = (authId: string) => ctx.db.insert('users', { authId, name: authId })
    const [ann, sam, cara, bob] = [
      await user('ann'),
      await user('sam'),
      await user('cara'),
      await user('bob'),
    ]
    const agencyA = await ctx.db.insert('agencies', { name: 'Agency A' })
    const agencyB = await ctx.db.insert('agencies', { name: 'Agency B' })
    await ctx.db.insert('agencyMembers', { agencyId: agencyA, userId: ann, role: 'owner' })
    await ctx.db.insert('agencyMembers', { agencyId: agencyA, userId: sam, role: 'staff' })
    await ctx.db.insert('agencyMembers', { agencyId: agencyB, userId: bob, role: 'owner' })
    const client = (agencyId: Id<'agencies'>, name: string) =>
      ctx.db.insert('clients', { agencyId, name })
    const acme = await client(agencyA, 'Acme')
    const beta = await client(agencyA, 'Beta')
    const gamma = await client(agencyB, 'Gamma')
    await ctx.db.insert('clientMembers', { clientId: acme, userId: cara })
    const site = (clientId: Id<'clients'>, name: string) =>
      ctx.db.insert('projects', { clientId, name, url: 'https://example.com' })
    const finding = (
      projectId: Id<'projects'>,
      title: string,
      severity: 'notice' | 'warning' | 'critical',
      state: 'open' | 'fixed' = 'open',
    ) =>
      ctx.db.insert('findings', {
        projectId,
        type: 'broken_link',
        url: 'https://example.com/a',
        title,
        detail: `${title}: details.`,
        severity,
        state,
      })
    const acmeSite = await site(acme, 'Acme site')
    const betaSite = await site(beta, 'Beta site')
    const gammaSite = await site(gamma, 'Gamma site')
    const warning = await finding(acmeSite, 'Missing meta description', 'warning')
    const critical = await finding(acmeSite, 'Broken link to /pricing', 'critical')
    await finding(acmeSite, 'Old title', 'notice', 'fixed')
    return {
      agencyA,
      agencyB,
      acme,
      beta,
      gamma,
      acmeSite,
      betaSite,
      gammaSite,
      warning,
      critical,
      betaCanary: await finding(betaSite, 'Beta canary', 'critical'),
      gammaCanary: await finding(gammaSite, 'Gamma canary', 'critical'),
    }
  })
  return { t, ...ids }
}

// Catches a function built with Convex's own builders instead of the ones from ./functions.
it('every function goes through the policy and the row rules', async () => {
  const trustedRoutes = { '/api/auth/': 'Better Auth endpoints; the auth library checks each one.' }
  expect(await unguardedFunctions(modules, { trustedRoutes })).toEqual([])
})

// Catches a client person who can act for the agency, an agent that acknowledges without a
// person, and an approver role that is not found two levels up.
it("a client reads the brief; a staff agent's acknowledge waits for the agency owner", async () => {
  const { t, acmeSite, warning, critical } = await setup()
  const cara = await signInAs(t, 'cara')
  const { findings, brief } = await cara.query(api.findings.brief, { projectId: acmeSite })
  expect(findings).toBe(2)
  expect(brief.indexOf('Broken link to /pricing')).toBeLessThan(
    brief.indexOf('Missing meta description'),
  )

  const sam = await grantMcp(t, 'sam', ['read', 'write'])
  const asked = await callTool(t, tools, sam, 'acknowledge_findings', {
    findingIds: [critical, warning],
  })
  expect(asked).toMatchObject({
    status: 'needs_approval',
    summary: 'Acknowledge 2 findings on Acme site.',
  })
  if (asked.status !== 'needs_approval') throw new Error('The acknowledge did not wait.')
  await expect(t.run(async (ctx) => (await ctx.db.get(critical))?.state)).resolves.toBe('open')

  // The request's tenant is the site; Ann's owner role there comes from the agency.
  const ann = await signInAs(t, 'ann')
  await expect(ann.query(api.agents.pending, { tenantId: acmeSite })).resolves.toMatchObject([
    { id: asked.approvalId, mine: false },
  ])
  await expect(ann.mutation(api.agents.approve, { approvalId: asked.approvalId })).resolves.toEqual(
    { status: 'approved' },
  )
  await expect(
    callTool(t, tools, sam, 'check_approval', { approvalId: asked.approvalId }),
  ).resolves.toMatchObject({
    status: 'done',
    result: { status: 'approved', result: { acknowledged: 2 } },
  })
  await expect(t.run(async (ctx) => (await ctx.db.get(critical))?.state)).resolves.toBe(
    'acknowledged',
  )
})

type Setup = Awaited<ReturnType<typeof setup>>
type Who = 'cara' | 'sam'
/** The IDs a call aims at: the actor's own, or the canaries of another client or agency. */
type Target = {
  agencyId: Id<'agencies'>
  clientId: Id<'clients'>
  projectId: Id<'projects'>
  findingIds: Id<'findings'>[]
}
type Actor = Awaited<ReturnType<typeof actor>>
type Call = (t: Test, actor: Actor, target: Target) => Promise<unknown>

/** Cara is Acme's own person: Beta, a client of her agency, is foreign to her. */
const targets: Record<Who, (s: Setup) => { own: Target; foreign: Target }> = {
  cara: (s) => ({
    own: { agencyId: s.agencyA, clientId: s.acme, projectId: s.acmeSite, findingIds: [] },
    foreign: { agencyId: s.agencyA, clientId: s.beta, projectId: s.betaSite, findingIds: [] },
  }),
  sam: (s) => ({
    own: { agencyId: s.agencyA, clientId: s.acme, projectId: s.acmeSite, findingIds: [s.warning] },
    // Mixed with one of his own: a list of IDs is refused as a whole.
    foreign: {
      agencyId: s.agencyB,
      clientId: s.gamma,
      projectId: s.gammaSite,
      findingIds: [s.warning, s.gammaCanary],
    },
  }),
}

/** The actor on the web, and their agent with every scope. */
async function actor(t: Test, who: Who) {
  return { web: await signInAs(t, who), agent: await grantMcp(t, who, ['read', 'write']) }
}

const calls: Record<string, Call> = {
  'clients.list': (_t, a, { agencyId }) => a.web.query(api.clients.list, { agencyId }),
  'projects.list': (_t, a, { clientId }) => a.web.query(api.projects.list, { clientId }),
  'findings.brief': (_t, a, { projectId }) => a.web.query(api.findings.brief, { projectId }),
  'findings.acknowledge': (_t, a, { findingIds }) =>
    a.web.mutation(api.findings.acknowledge, { findingIds }),
  list_clients: (t, a, { agencyId }) => callTool(t, tools, a.agent, 'list_clients', { agencyId }),
  list_projects: (t, a, { clientId }) => callTool(t, tools, a.agent, 'list_projects', { clientId }),
  get_fix_brief: (t, a, { projectId }) =>
    callTool(t, tools, a.agent, 'get_fix_brief', { projectId }),
  acknowledge_findings: (t, a, { findingIds }) =>
    callTool(t, tools, a.agent, 'acknowledge_findings', { findingIds }),
}

const code = (error: unknown) => (error as { data?: { code?: string } }).data?.code ?? error

// One row per actor and call, with the one code it must fail with. Cara's rows are reads: a
// client person may not list clients or acknowledge, even for her own client.
const rows: [Who, string, string][] = [
  ['cara', 'projects.list', 'NOT_FOUND'],
  ['cara', 'findings.brief', 'NOT_FOUND'],
  ['cara', 'list_projects', 'NOT_FOUND'],
  ['cara', 'get_fix_brief', 'NOT_FOUND'],
  ['sam', 'clients.list', 'NOT_FOUND'],
  ['sam', 'projects.list', 'NOT_FOUND'],
  ['sam', 'findings.brief', 'NOT_FOUND'],
  ['sam', 'findings.acknowledge', 'NOT_FOUND'],
  ['sam', 'list_clients', 'NOT_FOUND'],
  ['sam', 'list_projects', 'NOT_FOUND'],
  ['sam', 'get_fix_brief', 'NOT_FOUND'],
  ['sam', 'acknowledge_findings', 'NOT_FOUND'],
]

describe('no call reaches another client or agency', () => {
  it('has a call for every tool that takes an ID', () => {
    expect(Object.keys(calls).filter((name) => name.includes('_'))).toEqual(
      tools.catalog.map(({ name }) => name).filter((name) => name !== 'check_approval'),
    )
  })

  it.each(rows)('%s: %s fails with %s', async (who, name, expected) => {
    const s = await setup()
    const { own, foreign } = targets[who](s)
    const a = await actor(s.t, who)
    const state = () =>
      s.t.run(async (ctx) => ({
        findings: await ctx.db.query('findings').collect(),
        approvals: await ctx.db.query('approvals').collect(),
      }))
    const before = await state()

    await expect(calls[name]!(s.t, a, foreign).then(() => 'no error', code)).resolves.toBe(expected)
    // Nothing changed: no finding acknowledged, and no request for a person.
    await expect(state()).resolves.toEqual(before)
    // The positive control: the same call through the same path succeeds with the actor's own IDs.
    await expect(calls[name]!(s.t, a, own)).resolves.toBeDefined()
  })
})
