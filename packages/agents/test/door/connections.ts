import { trusted } from '@lupinum/better-convex-functions'
import { mutationGeneric } from 'convex/server'
import { v } from 'convex/values'

import { tools } from './agents'
import { testing } from './fns'

/** The app's "disconnect this host", as convex/connections.ts writes it: revoke in auth, then tell the tools. */
export const revoke = trusted(
  'Test: revokes in the fake auth component, like convex/connections.ts.',
  mutationGeneric({
    args: { clientId: v.string() },
    handler: async (ctx, { clientId }) => {
      const authId = (await ctx.auth.getUserIdentity())!.subject
      testing.revoke(authId, clientId)
      const user = await ctx.db
        .query('users')
        .withIndex('by_auth_id', (q) => q.eq('authId', authId))
        .unique()
      await tools.disconnected(ctx, user!._id, clientId)
      return null
    },
  }),
)
