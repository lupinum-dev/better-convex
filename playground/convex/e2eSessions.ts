import { v } from 'convex/values'

import { components } from './_generated/api'
import type { QueryCtx } from './_generated/server'
import { internalMutation, internalQuery } from './_generated/server'

/** Test-only playground seam: E2E ages a real session past Better Auth's update age. */

const dayMs = 24 * 60 * 60 * 1000
// Better Auth's defaults, which the playground keeps.
const sessionExpiresInMs = 7 * dayMs
const sessionUpdateAgeMs = dayMs

const sessionRow = v.object({ id: v.string(), expiresAt: v.number(), updatedAt: v.number() })
type SessionRow = typeof sessionRow.type

async function latestSession(ctx: QueryCtx, email: string): Promise<SessionRow> {
  const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [{ field: 'email', value: email }],
  })) as { id: string } | null
  if (!user) throw new Error('E2E_SESSION_USER_MISSING')
  const session = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'session',
    where: [{ field: 'userId', value: user.id }],
    sortBy: { field: 'createdAt', direction: 'desc' },
  })) as SessionRow | null
  if (!session) throw new Error('E2E_SESSION_MISSING')
  return { id: session.id, expiresAt: session.expiresAt, updatedAt: session.updatedAt }
}

export const readSession = internalQuery({
  args: { email: v.string() },
  returns: sessionRow,
  handler: (ctx, args) => latestSession(ctx, args.email),
})

/** Move the session's last renewal one minute past the update age; it stays valid. */
export const ageSession = internalMutation({
  args: { email: v.string() },
  returns: sessionRow,
  handler: async (ctx, args) => {
    const session = await latestSession(ctx, args.email)
    const renewedAt = Date.now() - sessionUpdateAgeMs - 60_000
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      model: 'session',
      where: [{ field: 'id', value: session.id }],
      update: { updatedAt: renewedAt, expiresAt: renewedAt + sessionExpiresInMs },
    })
    return latestSession(ctx, args.email)
  },
})
