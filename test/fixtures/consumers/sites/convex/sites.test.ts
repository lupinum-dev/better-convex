import { callTool } from '@lupinum/better-convex-agents/test'
import { unguardedFunctions } from '@lupinum/better-convex-functions/test'
import { grantMcp, signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { tools } from './agents'
import { initConvexTest, modules } from './test.setup'

// The site-check feature of the docs: a paid check that an agent may only ask for, a job that
// starts queued checks, and an internal action that records the result.

type Test = ReturnType<typeof initConvexTest>
const paginationOpts = { numItems: 10, cursor: null }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

/** Ann owns Acme with one site; Bob owns Bobco with the canary site. */
async function setup() {
  const t = initConvexTest()
  const ids = await t.run(async (ctx) => {
    const owner = async (authId: string, organization: string, site: string) => {
      const userId = await ctx.db.insert('users', { authId, name: authId })
      const organizationId = await ctx.db.insert('organizations', { name: organization })
      await ctx.db.insert('memberships', { organizationId, userId, role: 'owner' })
      return ctx.db.insert('sites', { organizationId, name: site, url: 'https://example.com' })
    }
    return {
      shop: await owner('ann', 'Acme', 'Shop'),
      canary: await owner('bob', 'Bobco', 'Canary'),
    }
  })
  return { t, ...ids }
}

/** What the cron does: start queued checks, then let the scheduled checks finish. */
async function runScheduled(t: Test) {
  await t.mutation(internal.sites.dispatchChecks, {})
  vi.runOnlyPendingTimers()
  await t.finishInProgressScheduledFunctions()
}

// Catches a function built with Convex's own builders instead of the ones from ./functions.
it('every function goes through the policy and the row rules', async () => {
  const trustedRoutes = { '/api/auth/': 'Better Auth endpoints; the auth library checks each one.' }
  expect(await unguardedFunctions(modules, { trustedRoutes })).toEqual([])
})

// Catches an agent that spends money without a person, and an approved check that never runs.
it("an agent's check waits for approval, then the job runs it", async () => {
  const { t, shop } = await setup()
  const agent = await grantMcp(t, 'ann', ['mcp:read', 'mcp:write'])
  const asked = await callTool(t, tools, agent, 'trigger_site_check', { siteId: shop })
  expect(asked).toMatchObject({
    status: 'needs_approval',
    summary: 'Run a paid check of the site "Shop".',
  })
  if (asked.status !== 'needs_approval') throw new Error('The check did not wait.')
  await expect(t.run((ctx) => ctx.db.query('siteChecks').collect())).resolves.toEqual([])

  const ann = await signInAs(t, 'ann')
  await expect(ann.mutation(api.agents.approve, { approvalId: asked.approvalId })).resolves.toEqual(
    { status: 'approved' },
  )
  await runScheduled(t)
  await expect(
    callTool(t, tools, agent, 'list_site_checks', { siteId: shop }),
  ).resolves.toMatchObject({ status: 'done', result: { items: [{ status: 'ok' }] } })
})

type Actor = Awaited<ReturnType<typeof actor>>
type Call = (t: Test, actor: Actor, siteId: Id<'sites'>) => Promise<unknown>

/** Ann on the web, and her agent with every scope. */
async function actor(t: Test) {
  return {
    web: await signInAs(t, 'ann'),
    agent: await grantMcp(t, 'ann', ['mcp:read', 'mcp:write']),
  }
}

const calls: Record<string, Call> = {
  triggerCheck: (_t, a, siteId) => a.web.mutation(api.sites.triggerCheck, { siteId }),
  listChecks: (_t, a, siteId) => a.web.query(api.sites.listChecks, { siteId, paginationOpts }),
  trigger_site_check: (t, a, siteId) =>
    callTool(t, tools, a.agent, 'trigger_site_check', { siteId }),
  list_site_checks: (t, a, siteId) => callTool(t, tools, a.agent, 'list_site_checks', { siteId }),
}

const code = (error: unknown) => (error as { data?: { code?: string } }).data?.code ?? error

describe("no call reaches another organization's site", () => {
  it('has a call for every tool that takes an ID', () => {
    expect(Object.keys(calls).filter((name) => name.includes('_'))).toEqual(
      tools.catalog.map(({ name }) => name).filter((name) => name !== 'check_approval'),
    )
  })

  // One row per call, with the one code it must fail with.
  it.each([
    ['triggerCheck', 'NOT_FOUND'],
    ['listChecks', 'NOT_FOUND'],
    ['trigger_site_check', 'NOT_FOUND'],
    ['list_site_checks', 'NOT_FOUND'],
  ])('%s at the canary site fails with %s', async (name, expected) => {
    const { t, shop, canary } = await setup()
    const a = await actor(t)
    await expect(calls[name]!(t, a, canary).then(() => 'no error', code)).resolves.toBe(expected)
    // Nothing is queued, charged or waiting for a person, even after the job runs.
    await runScheduled(t)
    await expect(t.run((ctx) => ctx.db.query('siteChecks').collect())).resolves.toEqual([])
    await expect(t.run((ctx) => ctx.db.query('approvals').collect())).resolves.toEqual([])
    // The positive control: the same call through the same path succeeds for Ann's own site.
    await expect(calls[name]!(t, a, shop)).resolves.toBeDefined()
  })
})
