import { v } from 'convex/values'

import type { Id } from './_generated/dataModel'
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server'
import { MCP_SCOPES, isMcpScope } from './mcp/scopes'

const mcpScopeValidator = v.union(v.literal(MCP_SCOPES[0]), v.literal(MCP_SCOPES[1]))

async function requireFixtureUser(ctx: MutationCtx, authUserId: string) {
  const user = await ctx.db
    .query('users')
    .withIndex('by_auth_id', (q) => q.eq('authId', authUserId))
    .unique()
  if (!user || !user.oauthAdmin) throw new Error('MCP_ADMIN_USER_NOT_FOUND')
  return user
}

async function requireFixtureMembership(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizationId: Id<'organizations'>,
) {
  const membership = await ctx.db
    .query('memberships')
    .withIndex('by_org_user', (q) => q.eq('organizationId', organizationId).eq('userId', userId))
    .unique()
  if (!membership) throw new Error('MCP_FIXTURE_PROFILE_DRIFT')
  return membership
}

async function requireFixtureDelegation(ctx: MutationCtx, userId: Id<'users'>, clientId: string) {
  const delegation = await ctx.db
    .query('delegations')
    .withIndex('by_user_client', (q) => q.eq('userId', userId).eq('clientId', clientId))
    .unique()
  if (!delegation) throw new Error('MCP_FIXTURE_PROFILE_DRIFT')
  return delegation
}

export const hasOAuthAdminPrivilege = internalQuery({
  args: { authUserId: v.string() },
  handler: async (ctx, { authUserId }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authUserId))
      .unique()
    return user?.active === true && user.oauthAdmin === true
  },
})

/** Bootstrap-only operator control. Invoke from the Convex CLI or dashboard. */
export const setOAuthAdministratorByEmail = internalMutation({
  args: { email: v.string(), enabled: v.boolean() },
  handler: async (ctx, { email, enabled }) => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || normalizedEmail !== email) throw new Error('MCP_ADMIN_EMAIL_INVALID')
    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', normalizedEmail))
      .unique()
    if (!user || !user.active) throw new Error('MCP_ADMIN_USER_NOT_FOUND')
    await ctx.db.patch(user._id, { oauthAdmin: enabled })
    return { authUserId: user.authId, enabled }
  },
})

/** App-owned fixture grants. OAuth consent remains necessary but never sufficient. */
export const grantFixtureDelegations = internalMutation({
  args: { authUserId: v.string(), clientIds: v.array(v.string()) },
  handler: async (ctx, { authUserId, clientIds }) => {
    const uniqueClientIds = [...new Set(clientIds)]
    if (
      uniqueClientIds.length < 2 ||
      uniqueClientIds.length > 7 ||
      uniqueClientIds.some((clientId) => clientId.length === 0 || clientId.length > 256)
    ) {
      throw new Error('MCP_FIXTURE_CLIENT_PROFILE_INVALID')
    }
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authUserId))
      .unique()
    if (!user || !user.active || !user.oauthAdmin) throw new Error('MCP_ADMIN_USER_NOT_FOUND')

    const existing = await Promise.all(
      uniqueClientIds.map((clientId) =>
        ctx.db
          .query('delegations')
          .withIndex('by_user_client', (q) => q.eq('userId', user._id).eq('clientId', clientId))
          .unique(),
      ),
    )
    const organizationIds = new Set(
      existing.flatMap((delegation) => (delegation ? [String(delegation.organizationId)] : [])),
    )
    if (organizationIds.size > 1) throw new Error('MCP_FIXTURE_PROFILE_DRIFT')
    const organizationId =
      existing.find((delegation) => delegation)?.organizationId ??
      (await ctx.db.insert('organizations', { name: 'MCP interoperability fixture' }))

    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', organizationId).eq('userId', user._id),
      )
      .unique()
    if (membership) {
      await ctx.db.patch(membership._id, { role: 'owner', status: 'active' })
    } else {
      await ctx.db.insert('memberships', {
        organizationId,
        role: 'owner',
        status: 'active',
        userId: user._id,
      })
    }

    const expiresAt = Date.now() + 24 * 60 * 60_000
    for (const [index, clientId] of uniqueClientIds.entries()) {
      const delegation = existing[index]
      if (delegation) {
        await ctx.db.patch(delegation._id, {
          expiresAt,
          scopes: [...MCP_SCOPES],
          status: 'active',
        })
      } else {
        await ctx.db.insert('delegations', {
          clientId,
          expiresAt,
          organizationId,
          scopes: [...MCP_SCOPES],
          status: 'active',
          userId: user._id,
        })
      }
    }
    return { organizationId }
  },
})

/** Internal-only controls used by the real-backend authorization evidence. */
export const createFixtureAlternateOrganization = internalMutation({
  args: { authUserId: v.string() },
  handler: async (ctx, { authUserId }) => {
    await requireFixtureUser(ctx, authUserId)
    return await ctx.db.insert('organizations', { name: 'MCP alternate authorization tenant' })
  },
})

export const setFixtureUserActive = internalMutation({
  args: { active: v.boolean(), authUserId: v.string() },
  handler: async (ctx, { active, authUserId }) => {
    const user = await requireFixtureUser(ctx, authUserId)
    await ctx.db.patch(user._id, { active })
  },
})

export const setFixtureMembership = internalMutation({
  args: {
    authUserId: v.string(),
    organizationId: v.id('organizations'),
    role: v.union(v.literal('owner'), v.literal('admin'), v.literal('member'), v.literal('viewer')),
    status: v.union(v.literal('active'), v.literal('removed')),
  },
  handler: async (ctx, { authUserId, organizationId, role, status }) => {
    const user = await requireFixtureUser(ctx, authUserId)
    const membership = await requireFixtureMembership(ctx, user._id, organizationId)
    await ctx.db.patch(membership._id, { role, status })
  },
})

export const setFixtureDelegation = internalMutation({
  args: {
    authUserId: v.string(),
    clientId: v.string(),
    organizationId: v.id('organizations'),
    scopes: v.array(mcpScopeValidator),
    status: v.union(v.literal('active'), v.literal('revoked')),
  },
  handler: async (ctx, { authUserId, clientId, organizationId, scopes, status }) => {
    if (
      scopes.length > MCP_SCOPES.length ||
      scopes.some((scope) => !isMcpScope(scope))
    ) {
      throw new Error('MCP_FIXTURE_SCOPE_INVALID')
    }
    const user = await requireFixtureUser(ctx, authUserId)
    const delegation = await requireFixtureDelegation(ctx, user._id, clientId)
    await ctx.db.patch(delegation._id, {
      expiresAt: Date.now() + 24 * 60 * 60_000,
      organizationId,
      scopes,
      status,
    })
  },
})

export const setFixtureProjectOrganization = internalMutation({
  args: {
    authUserId: v.string(),
    organizationId: v.id('organizations'),
    projectId: v.id('projects'),
  },
  handler: async (ctx, { authUserId, organizationId, projectId }) => {
    await requireFixtureUser(ctx, authUserId)
    const project = await ctx.db.get(projectId)
    if (!project) throw new Error('MCP_FIXTURE_PROJECT_NOT_FOUND')
    await ctx.db.patch(projectId, { organizationId })
  },
})

export const readFixtureDestructiveState = internalQuery({
  args: {
    approvalIds: v.array(v.id('approvals')),
    projectIds: v.array(v.id('projects')),
  },
  handler: async (ctx, { approvalIds, projectIds }) => {
    if (approvalIds.length > 4 || projectIds.length > 4) {
      throw new Error('MCP_FIXTURE_EVIDENCE_BOUND_EXCEEDED')
    }
    const [approvals, projects] = await Promise.all([
      Promise.all(approvalIds.map((id) => ctx.db.get(id))),
      Promise.all(projectIds.map((id) => ctx.db.get(id))),
    ])
    return {
      approvals: approvals.map((approval) =>
        approval
          ? {
              exists: true,
              hasUsedAt: typeof approval.usedAt === 'number',
              status: approval.status,
            }
          : { exists: false },
      ),
      projects: projects.map((project) =>
        project
          ? {
              exists: true,
              hasDeletedAt: typeof project.deletedAt === 'number',
              status: project.status,
            }
          : { exists: false },
      ),
    }
  },
})
