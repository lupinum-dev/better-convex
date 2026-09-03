import { v } from 'convex/values'

import { internal } from './_generated/api'
import { internalMutation } from './_generated/server'

/** Admin-only disposable-fixture acceleration, never a production session API. */
export const accelerate = internalMutation({
  args: { userId: v.string(), sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query('session')
      .withIndex('id', (query) => query.eq('id', args.sessionId))
      .unique()
    const user = await ctx.db
      .query('user')
      .withIndex('id', (query) => query.eq('id', args.userId))
      .unique()
    const expiresAt = Date.now() + 1_500
    if (
      !session ||
      !user ||
      !user.email.startsWith('workforce-') ||
      !user.email.endsWith('@example.test') ||
      session.userId !== args.userId ||
      user.emailVerified !== true ||
      session.bcnAssuranceMethod !== 'password-totp' ||
      session.bcnAssuranceGeneration !== user.bcnSecurityGeneration ||
      session.expiresAt <= expiresAt
    )
      throw new Error('WORKFORCE_EXPIRY_FIXTURE_SESSION_INVALID')
    await ctx.db.patch('session', session._id, { expiresAt })
    // Execute the actual production callback against this physical row. Its
    // original later job becomes a harmless no-op after the accelerated delete.
    await ctx.scheduler.runAt(expiresAt, internal.adapter.expireWorkforceSession, {
      storageId: session._id,
    })
    return null
  },
})
