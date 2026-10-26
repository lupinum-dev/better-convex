import { calculateRateLimit } from '@convex-dev/rate-limiter'
import { paginationOptsValidator } from 'convex/server'
import { ConvexError, v } from 'convex/values'

import { createProjectInputSchema, renameProjectInputSchema } from '../shared/inputSchemas'
import { internalMutation, mutation, query } from './_generated/server'
import { writeAuditEvent } from './lib/audit'
import { requireProjectAccessById, requireProjectTeamAccess } from './lib/authz'
import { requireBoundedPageSize } from './lib/pagination'
import { organizationActorRateLimitKey, rateLimiter } from './lib/rateLimits'
import { parseWithConvexError } from './lib/validation'
import { projectStatus } from './schema'

const softDeleteRetentionMs = 30 * 24 * 60 * 60 * 1000

function formatRetryDuration(ms: number) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes <= 0) return `${seconds}s`
  if (seconds === 0) return `${minutes}m`
  return `${minutes}m ${seconds}s`
}

function projectCreateRateLimitStatus(snapshot: Awaited<ReturnType<typeof rateLimiter.getValue>>) {
  const checked = calculateRateLimit(
    { value: snapshot.value, ts: snapshot.ts },
    snapshot.config,
    Date.now(),
    1,
  )
  const retryAfterMs = checked.retryAfter ? Math.ceil(checked.retryAfter) : null

  return {
    allowed: checked.value >= 0,
    retryAfterMs,
    message:
      checked.value < 0 && retryAfterMs
        ? `Project creation is temporarily limited. Try again in ${formatRetryDuration(
            retryAfterMs,
          )}.`
        : null,
  }
}

export const list = query({
  args: {
    teamId: v.string(),
    status: projectStatus,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireBoundedPageSize(args.paginationOpts.numItems)
    const access = await requireProjectTeamAccess(ctx, {
      teamId: args.teamId,
      permission: 'read',
    })

    return await ctx.db
      .query('projects')
      .withIndex('by_organizationId_teamId_status_updatedAt', (q) =>
        q
          .eq('organizationId', access.organizationId)
          .eq('teamId', args.teamId)
          .eq('status', args.status),
      )
      .order('desc')
      .paginate(args.paginationOpts)
  },
})

export const create = mutation({
  args: {
    teamId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const input = parseWithConvexError(createProjectInputSchema, args)

    const access = await requireProjectTeamAccess(ctx, {
      teamId: input.teamId,
      permission: 'create',
    })
    await rateLimiter.limit(ctx, 'projectCreate', {
      key: organizationActorRateLimitKey(access.organizationId, access.actor.authUserId),
      throws: true,
    })
    const now = Date.now()

    const projectId = await ctx.db.insert('projects', {
      organizationId: access.organizationId,
      teamId: access.teamId,
      name: input.name,
      status: 'active',
      createdByAuthUserId: access.actor.authUserId,
      createdAt: now,
      updatedAt: now,
    })

    await writeAuditEvent(ctx, {
      organizationId: access.organizationId,
      teamId: access.teamId,
      actor: access.actor,
      action: 'project.create',
      resourceType: 'project',
      resourceId: projectId,
      summary: `Created project ${input.name}`,
      createdAt: now,
    })

    return projectId
  },
})

export const getCreateRateLimit = query({
  args: {
    teamId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectTeamAccess(ctx, {
      teamId: args.teamId,
      permission: 'create',
    })

    const snapshot = await rateLimiter.getValue(ctx, 'projectCreate', {
      key: organizationActorRateLimitKey(access.organizationId, access.actor.authUserId),
    })

    return projectCreateRateLimitStatus(snapshot)
  },
})

export const rename = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const input = parseWithConvexError(renameProjectInputSchema, {
      projectId: args.projectId,
      name: args.name,
    })

    const access = await requireProjectAccessById(ctx, {
      projectId: args.projectId,
      permission: 'update',
    })
    if (access.project.status !== 'active') {
      throw new ConvexError('Deleted projects must be restored before renaming')
    }

    const now = Date.now()
    const previousName = access.project.name

    await ctx.db.patch(args.projectId, {
      name: input.name,
      updatedAt: now,
    })

    await writeAuditEvent(ctx, {
      organizationId: access.organizationId,
      teamId: access.teamId,
      actor: access.actor,
      action: 'project.update',
      resourceType: 'project',
      resourceId: args.projectId,
      summary: `Renamed project from ${previousName} to ${input.name}`,
      createdAt: now,
    })

    return args.projectId
  },
})

export const softDelete = mutation({
  args: {
    projectId: v.id('projects'),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectAccessById(ctx, {
      projectId: args.projectId,
      permission: 'delete',
    })
    const now = Date.now()

    if (access.project.status === 'deleted') {
      return args.projectId
    }

    await ctx.db.patch(args.projectId, {
      status: 'deleted',
      updatedAt: now,
      deletedAt: now,
      deletedByAuthUserId: access.actor.authUserId,
    })

    await writeAuditEvent(ctx, {
      organizationId: access.organizationId,
      teamId: access.teamId,
      actor: access.actor,
      action: 'project.delete',
      resourceType: 'project',
      resourceId: args.projectId,
      summary: `Deleted project ${access.project.name}`,
      createdAt: now,
    })

    return args.projectId
  },
})

export const restore = mutation({
  args: {
    projectId: v.id('projects'),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectAccessById(ctx, {
      projectId: args.projectId,
      permission: 'delete',
    })
    const now = Date.now()

    if (access.project.status === 'active') {
      return args.projectId
    }

    await ctx.db.patch(args.projectId, {
      status: 'active',
      updatedAt: now,
      deletedAt: undefined,
      deletedByAuthUserId: undefined,
    })

    await writeAuditEvent(ctx, {
      organizationId: access.organizationId,
      teamId: access.teamId,
      actor: access.actor,
      action: 'project.restore',
      resourceType: 'project',
      resourceId: args.projectId,
      summary: `Restored project ${access.project.name}`,
      createdAt: now,
    })

    return args.projectId
  },
})

export const purgeSoftDeleted = internalMutation({
  args: {
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now()
    const cutoff = now - softDeleteRetentionMs
    const deletedProjects = await ctx.db
      .query('projects')
      .withIndex('by_status_deletedAt', (q) => q.eq('status', 'deleted').lte('deletedAt', cutoff))
      .take(101)
    const batch = deletedProjects.slice(0, 100)

    for (const project of batch) {
      await ctx.db.delete(project._id)
    }

    return {
      deletedCount: batch.length,
      hasMore: deletedProjects.length > batch.length,
      cutoff,
    }
  },
})
