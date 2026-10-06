// The starter's tools against the real Better Auth component: every tool call re-checks the
// live grant (session, client, consent), the app user and the organization role in Convex.
// The door that turns a host's request into these calls is tested in @lupinum/better-convex-agents.

import type { ComponentApi } from '@lupinum/better-convex-nuxt/better-auth/_generated/component.js'
import type { BetterConvexMcpPrincipal } from '@lupinum/better-convex-nuxt/better-auth/server'
import { anyApi, componentsGeneric } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initConvexTest } from './test.setup'

const adapter = (componentsGeneric() as unknown as { betterAuth: ComponentApi<'betterAuth'> })
  .betterAuth.adapter
const agents = anyApi.agents
const connections = anyApi.connections

const siteUrl = 'https://starter-app.example.test'
const issuer = `${siteUrl}/api/auth`
const resource = 'https://starter-deployment.example.test/mcp'
const grantScopes = ['mcp:read', 'mcp:write']

type Test = ReturnType<typeof initConvexTest>

async function create(test: Test, model: string, data: Record<string, unknown>) {
  await test.mutation(adapter.create, { model, data })
}

/** One Better Auth user with a live session, consent to `client-1`, and an app projection. */
async function createGrantedUser(test: Test, authId: string) {
  const now = Date.now()
  await create(test, 'user', {
    id: authId,
    name: authId,
    email: `${authId}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await create(test, 'session', {
    id: `${authId}-session`,
    userId: authId,
    token: `${authId}-session-token`,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 3_600_000,
  })
  await create(test, 'oauthConsent', {
    id: `${authId}-consent`,
    clientId: 'client-1',
    userId: authId,
    resources: [resource],
    scopes: grantScopes,
    createdAt: now,
  })
  return await test.run((ctx) =>
    ctx.db.insert('users', { authId, email: `${authId}@example.test`, name: authId, active: true }),
  )
}

function principalFor(authId: string, scopes = grantScopes): BetterConvexMcpPrincipal {
  return {
    kind: 'oauth',
    userId: authId,
    clientId: 'client-1',
    scopes,
    sessionId: `${authId}-session`,
    grantId: `${authId}-consent`,
    issuer,
    resource,
    expiresAt: Math.floor(Date.now() / 1_000) + 300,
  }
}

async function setup() {
  const test = initConvexTest()
  await create(test, 'oauthResource', {
    id: 'resource-row',
    identifier: resource,
    name: 'Project agent',
    allowedScopes: [...grantScopes, 'offline_access'],
    disabled: false,
  })
  await create(test, 'oauthClient', {
    id: 'client-row',
    clientId: 'client-1',
    name: 'Claude',
    disabled: false,
    redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    scopes: [...grantScopes, 'offline_access'],
  })
  await create(test, 'oauthClientResource', {
    id: 'client-link',
    clientId: 'client-1',
    resourceId: resource,
  })
  const userId = await createGrantedUser(test, 'alice')
  const ids = await test.run(async (ctx) => {
    const organizationId = await ctx.db.insert('organizations', { name: 'Acme' })
    const otherOrganizationId = await ctx.db.insert('organizations', { name: 'Other' })
    const membershipId = await ctx.db.insert('memberships', {
      organizationId,
      userId,
      role: 'admin',
      status: 'active',
    })
    const projectId = await ctx.db.insert('projects', {
      organizationId,
      name: 'Roadmap',
      status: 'active',
      createdBy: userId,
    })
    return { membershipId, organizationId, otherOrganizationId, projectId }
  })
  const principal = principalFor('alice')
  const session = test.withIdentity({
    subject: 'alice',
    sid: 'alice-session',
    token_use: 'convex-session',
  })
  /** One tool call as the MCP door makes it, with the verified principal of a host. */
  const tool = (name: string, input: Record<string, unknown>, from = principal) => {
    const call = { caller: { door: 'mcp', principal: from }, input }
    return name === 'search_projects' || name === 'list_organizations' || name === 'check_approval'
      ? test.query(agents[name]!, call)
      : test.mutation(agents[name]!, call)
  }
  return { test, principal, session, userId, tool, ...ids }
}

type Setup = Awaited<ReturnType<typeof setup>>
const code = (error: unknown) => (error as { data?: { code?: string } }).data?.code
const failure = (promise: Promise<unknown>) => promise.then(() => 'no error', code)

beforeEach(() => {
  vi.stubEnv('SITE_URL', siteUrl)
  vi.stubEnv('CONVEX_SITE_URL', new URL(resource).origin)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('MCP starter authorization', () => {
  it('runs a tool for a live grant and a current membership; archiving waits for a person', async () => {
    const { tool, session, organizationId, projectId, test } = await setup()

    await expect(tool('list_organizations', {})).resolves.toMatchObject({
      result: { items: [{ id: organizationId, name: 'Acme', role: 'admin' }] },
    })
    await expect(tool('search_projects', { organizationId })).resolves.toMatchObject({
      result: { items: [{ id: projectId, name: 'Roadmap' }] },
    })
    await expect(
      tool('create_project', { organizationId, name: '  Launch  ' }),
    ).resolves.toMatchObject({ result: { name: 'Launch' } })

    const asked = (await tool('archive_project', { projectId })) as { approvalId: string }
    expect(asked).toMatchObject({
      status: 'needs_approval',
      summary: 'Archive the project "Roadmap".',
    })
    await expect(
      session.mutation(agents.approve, { approvalId: asked.approvalId }),
    ).resolves.toEqual({
      status: 'approved',
    })
    await expect(test.run((ctx) => ctx.db.get(projectId))).resolves.toMatchObject({
      status: 'archived',
    })
  })

  // Section 7 of the plan: logging out of the web app also disconnects the person's agents.
  it.each<[string, (context: Setup) => Promise<unknown>, string]>([
    [
      'the user disconnects the host',
      ({ session }) => session.mutation(connections.revoke, { clientId: 'client-1' }),
      'AGENT_DISABLED',
    ],
    [
      'the user signs out (the Better Auth session ends)',
      ({ test }) =>
        test.mutation(adapter.deleteOne, {
          model: 'session',
          where: [{ field: 'id', value: 'alice-session' }],
        }),
      'AGENT_DISABLED',
    ],
    [
      'the operator disables the client',
      ({ test }) =>
        test.mutation(adapter.updateOne, {
          model: 'oauthClient',
          where: [{ field: 'clientId', value: 'client-1' }],
          update: { disabled: true },
        }),
      'AGENT_DISABLED',
    ],
    [
      'the app suspends the user',
      ({ test, userId }) => test.run((ctx) => ctx.db.patch(userId, { active: false })),
      'ACCOUNT_DISABLED',
    ],
    [
      'the membership is removed',
      ({ test, membershipId }) =>
        test.run((ctx) => ctx.db.patch(membershipId, { status: 'removed' })),
      'NOT_FOUND',
    ],
  ])('denies the next call after %s', async (_name, revoke, expected) => {
    const context = await setup()
    const { tool, organizationId } = context
    await tool('search_projects', { organizationId })
    await revoke(context)
    await expect(failure(tool('search_projects', { organizationId }))).resolves.toBe(expected)
  })

  it('cancels the open requests of a host the person disconnects', async () => {
    const { tool, session, projectId } = await setup()
    const asked = (await tool('archive_project', { projectId })) as { approvalId: string }
    await session.mutation(connections.revoke, { clientId: 'client-1' })
    await expect(session.query(agents.pending, {})).resolves.toEqual([])
    await expect(
      failure(session.mutation(agents.approve, { approvalId: asked.approvalId })),
    ).resolves.toBe('APPROVAL_NOT_FOUND')
  })

  it('reaches every organization with an active membership, up to its role, and no other', async () => {
    const { test, tool, userId, organizationId, otherOrganizationId } = await setup()
    const { viewerOrganizationId, formerOrganizationId } = await test.run(async (ctx) => {
      const viewerOrganizationId = await ctx.db.insert('organizations', { name: 'Viewer org' })
      const formerOrganizationId = await ctx.db.insert('organizations', { name: 'Former org' })
      await ctx.db.insert('memberships', {
        organizationId: viewerOrganizationId,
        userId,
        role: 'viewer',
        status: 'active',
      })
      await ctx.db.insert('memberships', {
        organizationId: formerOrganizationId,
        userId,
        role: 'owner',
        status: 'removed',
      })
      return { viewerOrganizationId, formerOrganizationId }
    })

    const listed = (await tool('list_organizations', {})) as {
      result: { items: { id: string; role: string }[] }
    }
    expect(listed.result.items.map(({ id, role }) => ({ id, role }))).toEqual(
      expect.arrayContaining([
        { id: organizationId, role: 'admin' },
        { id: viewerOrganizationId, role: 'viewer' },
      ]),
    )
    expect(listed.result.items).toHaveLength(2)

    // The same consent reads in the viewer organization but cannot write there.
    await expect(
      tool('search_projects', { organizationId: viewerOrganizationId }),
    ).resolves.toMatchObject({ result: { items: [] } })
    await expect(
      failure(tool('create_project', { organizationId: viewerOrganizationId, name: 'X' })),
    ).resolves.toBe('FORBIDDEN')
    for (const denied of [formerOrganizationId, otherOrganizationId]) {
      await expect(failure(tool('search_projects', { organizationId: denied }))).resolves.toBe(
        'NOT_FOUND',
      )
    }
  })

  it('needs the scope for a tool, and keeps a foreign project out of reach', async () => {
    const { test, tool, organizationId, otherOrganizationId, projectId } = await setup()
    await expect(
      failure(
        tool(
          'create_project',
          { organizationId, name: 'Blocked' },
          principalFor('alice', ['mcp:read']),
        ),
      ),
    ).resolves.toBe('FORBIDDEN')
    await expect(failure(tool('search_projects', { organizationId: 'not-an-id' }))).resolves.toBe(
      'INVALID_INPUT',
    )
    await test.run((ctx) => ctx.db.patch(projectId, { organizationId: otherOrganizationId }))
    await expect(failure(tool('archive_project', { projectId }))).resolves.toBe('NOT_FOUND')
  })

  it('lets an approver decide only with a live session', async () => {
    const { test, tool, session, projectId } = await setup()
    const asked = (await tool('archive_project', { projectId })) as { approvalId: string }
    await test.mutation(adapter.deleteOne, {
      model: 'session',
      where: [{ field: 'id', value: 'alice-session' }],
    })
    await expect(
      failure(session.mutation(agents.approve, { approvalId: asked.approvalId })),
    ).resolves.toBe('NOT_SIGNED_IN')
    await expect(test.run((ctx) => ctx.db.get(projectId))).resolves.toMatchObject({
      status: 'active',
    })
  })

  it('lists and revokes only the signed-in user’s own connections', async () => {
    const { test, tool, organizationId, session } = await setup()
    await createGrantedUser(test, 'bob')
    const bob = test.withIdentity({
      subject: 'bob',
      sid: 'bob-session',
      token_use: 'convex-session',
    })

    await expect(session.query(connections.list, {})).resolves.toEqual([
      expect.objectContaining({ clientId: 'client-1', clientName: 'Claude', scopes: grantScopes }),
    ])
    await bob.mutation(connections.revoke, { clientId: 'client-1' })
    await expect(bob.query(connections.list, {})).resolves.toEqual([])
    await expect(tool('search_projects', { organizationId })).resolves.toBeDefined()
  })
})
