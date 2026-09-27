import { v } from 'convex/values'

import { query } from './_generated/server'
import { auth } from './auth'

export const getCurrent = query({
  args: {},
  returns: v.union(
    v.object({
      email: v.string(),
      name: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const authUser = await auth.getUser(ctx)
    if (!authUser) return null

    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authUser.id))
      .unique()
    if (!user?.active) return null

    return { email: user.email, name: user.name }
  },
})
