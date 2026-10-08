import { custom, defineFunctions, owner, tenant } from '@lupinum/better-convex-functions'

import type { Doc } from './_generated/dataModel'
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
    // Every membership of an organization where your role allows the action. Not owner('userId'):
    // that would let a member change their own role or add themselves to another organization.
    memberships: custom<Doc<'memberships'>>((ctx, membership) =>
      ctx.allows({ table: 'organizations', id: membership.organizationId }),
    ),
    sites: tenant('organizationId'),
    siteChecks: tenant('organizationId'),
  },
})

export const { query, mutation, internalMutation, internalAction, job } = fns
