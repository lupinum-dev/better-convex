import {
  mcpPrincipalValidator,
  type BetterConvexMcpPrincipal,
} from '@lupinum/better-convex-nuxt/better-auth/server'
import { ConvexError, v } from 'convex/values'

import type { Doc, Id, TableNames } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'
import { auth } from './auth'

/** Codes these functions raise. `convex/mcp.ts` shows them to the model with their message. */
export const PROJECT_ERROR_CODES = [
  'MCP_ACCESS_REVOKED',
  'MCP_APPROVAL_REQUIRED',
  'MCP_INPUT_INVALID',
  'MCP_RATE_LIMITED',
  'MCP_RESOURCE_NOT_FOUND',
] as const

function fail(code: (typeof PROJECT_ERROR_CODES)[number], message: string): never {
  throw new ConvexError({ code, message })
}

const ROLE_RANK = { viewer: 1, member: 2, admin: 3, owner: 4 } as const

/** The scope, minimum role, and per-minute call budget of each operation. */
const RULES = {
  listOrganizations: { scope: 'mcp:read', role: 'viewer', limit: 60 },
  list: { scope: 'mcp:read', role: 'viewer', limit: 60 },
  create: { scope: 'mcp:write', role: 'member', limit: 20 },
  requestDelete: { scope: 'mcp:write', role: 'admin', limit: 10 },
  remove: { scope: 'mcp:write', role: 'admin', limit: 10 },
} as const

function normalize<Table extends TableNames>(ctx: MutationCtx, table: Table, id: string) {
  return ctx.db.normalizeId(table, id) ?? fail('MCP_INPUT_INVALID', `The ${table} ID is invalid.`)
}

async function consumeRateLimit(ctx: MutationCtx, key: string, limit: number) {
  const now = Date.now()
  const row = await ctx.db
    .query('mcpRateLimits')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique()
  if (!row) return await ctx.db.insert('mcpRateLimits', { count: 1, key, windowStartedAt: now })
  if (now - row.windowStartedAt >= 60_000) {
    return await ctx.db.patch(row._id, { count: 1, windowStartedAt: now })
  }
  if (row.count >= limit) fail('MCP_RATE_LIMITED', 'Too many requests. Wait a minute.')
  await ctx.db.patch(row._id, { count: row.count + 1 })
}

/**
 * The first checks of every tool call, in the tool's own transaction: the
 * live OAuth grant and its scope, the active app user, and a per-user,
 * per-client rate limit.
 */
async function authorizeUser(
  ctx: MutationCtx,
  principal: BetterConvexMcpPrincipal,
  operation: keyof typeof RULES,
) {
  const rule = RULES[operation]
  await auth.requireMcpPrincipal(ctx, principal, { scope: rule.scope })
  const user = await ctx.db
    .query('users')
    .withIndex('by_auth_id', (q) => q.eq('authId', principal.userId))
    .unique()
  if (!user?.active) fail('MCP_ACCESS_REVOKED', 'This account can no longer use MCP.')
  await consumeRateLimit(ctx, `${principal.userId}:${principal.clientId}:${operation}`, rule.limit)
  return user
}

/** `authorizeUser`, then a current membership with at least the operation's role. */
async function authorize(
  ctx: MutationCtx,
  input: { principal: BetterConvexMcpPrincipal; organizationId: string },
  operation: Exclude<keyof typeof RULES, 'listOrganizations'>,
) {
  const user = await authorizeUser(ctx, input.principal, operation)
  const organizationId = normalize(ctx, 'organizations', input.organizationId)
  const membership = await ctx.db
    .query('memberships')
    .withIndex('by_org_user', (q) => q.eq('organizationId', organizationId).eq('userId', user._id))
    .unique()
  const role = RULES[operation].role
  if (membership?.status !== 'active' || ROLE_RANK[membership.role] < ROLE_RANK[role]) {
    fail('MCP_ACCESS_REVOKED', `This needs the ${role} role in the organization.`)
  }
  return { organizationId, user }
}

async function activeProject(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  projectId: string,
): Promise<Doc<'projects'>> {
  const project = await ctx.db.get(normalize(ctx, 'projects', projectId))
  if (project?.organizationId !== organizationId || project.status !== 'active') {
    fail('MCP_RESOURCE_NOT_FOUND', 'No active project with this ID is in the organization.')
  }
  return project
}

export const listOrganizations = internalMutation({
  args: { principal: mcpPrincipalValidator },
  handler: async (ctx, { principal }) => {
    const user = await authorizeUser(ctx, principal, 'listOrganizations')
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_user', (q) => q.eq('userId', user._id).eq('status', 'active'))
      .take(100)
    const organizations = await Promise.all(
      memberships.map(async ({ organizationId, role }) => {
        const organization = await ctx.db.get(organizationId)
        return { id: organizationId, name: organization?.name ?? '', role }
      }),
    )
    return { organizations }
  },
})

const orgArgs = { principal: mcpPrincipalValidator, organizationId: v.string() }
const projectArgs = { ...orgArgs, projectId: v.string() }

export const list = internalMutation({
  args: orgArgs,
  handler: async (ctx, args) => {
    const { organizationId } = await authorize(ctx, args, 'list')
    const projects = await ctx.db
      .query('projects')
      .withIndex('by_org_status', (q) =>
        q.eq('organizationId', organizationId).eq('status', 'active'),
      )
      .take(100)
    return { projects: projects.map(({ _id, name }) => ({ id: _id, name })) }
  },
})

export const create = internalMutation({
  args: { ...orgArgs, name: v.string() },
  handler: async (ctx, args) => {
    const { organizationId, user } = await authorize(ctx, args, 'create')
    const name = args.name.trim()
    if (!name || name.length > 100) fail('MCP_INPUT_INVALID', 'Use 1 to 100 characters.')
    const id = await ctx.db.insert('projects', {
      createdBy: user._id,
      name,
      organizationId,
      status: 'active',
    })
    return { id, name }
  },
})

/** Records a deletion request that a person must approve in the app. Changes no project. */
export const requestDelete = internalMutation({
  args: projectArgs,
  handler: async (ctx, args) => {
    const { organizationId, user } = await authorize(ctx, args, 'requestDelete')
    const project = await activeProject(ctx, organizationId, args.projectId)
    const approvalId = await ctx.db.insert('approvals', {
      clientId: args.principal.clientId,
      expiresAt: Date.now() + 10 * 60_000,
      operation: 'projects.delete',
      organizationId,
      projectId: project._id,
      status: 'pending',
      userId: user._id,
    })
    // The deletion is soft, so the app can restore the project.
    return {
      approvalId,
      project: { id: project._id, name: project.name },
      status: 'waiting_for_approval' as const,
    }
  },
})

/** Soft-deletes a project with an approval that a person granted for this user and client. */
export const remove = internalMutation({
  args: { ...projectArgs, approvalId: v.string() },
  handler: async (ctx, args) => {
    const { organizationId, user } = await authorize(ctx, args, 'remove')
    const project = await activeProject(ctx, organizationId, args.projectId)
    const approval = await ctx.db.get(normalize(ctx, 'approvals', args.approvalId))
    if (
      approval?.status !== 'approved' ||
      approval.expiresAt <= Date.now() ||
      approval.projectId !== project._id ||
      approval.userId !== user._id ||
      approval.clientId !== args.principal.clientId
    ) {
      fail('MCP_APPROVAL_REQUIRED', 'A person must approve this deletion in the app first.')
    }
    const now = Date.now()
    await ctx.db.patch(project._id, { deletedAt: now, status: 'deleted' })
    await ctx.db.patch(approval._id, { status: 'used', usedAt: now })
    return { projectId: project._id, status: 'deleted' as const }
  },
})
