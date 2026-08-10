import { ConvexError, v } from 'convex/values'

import type { DataModel, Doc, Id } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'
import { authComponent } from './auth'
import {
  McpAuthorizationError,
  assertLiveMcpAuthorization,
  deserializePrincipal,
  type LiveAuthorizationRequirement,
  type LiveAuthorizationState,
  type SerializableOAuthPrincipal,
} from './mcp/policy'
import { MCP_SCOPES } from './mcp/scopes'

const mcpScopeValidator = v.union(v.literal(MCP_SCOPES[0]), v.literal(MCP_SCOPES[1]))

const principalValidator = v.object({
  clientId: v.string(),
  issuer: v.string(),
  resource: v.string(),
  scopes: v.array(mcpScopeValidator),
  sessionId: v.string(),
  subject: v.string(),
})

type TableName = keyof DataModel

function requireId<Table extends TableName>(
  ctx: MutationCtx,
  table: Table,
  value: string,
): Id<Table> {
  const id = ctx.db.normalizeId(table, value)
  if (!id) throw new ConvexError('MCP_INPUT_INVALID')
  return id
}

async function loadLiveState(
  ctx: MutationCtx,
  principal: SerializableOAuthPrincipal,
  organizationId: Id<'organizations'>,
  projectId?: Id<'projects'>,
  approvalId?: Id<'approvals'>,
): Promise<LiveAuthorizationState> {
  const user = await ctx.db
    .query('users')
    .withIndex('by_auth_id', (q) => q.eq('authId', principal.subject))
    .unique()
  const membership = user
    ? await ctx.db
        .query('memberships')
        .withIndex('by_org_user', (q) =>
          q.eq('organizationId', organizationId).eq('userId', user._id),
        )
        .unique()
    : null
  const delegation = user
    ? await ctx.db
        .query('delegations')
        .withIndex('by_org_user_client', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('userId', user._id)
            .eq('clientId', principal.clientId),
        )
        .unique()
    : null
  const project = projectId ? await ctx.db.get(projectId) : null
  const approval = approvalId ? await ctx.db.get(approvalId) : null

  return {
    approval: approval
      ? {
          clientId: approval.clientId,
          expiresAt: approval.expiresAt,
          operation: approval.operation,
          organizationId: String(approval.organizationId),
          projectId: String(approval.projectId),
          status: approval.status,
          userId: String(approval.userId),
        }
      : null,
    delegation: delegation
      ? {
          clientId: delegation.clientId,
          expiresAt: delegation.expiresAt,
          organizationId: String(delegation.organizationId),
          scopes: delegation.scopes,
          status: delegation.status,
          userId: String(delegation.userId),
        }
      : null,
    membership: membership
      ? {
          organizationId: String(membership.organizationId),
          role: membership.role,
          status: membership.status,
          userId: String(membership.userId),
        }
      : null,
    project: project
      ? {
          id: String(project._id),
          organizationId: String(project.organizationId),
          status: project.status,
        }
      : null,
    user: user ? { active: user.active, authId: user.authId, id: String(user._id) } : null,
  }
}

async function requireLiveAuthorization(
  ctx: MutationCtx,
  principal: SerializableOAuthPrincipal,
  requirement: LiveAuthorizationRequirement & {
    approvalId?: Id<'approvals'>
    organizationId: Id<'organizations'>
    projectId?: Id<'projects'>
  },
) {
  if (!(await authComponent.validateOAuthAccess(ctx, principal))) {
    throw new ConvexError('MCP_ACCESS_REVOKED')
  }
  const state = await loadLiveState(
    ctx,
    principal,
    requirement.organizationId,
    requirement.projectId,
    requirement.approvalId,
  )
  try {
    return assertLiveMcpAuthorization(state, deserializePrincipal(principal), {
      ...requirement,
      approvalId: requirement.approvalId ? String(requirement.approvalId) : undefined,
      organizationId: String(requirement.organizationId),
      projectId: requirement.projectId ? String(requirement.projectId) : undefined,
    })
  } catch (error) {
    if (error instanceof McpAuthorizationError) throw new ConvexError(error.code)
    throw error
  }
}

async function consumeRateLimit(
  ctx: MutationCtx,
  principal: SerializableOAuthPrincipal,
  operation: string,
  limit: number,
) {
  const now = Date.now()
  const key = `${principal.subject}:${principal.clientId}:${operation}`
  const row = await ctx.db
    .query('mcpRateLimits')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique()
  if (!row || now - row.windowStartedAt >= 60_000) {
    if (row) await ctx.db.patch(row._id, { count: 1, windowStartedAt: now })
    else await ctx.db.insert('mcpRateLimits', { count: 1, key, windowStartedAt: now })
    return
  }
  if (row.count >= limit) throw new ConvexError('MCP_RATE_LIMITED')
  await ctx.db.patch(row._id, { count: row.count + 1 })
}

const commonArgs = {
  organizationId: v.string(),
  principal: principalValidator,
}

/** Read and authorization execute in this one tool-specific mutation. */
export const listProjects = internalMutation({
  args: commonArgs,
  handler: async (ctx, args) => {
    const organizationId = requireId(ctx, 'organizations', args.organizationId)
    await requireLiveAuthorization(ctx, args.principal, {
      minimumRole: 'viewer',
      organizationId,
      scope: 'mcp:read',
    })
    await consumeRateLimit(ctx, args.principal, 'projects.list', 60)
    const projects = await ctx.db
      .query('projects')
      .withIndex('by_org_status', (q) =>
        q.eq('organizationId', organizationId).eq('status', 'active'),
      )
      .take(100)
    return projects.map((project) => ({ id: project._id, name: project.name }))
  },
})

export const createProject = internalMutation({
  args: { ...commonArgs, name: v.string() },
  handler: async (ctx, args) => {
    const name = args.name.trim()
    if (!name || name.length > 100) throw new ConvexError('MCP_INPUT_INVALID')
    const organizationId = requireId(ctx, 'organizations', args.organizationId)
    const authorized = await requireLiveAuthorization(ctx, args.principal, {
      minimumRole: 'member',
      organizationId,
      scope: 'mcp:write',
    })
    await consumeRateLimit(ctx, args.principal, 'projects.create', 20)
    const projectId = await ctx.db.insert('projects', {
      createdBy: authorized.userId as Id<'users'>,
      name,
      organizationId,
      status: 'active',
    })
    return { id: projectId, name }
  },
})

export const previewProjectDelete = internalMutation({
  args: { ...commonArgs, projectId: v.string() },
  handler: async (ctx, args) => {
    const organizationId = requireId(ctx, 'organizations', args.organizationId)
    const projectId = requireId(ctx, 'projects', args.projectId)
    await requireLiveAuthorization(ctx, args.principal, {
      minimumRole: 'admin',
      organizationId,
      projectId,
      scope: 'mcp:write',
    })
    await consumeRateLimit(ctx, args.principal, 'projects.delete.preview', 20)
    const project = (await ctx.db.get(projectId)) as Doc<'projects'>
    return {
      operation: 'projects.delete',
      project: { id: project._id, name: project.name },
      requiresApproval: true,
      reversible: true,
      status: 'ready',
    }
  },
})

export const requestProjectDeleteApproval = internalMutation({
  args: { ...commonArgs, projectId: v.string() },
  handler: async (ctx, args) => {
    const organizationId = requireId(ctx, 'organizations', args.organizationId)
    const projectId = requireId(ctx, 'projects', args.projectId)
    const authorized = await requireLiveAuthorization(ctx, args.principal, {
      minimumRole: 'admin',
      organizationId,
      projectId,
      scope: 'mcp:write',
    })
    await consumeRateLimit(ctx, args.principal, 'projects.delete.requestApproval', 10)
    const approvalId = await ctx.db.insert('approvals', {
      clientId: args.principal.clientId,
      expiresAt: Date.now() + 10 * 60_000,
      operation: 'projects.delete',
      organizationId,
      projectId,
      status: 'pending',
      userId: authorized.userId as Id<'users'>,
    })
    return { approvalId, status: 'waiting_for_approval' }
  },
})

export const executeProjectDelete = internalMutation({
  args: {
    ...commonArgs,
    approvalId: v.string(),
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    const approvalId = requireId(ctx, 'approvals', args.approvalId)
    const organizationId = requireId(ctx, 'organizations', args.organizationId)
    const projectId = requireId(ctx, 'projects', args.projectId)
    await requireLiveAuthorization(ctx, args.principal, {
      approvalId,
      minimumRole: 'admin',
      organizationId,
      projectId,
      scope: 'mcp:write',
    })
    await consumeRateLimit(ctx, args.principal, 'projects.delete.execute', 10)
    const now = Date.now()
    await ctx.db.patch(projectId, { deletedAt: now, status: 'deleted' })
    await ctx.db.patch(approvalId, { status: 'used', usedAt: now })
    return { projectId, status: 'deleted' }
  },
})
