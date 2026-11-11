import {
  defineFunctions,
  definePolicy,
  owner,
  tenant,
  unchecked,
} from '@lupinum/better-convex-functions'
import { makeFunctionReference, type DataModelFromSchemaDefinition } from 'convex/server'

import { people } from '../app/people'
import type schema from '../rules/schema'

type DataModel = DataModelFromSchemaDefinition<typeof schema>

export const policy = definePolicy({
  actions: ['projects.read', 'projects.rename', 'reports.make'],
  roles: { owner: ['*'], viewer: ['projects.read'] },
  scopes: { all: { label: 'Everything', actions: ['*'] } },
})

/** The fixture app's options, with `observe` set by each module that builds it. */
export function build(observe: boolean) {
  return defineFunctions({
    auth: people<DataModel>(),
    policy,
    observe,
    user: async (ctx, authId) =>
      ctx.db
        .query('users')
        .withIndex('by_auth_id', (q) => q.eq('authId', authId))
        .unique(),
    roleOf: async (ctx, user, tenant) => {
      if (tenant === null || tenant.table !== 'orgs') return null
      const membership = await ctx.db
        .query('memberships')
        .withIndex('by_org_user', (q) => q.eq('orgId', tenant.id).eq('userId', user._id))
        .unique()
      return membership?.role ?? null
    },
    rules: {
      users: owner('_id'),
      orgs: tenant('_id'),
      memberships: unchecked('Not touched by these tests.'),
      projects: tenant('orgId'),
      notes: unchecked('Unused here.'),
      locks: unchecked('Unused here.'),
      oddLone: unchecked('Unused here.'),
      oddPart: unchecked('Unused here.'),
      pages: unchecked('Unused here.'),
    },
  })
}

export const fns = build(true)
export const {
  query,
  mutation,
  internalQuery,
  internalMutation,
  internalAction,
  job,
  authorizeAction,
} = fns
export const action = fns.action(makeFunctionReference<'mutation'>('fns:authorizeAction') as never)
