import { callTool } from '@lupinum/better-convex-agents/test'
import { grantMcp, signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { describe, expect, it } from 'vitest'

import { api } from './_generated/api'
import { tools } from './agents'
import type * as projects from './projects'
import { initConvexTest } from './test.setup'

// Catches a forgotten tenant check, a former member who keeps access, a refusal that tells a
// stranger the row exists (FORBIDDEN where NOT_FOUND is due), and a tool that turns another
// organization's project into a request for approval. Bob's organization holds the canary
// project; Eve aims every operation and every tool at it.

type Test = ReturnType<typeof initConvexTest>
/** Eve's relation to Bob's organization. */
type Actor = 'stranger' | 'former member' | 'viewer'

/** An organization owned by `authId` with two projects, and an agent request to archive one. */
async function owner(t: Test, authId: string) {
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', {
      authId,
      email: `${authId}@example.com`,
      name: authId,
      active: true,
    })
    const organizationId = await ctx.db.insert('organizations', { name: `${authId}'s` })
    await ctx.db.insert('memberships', { organizationId, userId, role: 'owner', status: 'active' })
    const project = (name: string) =>
      ctx.db.insert('projects', { organizationId, name, status: 'active', createdBy: userId })
    return {
      userId,
      organizationId,
      projectId: await project(`${authId}'s project`),
      spareId: await project(`${authId}'s spare`),
    }
  })
  const web = await signInAs(t, authId)
  const principal = await grantMcp(t, authId, ['mcp:read', 'mcp:write'])
  const asked = await callTool(t, tools, principal, 'archive_project', { projectId: ids.spareId })
  if (asked.status !== 'needs_approval') throw new Error('The archive did not wait for a person.')
  return { ...ids, web, principal, approvalId: asked.approvalId }
}

async function setup(actor: Actor) {
  const t = initConvexTest()
  const bob = await owner(t, 'bob')
  const eve = await owner(t, 'eve')
  if (actor !== 'stranger')
    await t.run((ctx) =>
      ctx.db.insert('memberships', {
        organizationId: bob.organizationId,
        userId: eve.userId,
        ...(actor === 'viewer'
          ? { role: 'viewer' as const, status: 'active' as const }
          : { role: 'owner' as const, status: 'removed' as const }),
      }),
    )
  return { t, bob, eve }
}

type Owner = Awaited<ReturnType<typeof owner>>
/** One call by Eve, aimed at the IDs of `target`: Bob's, or her own for the positive control. */
type Call = (t: Test, eve: Owner, target: Owner) => Promise<unknown>
const paginationOpts = { numItems: 100, cursor: null }

// Every operation through the web client. A new operation fails to compile until it has a call.
const operations: Record<Exclude<keyof typeof projects, 'organizations'>, Call> = {
  search: (_t, eve, { organizationId }) =>
    eve.web.query(api.projects.search, { organizationId, paginationOpts }),
  create: (_t, eve, { organizationId }) =>
    eve.web.mutation(api.projects.create, { organizationId, name: 'Mine' }),
  rename: (_t, eve, { projectId }) =>
    eve.web.mutation(api.projects.rename, { projectId, name: 'Mine' }),
  archive: (_t, eve, { projectId }) => eve.web.mutation(api.projects.archive, { projectId }),
}

// Every tool that takes an ID, as a host calls it. A test below fails until a new tool has a call.
const toolCalls: Record<string, Call> = {
  search_projects: (t, eve, { organizationId }) =>
    callTool(t, tools, eve.principal, 'search_projects', { organizationId }),
  create_project: (t, eve, { organizationId }) =>
    callTool(t, tools, eve.principal, 'create_project', { organizationId, name: 'Mine' }),
  rename_project: (t, eve, { projectId }) =>
    callTool(t, tools, eve.principal, 'rename_project', { projectId, name: 'Mine' }),
  archive_project: (t, eve, { projectId }) =>
    callTool(t, tools, eve.principal, 'archive_project', { projectId }),
  check_approval: (t, eve, { approvalId }) =>
    callTool(t, tools, eve.principal, 'check_approval', { approvalId }),
}
const calls: Record<string, Call> = { ...operations, ...toolCalls }

const code = (error: unknown) => (error as { data?: { code?: string } }).data?.code ?? error

// One row per actor and call, with the one code the call must fail with. A viewer may read, so
// the viewer rows are the writes. The approval belongs to Bob's agent, whatever Eve's role.
const rows: [Actor, string, string][] = [
  ['stranger', 'search', 'NOT_FOUND'],
  ['stranger', 'create', 'NOT_FOUND'],
  ['stranger', 'rename', 'NOT_FOUND'],
  ['stranger', 'archive', 'NOT_FOUND'],
  ['stranger', 'search_projects', 'NOT_FOUND'],
  ['stranger', 'create_project', 'NOT_FOUND'],
  ['stranger', 'rename_project', 'NOT_FOUND'],
  ['stranger', 'archive_project', 'NOT_FOUND'],
  ['stranger', 'check_approval', 'APPROVAL_NOT_FOUND'],
  ['former member', 'search', 'NOT_FOUND'],
  ['former member', 'create', 'NOT_FOUND'],
  ['former member', 'rename', 'NOT_FOUND'],
  ['former member', 'archive', 'NOT_FOUND'],
  ['former member', 'search_projects', 'NOT_FOUND'],
  ['former member', 'create_project', 'NOT_FOUND'],
  ['former member', 'rename_project', 'NOT_FOUND'],
  ['former member', 'archive_project', 'NOT_FOUND'],
  ['former member', 'check_approval', 'APPROVAL_NOT_FOUND'],
  ['viewer', 'create', 'FORBIDDEN'],
  ['viewer', 'rename', 'FORBIDDEN'],
  ['viewer', 'archive', 'FORBIDDEN'],
  ['viewer', 'create_project', 'FORBIDDEN'],
  ['viewer', 'rename_project', 'FORBIDDEN'],
  ['viewer', 'archive_project', 'FORBIDDEN'],
  ['viewer', 'check_approval', 'APPROVAL_NOT_FOUND'],
]

describe('no call reaches another organization’s project', () => {
  it('has a call for every tool that takes an ID', () => {
    expect(Object.keys(toolCalls).sort()).toEqual(
      tools.catalog
        .map(({ name }) => name)
        .filter((name) => name !== 'list_organizations')
        .sort(),
    )
  })

  it.each(rows)('a %s: %s fails with %s', async (actor, name, expected) => {
    const { t, bob, eve } = await setup(actor)
    const call = calls[name]!
    const state = () =>
      t.run(async (ctx) => ({
        projects: await ctx.db.query('projects').collect(),
        approvals: await ctx.db.query('approvals').collect(),
      }))
    const before = await state()

    await expect(call(t, eve, bob).then(() => 'no error', code)).resolves.toBe(expected)
    // Nothing changed: no project renamed, archived or added, and no new request for a person.
    await expect(state()).resolves.toEqual(before)

    // The positive control: the same call through the same path succeeds with Eve's own IDs.
    // Without it, a call that fails for another reason (a wrong argument name) would pass.
    await expect(call(t, eve, eve)).resolves.toBeDefined()
  })

  it.each<[Actor, string[]]>([
    ['stranger', ['owner']],
    ['former member', ['owner']],
    ['viewer', ['owner', 'viewer']],
  ])('a %s lists only the organizations of active memberships', async (actor, roles) => {
    const { t, bob, eve } = await setup(actor)
    const listed = roles.map((role) => ({
      id: role === 'owner' ? eve.organizationId : bob.organizationId,
      role,
    }))
    const web = await eve.web.query(api.projects.organizations, { paginationOpts })
    expect(web.page.map(({ id, role }) => ({ id, role }))).toEqual(listed)
    await expect(
      callTool(t, tools, eve.principal, 'list_organizations', {}),
    ).resolves.toMatchObject({ status: 'done', result: { items: listed } })
  })
})
