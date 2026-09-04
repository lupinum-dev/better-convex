import type { GenericDataModel, GenericQueryCtx } from 'convex/server'

import { sessionGenerationMatches } from '../session-generation'
import { isFullWorkforceSession } from './session-assurance'

/**
 * Internal component admission. The component supplies workforce mode from its
 * schema metadata, never from request arguments or claims. Provider adapter reads
 * remain unrestricted so enrollment and recovery can use their own continuations.
 */
export async function readAuthSessionAdmission(
  ctx: GenericQueryCtx<GenericDataModel>,
  { sessionId, userId }: { sessionId: string; userId?: string },
  workforce: boolean,
): Promise<{ user: Record<string, unknown>; session: Record<string, unknown> } | null> {
  if (!sessionId || userId === '') return null
  const session = await ctx.db
    .query('session')
    .withIndex('id', (query) => query.eq('id', sessionId))
    .unique()
  const now = Date.now()
  if (
    !session ||
    typeof session.userId !== 'string' ||
    !session.userId ||
    (userId !== undefined && session.userId !== userId) ||
    typeof session.expiresAt !== 'number' ||
    !Number.isFinite(session.expiresAt) ||
    session.expiresAt <= now
  ) {
    return null
  }
  const sessionUserId = session.userId
  const user = await ctx.db
    .query('user')
    .withIndex('id', (query) => query.eq('id', sessionUserId))
    .unique()
  if (!user || !sessionGenerationMatches(user, session)) return null
  if (workforce && !isFullWorkforceSession({ user, session, now })) {
    return null
  }
  return { user, session }
}
