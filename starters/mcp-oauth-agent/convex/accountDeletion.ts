import { trusted } from '@lupinum/better-convex-functions'
import { v } from 'convex/values'

import { internalQuery } from './_generated/server'

/**
 * Called by `deleteUser.beforeDelete` in ./auth.ts, before anything is deleted. True when the
 * person is the only active owner of an organization that still has other active members:
 * deleting them would leave that team without an owner. An organization where they are the only
 * member does not count; nobody is left to lose it.
 */
export const leavesATeamWithoutOwner = trusted(
  'Called by the auth deleteUser check; it takes the Better Auth user ID and reads memberships only.',
  internalQuery({
    args: { authId: v.string() },
    handler: async (ctx, { authId }) => {
      const user = await ctx.db
        .query('users')
        .withIndex('by_auth_id', (q) => q.eq('authId', authId))
        .unique()
      if (!user) return false
      const owned = await ctx.db
        .query('memberships')
        .withIndex('by_user', (q) => q.eq('userId', user._id).eq('status', 'active'))
        .take(100)
      for (const { organizationId, role } of owned) {
        if (role !== 'owner') continue
        const members = await ctx.db
          .query('memberships')
          .withIndex('by_org_user', (q) => q.eq('organizationId', organizationId))
          .take(100)
        const others = members.filter((m) => m.status === 'active' && m.userId !== user._id)
        if (others.length > 0 && !others.some((m) => m.role === 'owner')) return true
      }
      return false
    },
  }),
)
