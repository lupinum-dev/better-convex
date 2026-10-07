import { trusted } from '@lupinum/better-convex-functions'
import { mutationGeneric } from 'convex/server'
import { v } from 'convex/values'

import { tools } from './agents'
import { auth } from './fns'

/** The app's "disconnect this host", as convex/connections.ts writes it: revoke in auth, then tell the tools. */
export const revoke = trusted(
  'Test: checks the signed-in user with auth.requireUser, like convex/connections.ts.',
  mutationGeneric({
    args: { clientId: v.string() },
    handler: async (ctx, { clientId }) => {
      const authUser = await auth.requireUser(ctx)
      await auth.oauthConnections.revoke(ctx, { userId: authUser.id, clientId })
      const user = await ctx.db
        .query('users')
        .withIndex('by_auth_id', (q) => q.eq('authId', authUser.id))
        .unique()
      await tools.disconnected(ctx, user!._id, clientId)
      return null
    },
  }),
)
