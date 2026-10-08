// Test-only functions for the MCP OAuth starter. test/integration/harness.ts
// copies this file into the temporary starter copy as `convex/evidence.ts`;
// it is never part of the starter. Every export is internal, so only the
// deployment operator (`convex run`) can call it.
import { v } from 'convex/values'

import { components } from './_generated/api'
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server'
import { auth } from './auth'

const INSPECTOR_CALLBACK = 'http://localhost:6274/oauth/callback'
const MCP_REMOTE_CALLBACK = 'http://127.0.0.1:3334/oauth/callback'
const CONFIDENTIAL_CALLBACK = 'https://client.example.test/oauth/callback'
const SCOPES: [string, ...string[]] = ['mcp:read', 'mcp:write']

const TERMINAL_CLIENTS = {
  sessionDelete: 'MCP session-revocation evidence fixture',
  clientDisable: 'MCP client-disable evidence fixture',
  clientDelete: 'MCP client-delete evidence fixture',
  consentDelete: 'MCP consent-revocation evidence fixture',
  conformance: 'MCP least-scope conformance evidence fixture',
} as const

interface BetterAuthAdapter {
  create(input: { model: string; data: Record<string, unknown> }): Promise<unknown>
  deleteMany(input: {
    model: string
    where: Array<{ field: string; value: string }>
  }): Promise<unknown>
  update(input: {
    model: string
    update: Record<string, unknown>
    where: Array<{ field: string; value: string }>
  }): Promise<unknown>
}

async function betterAuthAdapter(ctx: MutationCtx): Promise<BetterAuthAdapter> {
  const instance = await auth.createAuth(ctx)
  return ((await instance.$context) as unknown as { adapter: BetterAuthAdapter }).adapter
}

function resource(ctx: MutationCtx): string {
  return auth.mcpAuthorization(ctx).resource.href
}

async function createPublicClient(ctx: MutationCtx, name: string, callback: string) {
  const { clientId } = await auth.oauthOperator.createPublicClient(ctx, {
    name,
    profile: `bcn-evidence-${name.toLowerCase().replaceAll(/[^a-z]+/gu, '-')}`,
    redirectUris: [callback],
    scopes: SCOPES,
  })
  return clientId
}

async function requireUser(ctx: MutationCtx, authUserId: string) {
  const user = await ctx.db
    .query('users')
    .withIndex('by_auth_id', (q) => q.eq('authId', authUserId))
    .unique()
  if (!user) throw new Error('MCP_EVIDENCE_USER_NOT_FOUND')
  return user
}

/** Two interoperability clients and one organization the fixture user owns. */
export const provision = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique()
    if (!user?.active) throw new Error('MCP_EVIDENCE_USER_NOT_FOUND')
    const inspector = await createPublicClient(
      ctx,
      'MCP Inspector evidence fixture',
      INSPECTOR_CALLBACK,
    )
    const mcpRemote = await createPublicClient(
      ctx,
      'mcp-remote evidence fixture',
      MCP_REMOTE_CALLBACK,
    )
    const organizationId = await ctx.db.insert('organizations', { name: 'MCP evidence fixture' })
    await ctx.db.insert('memberships', {
      organizationId,
      role: 'owner',
      status: 'active',
      userId: user._id,
    })
    return { clients: { inspector, mcpRemote }, organizationId, resource: resource(ctx) }
  },
})

/** One fresh client for each terminal revocation case. */
export const provisionTerminalClients = internalMutation({
  args: {},
  handler: async (ctx) => {
    const clients: Record<string, string> = {}
    for (const [key, name] of Object.entries(TERMINAL_CLIENTS)) {
      clients[key] = await createPublicClient(ctx, name, INSPECTOR_CALLBACK)
    }
    return { clients, resource: resource(ctx) }
  },
})

/**
 * A confidential `client_secret_basic` client for the authorization-code race.
 * The MCP profile denies client management through Better Auth endpoints, so
 * the fixture writes the row the provider would write, with a hashed secret.
 */
export const provisionConfidential = internalMutation({
  args: {},
  handler: async (ctx) => {
    const adapter = await betterAuthAdapter(ctx)
    const secretBytes = crypto.getRandomValues(new Uint8Array(32))
    const secret = btoa(String.fromCharCode(...secretBytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)),
    )
    const hashedSecret = btoa(String.fromCharCode(...digest))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')
    const clientId = crypto.randomUUID().replaceAll('-', '')
    const now = new Date(Math.floor(Date.now() / 1_000) * 1_000)
    await adapter.create({
      model: 'oauthClient',
      data: {
        applicationType: 'web',
        clientCredentialsScopes: [],
        clientDiscoveryId: null,
        clientId,
        clientSecret: hashedSecret,
        createdAt: now,
        disabled: false,
        dpopBoundAccessTokens: false,
        enableEndSession: false,
        grantTypes: ['authorization_code'],
        name: 'Confidential OAuth code security fixture',
        redirectUris: [CONFIDENTIAL_CALLBACK],
        requirePKCE: true,
        responseTypes: ['code'],
        scopes: SCOPES,
        skipConsent: false,
        softwareId: 'bcn-confidential-code-fixture',
        subjectType: 'public',
        tokenEndpointAuthMethod: 'client_secret_basic',
        updatedAt: now,
      },
    })
    await adapter.create({
      model: 'oauthClientResource',
      data: { clientId, createdAt: new Date(), resourceId: resource(ctx) },
    })
    return { client: { id: clientId, secret }, resource: resource(ctx) }
  },
})

export const createAlternateOrganization = internalMutation({
  args: {},
  handler: async (ctx) =>
    await ctx.db.insert('organizations', { name: 'MCP alternate evidence tenant' }),
})

export const setMembership = internalMutation({
  args: {
    authUserId: v.string(),
    organizationId: v.id('organizations'),
    role: v.union(v.literal('owner'), v.literal('admin'), v.literal('member'), v.literal('viewer')),
    status: v.union(v.literal('active'), v.literal('removed')),
  },
  handler: async (ctx, { authUserId, organizationId, role, status }) => {
    const user = await requireUser(ctx, authUserId)
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', organizationId).eq('userId', user._id),
      )
      .unique()
    if (!membership) throw new Error('MCP_EVIDENCE_MEMBERSHIP_NOT_FOUND')
    await ctx.db.patch(membership._id, { role, status })
  },
})

export const setUserActive = internalMutation({
  args: { active: v.boolean(), authUserId: v.string() },
  handler: async (ctx, { active, authUserId }) => {
    const user = await requireUser(ctx, authUserId)
    await ctx.db.patch(user._id, { active })
  },
})

export const setProjectOrganization = internalMutation({
  args: { organizationId: v.id('organizations'), projectId: v.id('projects') },
  handler: async (ctx, { organizationId, projectId }) => {
    if (!(await ctx.db.get(projectId))) throw new Error('MCP_EVIDENCE_PROJECT_NOT_FOUND')
    await ctx.db.patch(projectId, { organizationId })
  },
})

export const setClientDisabled = internalMutation({
  args: { clientId: v.string(), disabled: v.boolean() },
  handler: async (ctx, args) => await auth.oauthOperator.setClientDisabled(ctx, args),
})

export const deleteClient = internalMutation({
  args: { clientId: v.string() },
  handler: async (ctx, args) => await auth.oauthOperator.deleteClient(ctx, args),
})

/** The same revocation the starter's connections page performs for the signed-in user. */
export const revokeConnection = internalMutation({
  args: { authUserId: v.string(), clientId: v.string() },
  handler: async (ctx, { authUserId, clientId }) => {
    const { revoked } = await auth.oauthConnections.revoke(ctx, { userId: authUserId, clientId })
    if (!revoked) throw new Error('MCP_EVIDENCE_CONNECTION_NOT_FOUND')
  },
})

export const setResourceDisabled = internalMutation({
  args: { disabled: v.boolean() },
  handler: async (ctx, { disabled }) => {
    const adapter = await betterAuthAdapter(ctx)
    const updated = await adapter.update({
      model: 'oauthResource',
      update: { disabled, updatedAt: new Date() },
      where: [{ field: 'identifier', value: resource(ctx) }],
    })
    if (!updated) throw new Error('MCP_EVIDENCE_RESOURCE_NOT_FOUND')
  },
})

export const setClientResourceLinked = internalMutation({
  args: { clientId: v.string(), linked: v.boolean() },
  handler: async (ctx, { clientId, linked }) => {
    const adapter = await betterAuthAdapter(ctx)
    if (linked) {
      await adapter.create({
        model: 'oauthClientResource',
        data: { clientId, createdAt: new Date(), resourceId: resource(ctx) },
      })
    } else {
      await adapter.deleteMany({
        model: 'oauthClientResource',
        where: [
          { field: 'clientId', value: clientId },
          { field: 'resourceId', value: resource(ctx) },
        ],
      })
    }
  },
})

/** Where an approved agent request and its project stand. */
export const readApprovalState = internalQuery({
  args: { approvalId: v.id('approvals'), projectId: v.id('projects') },
  handler: async (ctx, { approvalId, projectId }) => {
    const [approval, project] = await Promise.all([ctx.db.get(approvalId), ctx.db.get(projectId)])
    return {
      approval: approval?.status ?? null,
      project: project
        ? { status: project.status, archived: project.archivedAt !== undefined }
        : null,
    }
  },
})

/** Exact, non-secret persisted-token evidence for the local OAuth security gate. */
export const countCredentialRows = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [accessTokens, refreshTokens, idTokens] = await Promise.all([
      ctx.runQuery(components.betterAuth.adapter.count, { model: 'oauthAccessToken' }),
      ctx.runQuery(components.betterAuth.adapter.count, { model: 'oauthRefreshToken' }),
      ctx.runQuery(components.betterAuth.adapter.count, {
        model: 'account',
        where: [{ field: 'idToken', operator: 'ne', value: null }],
      }),
    ])
    if (
      [accessTokens, idTokens, refreshTokens].some(
        (count) => !Number.isSafeInteger(count) || count < 0 || count > 100,
      )
    ) {
      throw new Error('MCP_EVIDENCE_BOUND_EXCEEDED')
    }
    return { accessTokens, idTokens, refreshTokens }
  },
})
