import { defineFunctions, definePolicy, owner, tenant } from '@lupinum/better-convex-functions'
import { createBetterConvexAuth } from '@lupinum/better-convex-nuxt/better-auth/server'

import { betterAuthComponent } from '../support'
import type { DataModel } from './dataModel'

export const policy = definePolicy({
  actions: [
    'projects.search',
    'projects.create',
    'projects.archive',
    'shapes.echo',
    'projects.unscoped',
  ],
  roles: { owner: ['*'] },
  scopes: {
    read: { label: 'Read', actions: ['projects.search', 'shapes.echo'] },
    write: { label: 'Write', actions: ['projects.create', 'projects.archive'] },
  },
  agents: { 'projects.archive': 'approve' },
})

/** The real Better Auth component, registered in setup: people, sessions and MCP grants. */
export const auth = createBetterConvexAuth<DataModel>(betterAuthComponent, {})

export const fns = defineFunctions({
  auth,
  policy,
  user: (ctx, authId) =>
    ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .unique(),
  roleOf: async (ctx, user, tenant) => {
    if (tenant.table !== 'orgs') return null
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_org_user', (q) => q.eq('orgId', tenant.id).eq('userId', user._id))
      .unique()
    return membership?.role ?? null
  },
  rules: {
    users: owner('_id'),
    orgs: tenant('_id'),
    memberships: owner('userId'),
    projects: tenant('orgId'),
  },
})

export const { query, mutation } = fns
