import { callTool } from '@lupinum/better-convex-agents/test'
import { grantMcp, signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { expect, it } from 'vitest'

import { api } from './_generated/api'
import { tools } from './agents'
import { initConvexTest } from './test.setup'

// Catches a scope that unlocks a write tool by accident, and an approval rule that was dropped.
// The literal below is the agent surface: review each change to it like a change to the policy.
it('gives agents these tools, with these scopes and approvals', () => {
  expect(
    tools.catalog.map(({ name, kind, scopes, approval }) => ({ name, kind, scopes, approval })),
  ).toEqual([
    { name: 'list_organizations', kind: 'query', scopes: ['mcp:read'], approval: 'never' },
    { name: 'search_projects', kind: 'query', scopes: ['mcp:read'], approval: 'never' },
    { name: 'create_project', kind: 'mutation', scopes: ['mcp:write'], approval: 'never' },
    { name: 'rename_project', kind: 'mutation', scopes: ['mcp:write'], approval: 'never' },
    { name: 'archive_project', kind: 'mutation', scopes: ['mcp:write'], approval: 'always' },
    { name: 'check_approval', kind: 'query', scopes: [], approval: 'never' },
  ])
})

// Catches a member or viewer who can approve a teammate's agent request, and a former admin
// who still can. Ann's agent asks to archive; Pat tries to approve it.
it.each([
  ['an owner', 'approved', 'owner', 'active'],
  ['an admin', 'approved', 'admin', 'active'],
  ['a member', 'APPROVAL_NOT_FOUND', 'member', 'active'],
  ['a viewer', 'APPROVAL_NOT_FOUND', 'viewer', 'active'],
  ['a former admin', 'APPROVAL_NOT_FOUND', 'admin', 'removed'],
  ['a stranger', 'APPROVAL_NOT_FOUND', null, null],
] as const)('%s who approves gets %s', async (_name, expected, role, status) => {
  const t = initConvexTest()
  const { organizationId, projectId } = await t.run(async (ctx) => {
    const user = (authId: string) =>
      ctx.db.insert('users', { authId, email: `${authId}@example.com`, name: authId, active: true })
    const organizationId = await ctx.db.insert('organizations', { name: 'Acme' })
    const ann = await user('ann')
    await ctx.db.insert('memberships', {
      organizationId,
      userId: ann,
      role: 'admin',
      status: 'active',
    })
    const pat = await user('pat')
    if (role && status)
      await ctx.db.insert('memberships', { organizationId, userId: pat, role, status })
    const projectId = await ctx.db.insert('projects', {
      organizationId,
      name: 'Roadmap',
      status: 'active',
      createdBy: ann,
    })
    return { organizationId, projectId }
  })
  const agent = await grantMcp(t, 'ann', ['mcp:read', 'mcp:write'])
  const asked = await callTool(t, tools, agent, 'archive_project', { projectId })
  if (asked.status !== 'needs_approval') throw new Error('The archive did not wait for a person.')

  const pat = await signInAs(t, 'pat')
  const outcome = await pat.mutation(api.agents.approve, { approvalId: asked.approvalId }).then(
    ({ status }) => status,
    (error: { data?: { code?: string } }) => error.data?.code ?? error,
  )
  expect(outcome).toBe(expected)
  // A refused approval leaves the project as it was.
  await expect(t.run((ctx) => ctx.db.get(projectId))).resolves.toMatchObject({
    organizationId,
    status: expected === 'approved' ? 'archived' : 'active',
  })
})
