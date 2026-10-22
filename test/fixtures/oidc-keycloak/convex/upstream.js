import { actionGeneric } from 'convex/server'

import { auth } from './auth'

/** Returns the signed-in user's IdP access token, refreshing it when it is about to expire. */
export const accessToken = actionGeneric({
  args: {},
  handler: async (ctx) => await auth.getOidcAccessToken(ctx),
})
