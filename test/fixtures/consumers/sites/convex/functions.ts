import { defineFunctions, owner, tenant } from '@lupinum/better-convex-functions'

import { auth } from './auth'
import { policy } from './policy'

export const fns = defineFunctions({
  auth,
  policy,
  user: (ctx, authId) =>
    ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .unique(),
  roleOf: async (ctx, user, tenant) => {
    if (tenant.table !== 'organizations') return null
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_org_user', (q) => q.eq('organizationId', tenant.id).eq('userId', user._id))
      .unique()
    return membership?.role ?? null
  },
  // Every row a handler reads or writes is checked against these rules.
  rules: {
    users: owner('_id'),
    organizations: tenant('_id'),
    memberships: owner('userId'),
    sites: tenant('organizationId'),
    siteChecks: tenant('organizationId'),
  },
})

export const { query, mutation, internalMutation, internalAction, job } = fns
