import { APIError } from 'better-auth/api'
import { v } from 'convex/values'

import { action, mutation, query } from './_generated/server'
import { authComponent, createAuth } from './auth'

export const current = query({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx)
    if (typeof user.id !== 'string') throw new Error('WORKFORCE_FIXTURE_USER_INVALID')
    return user.id
  },
})

export const sessions = query({
  args: {},
  returns: v.array(
    v.object({ sessionId: v.string(), isCurrent: v.boolean(), expiresAt: v.number() }),
  ),
  handler: async (ctx) => {
    const result = await authComponent.workforceSessions.list(ctx, { cursor: null, numItems: 50 })
    return result.page.map(({ sessionId, isCurrent, expiresAt }) => ({
      sessionId,
      isCurrent,
      expiresAt,
    }))
  },
})

export const touch = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => (await authComponent.workforceSessions.touch(ctx)).expiresAt,
})

export const revoke = mutation({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: (ctx, args) => authComponent.workforceSessions.revoke(ctx, args.sessionId),
})

export const revokeAll = mutation({
  args: {},
  returns: v.null(),
  handler: (ctx) => authComponent.workforceSessions.revokeAll(ctx),
})

export const managementDenied = action({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const { auth, headers } = await authComponent.getAuth(createAuth, ctx)
    try {
      await auth.api.listSessions({ headers })
    } catch (error) {
      if (
        error instanceof APIError &&
        error.status === 'FORBIDDEN' &&
        error.body?.code === 'AUTH_WORKFORCE_ROUTE_FORBIDDEN'
      )
        return true
    }
    throw new Error('WORKFORCE_FIXTURE_MANAGEMENT_UNEXPECTED_RESULT')
  },
})
