import { v } from 'convex/values'

import { internalMutation, mutation, query } from './_generated/server'
import { tools } from './agents'
import { APP_NAME, auth } from './auth'
import { policy } from './policy'

/** The MCP hosts, such as ChatGPT or Claude, that the signed-in user connected. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await auth.requireUser(ctx)
    return await auth.oauthConnections.list(ctx, { userId: user.id })
  },
})

/** Disconnect one host. Its next MCP request fails, and it cannot renew access. */
export const revoke = mutation({
  args: { clientId: v.string() },
  handler: async (ctx, { clientId }) => {
    const user = await auth.requireUser(ctx)
    const result = await auth.oauthConnections.revoke(ctx, { userId: user.id, clientId })
    // Its open requests can no longer run: take them off the approval list.
    const appUser = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', user.id))
      .unique()
    if (appUser) await tools.disconnected(ctx, appUser._id, clientId)
    return result
  },
})

// Operator functions. Run them from the Convex dashboard or with `convex run`.

/**
 * Creates the OAuth client one host connects with. Claude has a fixed
 * callback. For ChatGPT, pass the callback URL its connector settings show.
 */
export const createHostClient = internalMutation({
  args: {
    host: v.union(v.literal('chatgpt'), v.literal('claude')),
    redirectUri: v.optional(v.string()),
  },
  handler: async (ctx, args) => await auth.oauthOperator.createHostClient(ctx, args),
})

/**
 * Creates a client for MCP Inspector on this computer. Use it in development only.
 * Inspector requests `offline_access` by default, so the client allows renewal.
 */
export const createInspectorClient = internalMutation({
  args: {},
  handler: async (ctx) =>
    await auth.oauthOperator.createPublicClient(ctx, {
      name: 'MCP Inspector',
      profile: 'mcp-inspector',
      redirectUris: ['http://localhost:6274/oauth/callback'],
      resource: { identifier: auth.mcp.resource().href, name: APP_NAME, ownership: 'application' },
      scopes: ['offline_access', ...Object.keys(policy.scopes)],
    }),
})
