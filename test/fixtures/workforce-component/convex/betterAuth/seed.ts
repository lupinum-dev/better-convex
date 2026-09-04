import {
  internalMutationGeneric,
  type DataModelFromSchemaDefinition,
  type MutationBuilder,
} from 'convex/server'
import { v } from 'convex/values'

import type schema from './schema'
import { tables } from './schema'

const mutation: MutationBuilder<
  DataModelFromSchemaDefinition<typeof schema>,
  'internal'
> = internalMutationGeneric

// Test-only persisted preconditions, including deliberately stale/invalid proofs.
// Transitions under test still call the production adapter and cannot use this seam.
export const user = mutation({
  args: { data: tables.user.validator },
  returns: v.null(),
  handler: async (ctx, { data }) => {
    await ctx.db.insert('user', data)
    return null
  },
})

export const session = mutation({
  args: { data: tables.session.validator },
  returns: v.null(),
  handler: async (ctx, { data }) => {
    await ctx.db.insert('session', data)
    return null
  },
})

export const verification = mutation({
  args: { data: tables.verification.validator },
  returns: v.null(),
  handler: async (ctx, { data }) => {
    await ctx.db.insert('verification', data)
    return null
  },
})
