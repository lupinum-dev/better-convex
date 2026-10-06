import { defineFunctions, owner, tenant } from '@lupinum/better-convex-functions'

import { auth } from './auth'
import { policy } from './policy'

export const fns = defineFunctions({
  auth,
  policy,
  // A suspended user is no actor at all: every function refuses them.
  user: async (ctx, authId) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .unique()
    return user?.active ? user : null
  },
  roleOf: async (ctx, user, tenant) => {
    if (tenant.table !== 'organizations') return null
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_org_user', (q) => q.eq('organizationId', tenant.id).eq('userId', user._id))
      .unique()
    return membership?.status === 'active' ? membership.role : null
  },
  // Every row a handler reads or writes is checked against these rules.
  rules: {
    users: owner('_id'),
    organizations: tenant('_id'),
    memberships: owner('userId'),
    projects: tenant('organizationId'),
  },
})

export const { query, mutation } = fns
