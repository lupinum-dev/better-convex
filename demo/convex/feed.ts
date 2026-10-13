/**
 * Feed Functions - Real-time demo
 *
 * Demonstrates real-time subscriptions with useConvexQuery.
 */

import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

/**
 * List all feed items, sorted by creation time (newest first)
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return []
    }
    const items = await ctx.db.query('feedItems').withIndex('by_created').order('desc').take(50)

    return items
  },
})

/**
 * List feed items with optional type filter
 * Used by the reactive args demo to show how query args can be reactive
 */
export const listFiltered = query({
  args: {
    type: v.optional(v.union(v.literal('message'), v.literal('task'), v.literal('event'))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return []
    }
    const limit = args.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer between 1 and 100')
    }
    const type = args.type
    if (type) {
      return await ctx.db
        .query('feedItems')
        .withIndex('by_type_created', (q) => q.eq('type', type))
        .order('desc')
        .take(limit)
    }

    return await ctx.db.query('feedItems').withIndex('by_created').order('desc').take(limit)
  },
})

/**
 * Add a new feed item.
 * Demo only: any signed-in user can add unlimited rows. A real feature needs a rate limit, for
 * example with `@convex-dev/rate-limiter`.
 */
export const add = mutation({
  args: {
    content: v.string(),
    type: v.union(v.literal('message'), v.literal('task'), v.literal('event')),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error('Not authenticated')
    }
    const content = args.content.trim()
    if (!content || content.length > 5_000) {
      throw new Error('Feed content must be between 1 and 5000 characters')
    }

    // Get user for display name
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', identity.subject))
      .first()

    const itemId = await ctx.db.insert('feedItems', {
      content,
      type: args.type,
      authorId: identity.subject,
      authorName: user?.displayName || identity.name || 'Anonymous',
      createdAt: Date.now(),
    })

    return itemId
  },
})

/**
 * Remove a feed item
 */
export const remove = mutation({
  args: {
    id: v.id('feedItems'),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error('Not authenticated')
    }

    const item = await ctx.db.get(args.id)
    if (!item) {
      throw new Error('Item not found')
    }

    const isOwner = item.authorId === identity.subject

    if (!isOwner) {
      throw new Error('Permission denied: You can only delete your own posts.')
    }

    await ctx.db.delete(args.id)
  },
})
