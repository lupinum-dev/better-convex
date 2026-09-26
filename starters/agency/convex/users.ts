import { ConvexError } from 'convex/values'

import type { MutationCtx, QueryCtx } from './_generated/server'
import { auth } from './auth'

/** The live Better Auth user's stable Agency actor row. */
export async function requireCurrentUser(ctx: QueryCtx | MutationCtx) {
  const authUser = await auth.requireUser(ctx)

  const user = await ctx.db
    .query('users')
    .withIndex('by_subject', (q) => q.eq('subject', authUser.id))
    .unique()

  if (!user) {
    throw new ConvexError('User not found')
  }

  return user
}
