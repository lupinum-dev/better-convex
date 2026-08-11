import { queryGeneric } from 'convex/server'

export const current = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    const claims = identity as unknown as Record<string, unknown>
    return {
      sessionId: typeof claims.sid === 'string' ? claims.sid : null,
      subject: identity.subject,
      tokenUse: typeof claims.token_use === 'string' ? claims.token_use : null,
    }
  },
})
