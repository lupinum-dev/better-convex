import { ConvexError, v } from 'convex/values'

import type { Doc, Id } from './_generated/dataModel'
import { mutation, query, type QueryCtx } from './_generated/server'
import { auth } from './auth'

async function currentUser(ctx: QueryCtx): Promise<Doc<'users'> | null> {
  const authId = (await auth.requireUser(ctx)).id
  const user = await ctx.db
    .query('users')
    .withIndex('by_auth_id', (q) => q.eq('authId', authId))
    .unique()
  return user?.active ? user : null
}

function canApprove(membership: Doc<'memberships'> | null): boolean {
  return (
    membership?.status === 'active' && (membership.role === 'owner' || membership.role === 'admin')
  )
}

/** A pending request in an organization where the signed-in user is an owner or admin. */
async function decidableApproval(ctx: QueryCtx, approvalId: Id<'approvals'>) {
  const user = await currentUser(ctx)
  const approval = await ctx.db.get(approvalId)
  if (!user || !approval || approval.status !== 'pending' || approval.expiresAt <= Date.now()) {
    throw new ConvexError('Approval not found')
  }
  const membership = await ctx.db
    .query('memberships')
    .withIndex('by_org_user', (q) =>
      q.eq('organizationId', approval.organizationId).eq('userId', user._id),
    )
    .unique()
  if (!canApprove(membership)) throw new ConvexError('Insufficient organization role')
  return { approval, user }
}

/**
 * Deletion requests from agents that the signed-in user may approve or decline.
 * The page passes `now`, because a query does not run again when time passes.
 */
export const listPending = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx)
    if (!user) return []
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_user', (q) => q.eq('userId', user._id).eq('status', 'active'))
      .take(100)
    const pending = await Promise.all(
      memberships.filter(canApprove).map(async ({ organizationId }) => {
        const [organization, approvals] = await Promise.all([
          ctx.db.get(organizationId),
          ctx.db
            .query('approvals')
            .withIndex('by_org_status_expiry', (q) =>
              q
                .eq('organizationId', organizationId)
                .eq('status', 'pending')
                .gt('expiresAt', args.now),
            )
            .take(50),
        ])
        return await Promise.all(
          approvals.map(async (approval) => {
            const [project, requester] = await Promise.all([
              ctx.db.get(approval.projectId),
              ctx.db.get(approval.userId),
            ])
            return {
              id: approval._id,
              organizationName: organization?.name ?? 'Unknown organization',
              projectName: project?.name ?? 'Unknown project',
              requestedBy: requester?.name ?? 'Unknown user',
              expiresAt: approval.expiresAt,
            }
          }),
        )
      }),
    )
    return pending.flat().sort((a, b) => a.expiresAt - b.expiresAt)
  },
})

export const approveProjectDelete = mutation({
  args: { approvalId: v.id('approvals') },
  handler: async (ctx, args) => {
    const { user } = await decidableApproval(ctx, args.approvalId)
    await ctx.db.patch(args.approvalId, { approvedBy: user._id, status: 'approved' })
    return args.approvalId
  },
})

export const rejectProjectDelete = mutation({
  args: { approvalId: v.id('approvals') },
  handler: async (ctx, args) => {
    await decidableApproval(ctx, args.approvalId)
    await ctx.db.patch(args.approvalId, { status: 'rejected' })
    return args.approvalId
  },
})
