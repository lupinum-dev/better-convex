import { query } from './_generated/server'
import { auth } from './auth'

// Get the currently authenticated user from the custom users table
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await auth.getUser(ctx)
    if (!authUser) {
      return null
    }

    // The Better Auth user ID matches authId in the users table.
    const authId = authUser.id

    // Query the custom users table using by_auth_id index
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .first()

    return user
  },
})
