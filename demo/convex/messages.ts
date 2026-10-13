/**
 * Messages Functions - Pagination demo
 *
 * Demonstrates pagination with useConvexPaginatedQuery.
 */

import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

/**
 * List messages with cursor-based pagination
 */
export const listPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 50
    ) {
      throw new Error('Page size must be an integer between 1 and 50')
    }
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return {
        page: [],
        isDone: true,
        continueCursor: '',
      }
    }
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_created')
      .order('desc')
      .paginate(args.paginationOpts)

    return messages
  },
})

/**
 * Add a new message.
 * Demo only: any signed-in user can add unlimited rows, and the cron purge removes only 100 rows
 * per run. A real feature needs a rate limit, for example with `@convex-dev/rate-limiter`.
 */
export const add = mutation({
  args: {
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error('Not authenticated')
    }
    const content = args.content.trim()
    if (!content || content.length > 5_000) {
      throw new Error('Message content must be between 1 and 5000 characters')
    }

    // Get user for display name
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', identity.subject))
      .first()

    const messageId = await ctx.db.insert('messages', {
      content,
      authorId: identity.subject,
      authorName: user?.displayName || identity.name || 'Anonymous',
      createdAt: Date.now(),
    })

    return messageId
  },
})

/**
 * Seed messages for demo.
 * Demo only: no rate limit. Do not copy this to a real application without one.
 */
export const seed = mutation({
  args: {
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error('Not authenticated')
    }

    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', identity.subject))
      .first()

    const authorName = user?.displayName || identity.name || 'Demo User'
    const count = args.count ?? 20
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      throw new Error('count must be an integer between 1 and 50')
    }

    const sampleMessages = [
      'Just deployed a new feature to production!',
      'Anyone else excited about the new Convex updates?',
      'Real-time databases are the future',
      'Working on pagination implementation today',
      'The weather is beautiful outside',
      'Coffee is essential for coding',
      'Just fixed a tricky bug',
      'Learning new things every day',
      'Team standup in 5 minutes',
      'Code review time!',
      'Documentation is important',
      'Testing, testing, 1-2-3',
      'Just pushed 50 commits',
      'Time for a break',
      'Debugging mode activated',
      'Found an interesting article about WebSockets',
      'The build is green!',
      'Refactoring complete',
      'New PR ready for review',
      'Sprint planning tomorrow',
    ]

    const messageIds = []
    for (let i = 0; i < count; i++) {
      const content = sampleMessages[i % sampleMessages.length]
      const messageId = await ctx.db.insert('messages', {
        content: `${content} (#${i + 1})`,
        authorId: identity.subject,
        authorName,
        createdAt: Date.now() - i * 60000, // Stagger timestamps
      })
      messageIds.push(messageId)
    }

    return { created: messageIds.length }
  },
})
