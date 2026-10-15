import { defineFunctions, owner, tenant } from '@lupinum/better-convex-functions'
import {
  anyApi,
  type ApiFromModules,
  type DataModelFromSchemaDefinition,
  type FilterApi,
  type FunctionReference,
} from 'convex/server'

import { people } from './people'
import { policy } from './policy'
import type schema from './schema'

type DataModel = DataModelFromSchemaDefinition<typeof schema>

export const fns = defineFunctions({
  auth: people<DataModel>(),
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

export const {
  query,
  mutation,
  internalQuery,
  internalMutation,
  internalAction,
  job,
  authorizeAction,
} = fns

// What codegen's `internal` gives an app; the fixture has no codegen. Like codegen, it names this
// module's own exports, so a type loop through `fns.action` would show here.
const internal = anyApi as unknown as FilterApi<
  ApiFromModules<{ functions: typeof import('./functions') }>,
  FunctionReference<any, 'internal'>
>

/** Public actions: each call runs `authorizeAction` first. */
export const action = fns.action(internal.functions.authorizeAction)
