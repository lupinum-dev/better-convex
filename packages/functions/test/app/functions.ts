import { defineFunctions, owner, tenant } from '@lupinum/better-convex-functions'
import { testAuth } from '@lupinum/better-convex-functions/test'
import type { DataModelFromSchemaDefinition } from 'convex/server'

import { policy } from './policy'
import type schema from './schema'

type DataModel = DataModelFromSchemaDefinition<typeof schema>

/** The auth component, faked: a person is the test identity's subject. */
export const testing = testAuth<DataModel>()

export const fns = defineFunctions({
  auth: testing.auth,
  policy,
  user: async (ctx, authId) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .unique()
    return user?.active ? user : null
  },
  // A client inherits the roles of its organization.
  roleOf: async (ctx, user, tenant) => {
    const organizationId =
      tenant.table === 'organizations'
        ? tenant.id
        : tenant.table === 'clients'
          ? (await ctx.db.get(tenant.id))?.organizationId
          : undefined
    if (!organizationId) return null
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', organizationId).eq('userId', user._id),
      )
      .unique()
    return membership?.role ?? null
  },
  rules: {
    users: owner('_id'),
    organizations: tenant('_id'),
    memberships: owner('userId'),
    projects: tenant('organizationId'),
    clients: tenant('_id', { parent: 'organizationId', createdBy: 'clients.create' }),
  },
})

export const { query, mutation, internalQuery, internalMutation, internalAction, job } = fns
