import { ConvexError, v } from 'convex/values'

import { mutation } from './_generated/server'

export const approveProjectDelete = mutation({
  args: { approvalId: v.id('approvals') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new ConvexError('Unauthenticated')
    const claims = identity as unknown as Record<string, unknown>
    if (claims.token_use !== 'convex-session') throw new ConvexError('Unauthenticated')
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', identity.subject))
      .unique()
    const approval = await ctx.db.get(args.approvalId)
    if (!user || !user.active || !approval || approval.status !== 'pending') {
      throw new ConvexError('Approval not found')
    }
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', approval.organizationId).eq('userId', user._id),
      )
      .unique()
    if (
      !membership ||
      membership.status !== 'active' ||
      (membership.role !== 'owner' && membership.role !== 'admin')
    ) {
      throw new ConvexError('Insufficient organization role')
    }
    await ctx.db.patch(args.approvalId, { approvedBy: user._id, status: 'approved' })
    return args.approvalId
  },
})
