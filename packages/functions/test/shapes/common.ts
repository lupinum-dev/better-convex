import { unchecked } from '@lupinum/better-convex-functions'
import type { DataModelFromSchemaDefinition, GenericQueryCtx } from 'convex/server'
import type { GenericId } from 'convex/values'

import { people } from '../app/people'
import type schema from './schema'

// What the shape modules share: auth, the user lookup, organization roles.

export type DataModel = DataModelFromSchemaDefinition<typeof schema>
type Ctx = GenericQueryCtx<DataModel>

export const auth = people<DataModel>()

export const user = (ctx: Ctx, authId: string) =>
  ctx.db
    .query('users')
    .withIndex('by_auth_id', (q) => q.eq('authId', authId))
    .unique()

/** The stored role, any string (K1): the policy decides what it may do. */
export async function orgRole(ctx: Ctx, userId: GenericId<'users'>, orgId: GenericId<'orgs'>) {
  const membership = await ctx.db
    .query('memberships')
    .withIndex('by_org_user', (q) => q.eq('orgId', orgId).eq('userId', userId))
    .unique()
  return membership?.role ?? null
}

/** Rules for the tables a module does not use. */
export const notUsed = <const T extends readonly (keyof DataModel)[]>(...tables: T) =>
  Object.fromEntries(tables.map((table) => [table, unchecked('Not used here.')])) as {
    [K in T[number]]: ReturnType<typeof unchecked>
  }
