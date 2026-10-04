/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { anyApi, componentsGeneric } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import type { BetterConvexMcpPrincipal } from '../../src/runtime/convex-auth/mcp-principal'
import schema from '../../starters/mcp-oauth-agent/convex/schema'

const rootModules = import.meta.glob('../../starters/mcp-oauth-agent/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const adapter = (componentsGeneric() as unknown as { betterAuth: ComponentApi<'betterAuth'> })
  .betterAuth.adapter
const projects = anyApi.projects
const connections = anyApi.connections

const siteUrl = 'https://starter-app.example.test'
const issuer = `${siteUrl}/api/auth`
const resource = 'https://starter-deployment.example.test/mcp'
const grantScopes = ['mcp:read', 'mcp:write']

type Test = ReturnType<typeof convexTest>

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
  const test = convexTest(schema, rootModules)
  test.registerComponent('betterAuth', authSchema, authModules)
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
  return { test, principal, session, userId, ...ids }
}

async function requestDeletion(context: Awaited<ReturnType<typeof setup>>) {
  const { test, principal, organizationId, projectId } = context
  return (await test.mutation(projects.requestDelete, {
    principal,
    organizationId,
    projectId,
  })) as { approvalId: string }
}

beforeEach(() => {
  vi.stubEnv('SITE_URL', siteUrl)
  vi.stubEnv('CONVEX_SITE_URL', new URL(resource).origin)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('MCP starter authorization', () => {
  it('runs the full tool chain for a live grant and a current membership', async () => {
    const context = await setup()
    const { test, principal, session, organizationId, projectId } = context

    await expect(test.mutation(projects.listOrganizations, { principal })).resolves.toEqual({
      organizations: [{ id: organizationId, name: 'Acme', role: 'admin' }],
    })
    await expect(test.mutation(projects.list, { principal, organizationId })).resolves.toEqual({
      projects: [{ id: projectId, name: 'Roadmap' }],
    })
    await expect(
      test.mutation(projects.create, { principal, organizationId, name: '  Launch  ' }),
    ).resolves.toMatchObject({ name: 'Launch' })

    const { approvalId } = await requestDeletion(context)
    await expect(
      test.mutation(projects.remove, { principal, organizationId, projectId, approvalId }),
    ).rejects.toMatchObject({ data: { code: 'MCP_APPROVAL_REQUIRED' } })
    await session.mutation(anyApi.approvals.approveProjectDelete, { approvalId })
    await expect(
      test.mutation(projects.remove, { principal, organizationId, projectId, approvalId }),
    ).resolves.toEqual({ projectId, status: 'deleted' })
    await expect(test.run((ctx) => ctx.db.get(approvalId as never))).resolves.toMatchObject({
      status: 'used',
    })
  })

  it.each<[string, (context: Awaited<ReturnType<typeof setup>>) => Promise<unknown>, string]>([
    [
      'the user disconnects the host',
      ({ session }) => session.mutation(connections.revoke, { clientId: 'client-1' }),
      'MCP_ACCESS_DENIED',
    ],
    [
      'the Better Auth session ends',
      ({ test }) =>
        test.mutation(adapter.deleteOne, {
          model: 'session',
          where: [{ field: 'id', value: 'alice-session' }],
        }),
      'MCP_ACCESS_DENIED',
    ],
    [
      'the operator disables the client',
      ({ test }) =>
        test.mutation(adapter.updateOne, {
          model: 'oauthClient',
          where: [{ field: 'clientId', value: 'client-1' }],
          update: { disabled: true },
        }),
      'MCP_ACCESS_DENIED',
    ],
    [
      'the app suspends the user',
      ({ test, userId }) => test.run((ctx) => ctx.db.patch(userId, { active: false })),
      'MCP_ACCESS_REVOKED',
    ],
    [
      'the membership is removed',
      ({ test, membershipId }) =>
        test.run((ctx) => ctx.db.patch(membershipId, { status: 'removed' })),
      'MCP_ACCESS_REVOKED',
    ],
  ])('denies the next call after %s', async (_name, revoke, code) => {
    const context = await setup()
    const { test, principal, organizationId } = context
    await test.mutation(projects.list, { principal, organizationId })
    await revoke(context)
    await expect(test.mutation(projects.list, { principal, organizationId })).rejects.toMatchObject(
      { data: { code } },
    )
  })

  it('reaches every organization with an active membership, up to its role, and no other', async () => {
    const context = await setup()
    const { test, principal, userId, organizationId, otherOrganizationId } = context
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

    const { organizations } = (await test.mutation(projects.listOrganizations, {
      principal,
    })) as { organizations: { id: string; role: string }[] }
    expect(
      organizations.map(({ id, role }) => ({ id, role })).sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      [
        { id: organizationId, role: 'admin' },
        { id: viewerOrganizationId, role: 'viewer' },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    )

    // The same consent reads in the viewer organization but cannot write there.
    await expect(
      test.mutation(projects.list, { principal, organizationId: viewerOrganizationId }),
    ).resolves.toEqual({ projects: [] })
    await expect(
      test.mutation(projects.create, {
        principal,
        organizationId: viewerOrganizationId,
        name: 'X',
      }),
    ).rejects.toMatchObject({ data: { code: 'MCP_ACCESS_REVOKED' } })
    for (const denied of [formerOrganizationId, otherOrganizationId]) {
      await expect(
        test.mutation(projects.list, { principal, organizationId: denied }),
      ).rejects.toMatchObject({ data: { code: 'MCP_ACCESS_REVOKED' } })
    }

    // Disconnecting the host blocks every organization at once.
    await context.session.mutation(connections.revoke, { clientId: 'client-1' })
    for (const reachable of [organizationId, viewerOrganizationId]) {
      await expect(
        test.mutation(projects.list, { principal, organizationId: reachable }),
      ).rejects.toMatchObject({ data: { code: 'MCP_ACCESS_DENIED' } })
    }
  })

  it('enforces token scope, role, tenant, and project ownership', async () => {
    const context = await setup()
    const { test, principal, organizationId, otherOrganizationId, projectId, membershipId } =
      context
    await expect(
      test.mutation(projects.create, {
        principal: principalFor('alice', ['mcp:read']),
        organizationId,
        name: 'Blocked',
      }),
    ).rejects.toMatchObject({ data: { code: 'MCP_INSUFFICIENT_SCOPE' } })
    await expect(
      test.mutation(projects.list, { principal, organizationId: 'not-an-id' }),
    ).rejects.toMatchObject({ data: { code: 'MCP_INPUT_INVALID' } })

    await test.run((ctx) => ctx.db.patch(membershipId, { role: 'member' }))
    await expect(requestDeletion(context)).rejects.toMatchObject({
      data: { code: 'MCP_ACCESS_REVOKED' },
    })
    await test.run((ctx) => ctx.db.patch(membershipId, { role: 'owner' }))
    await test.run((ctx) => ctx.db.patch(projectId, { organizationId: otherOrganizationId }))
    await expect(requestDeletion(context)).rejects.toMatchObject({
      data: { code: 'MCP_RESOURCE_NOT_FOUND' },
    })
  })

  it('binds an approval to its project, user, client, and lifetime', async () => {
    const context = await setup()
    const { test, principal, session, organizationId, projectId } = context
    const { approvalId } = await requestDeletion(context)
    await session.mutation(anyApi.approvals.approveProjectDelete, { approvalId })
    const remove = (overrides: Partial<BetterConvexMcpPrincipal> = {}) =>
      test.mutation(projects.remove, {
        principal: { ...principal, ...overrides },
        organizationId,
        projectId,
        approvalId,
      })

    await test.run((ctx) => ctx.db.patch(approvalId as never, { clientId: 'client-2' } as never))
    await expect(remove()).rejects.toMatchObject({ data: { code: 'MCP_APPROVAL_REQUIRED' } })
    await test.run((ctx) =>
      ctx.db.patch(approvalId as never, { clientId: 'client-1', expiresAt: Date.now() } as never),
    )
    await expect(remove()).rejects.toMatchObject({ data: { code: 'MCP_APPROVAL_REQUIRED' } })
  })

  it('limits calls per user and client', async () => {
    const { test, principal, organizationId } = await setup()
    for (let call = 0; call < 20; call += 1) {
      await test.mutation(projects.create, { principal, organizationId, name: `Project ${call}` })
    }
    await expect(
      test.mutation(projects.create, { principal, organizationId, name: 'One too many' }),
    ).rejects.toMatchObject({ data: { code: 'MCP_RATE_LIMITED' } })
  })

  it('lists and revokes only the signed-in user’s own connections', async () => {
    const { test, principal, organizationId, session } = await setup()
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
    await expect(test.mutation(projects.list, { principal, organizationId })).resolves.toBeDefined()
  })
})
