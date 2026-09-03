import type { GenericDataModel, GenericMutationCtx } from 'convex/server'

import { workforceSessionPolicy, type WorkforceOperation } from './operations'
import { getWorkforceSessionAssurance } from './session-assurance'

type MutationContext = GenericMutationCtx<GenericDataModel>
type AuthRow = Readonly<Record<string, unknown>>

/** Must be called in the same component mutation as the credential change. */
export async function advanceWorkforceGeneration(ctx: MutationContext, userId: unknown) {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('AUTH_WORKFORCE_USER_INVALID')
  }
  const user: Record<string, unknown> | null = await ctx.db
    .query('user')
    .withIndex('id', (query) => query.eq('id', userId))
    .unique()
  if (!user || typeof user._id !== 'string') throw new Error('AUTH_WORKFORCE_USER_MISSING')
  const generation = user.bcnSecurityGeneration
  if (
    typeof generation !== 'number' ||
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    generation === Number.MAX_SAFE_INTEGER
  ) {
    throw new Error('AUTH_WORKFORCE_GENERATION_INVALID')
  }
  const storageId = ctx.db.normalizeId('user', user._id)
  if (!storageId) throw new Error('AUTH_WORKFORCE_USER_INVALID')
  const next = generation + 1
  await ctx.db.patch('user', storageId, { bcnSecurityGeneration: next })
  return next
}

/** Account tokens/profile refreshes are not password changes. */
export async function invalidateWorkforcePasswordChange(
  ctx: MutationContext,
  model: string,
  previous: AuthRow | null,
  next: AuthRow | null,
  operation?: WorkforceOperation,
) {
  if (model !== 'account') return
  if (
    previous &&
    next &&
    previous.password === next.password &&
    previous.providerId === next.providerId &&
    previous.userId === next.userId
  )
    return
  if (operation?.operation === 'change-password') {
    if (
      !previous ||
      !next ||
      previous.providerId !== 'credential' ||
      next.providerId !== 'credential' ||
      previous.userId !== operation.userId ||
      next.userId !== operation.userId ||
      typeof next.password !== 'string' ||
      !next.password
    )
      throw new Error('AUTH_WORKFORCE_PASSWORD_CHANGE_INVALID')
    const user: AuthRow | null = await ctx.db
      .query('user')
      .withIndex('id', (query) => query.eq('id', operation.userId))
      .unique()
    const session: AuthRow | null = await ctx.db
      .query('session')
      .withIndex('id', (query) => query.eq('id', operation.sessionId))
      .unique()
    if (
      user?.emailVerified !== true ||
      user.bcnSecurityGeneration !== operation.expectedGeneration ||
      getWorkforceSessionAssurance({
        user,
        session,
        now: Date.now(),
        absoluteLifetimeMs: workforceSessionPolicy.absoluteLifetimeMs,
        maxAuthenticationAgeMs: workforceSessionPolicy.freshAuthenticationMs,
      })?.method !== 'password-totp'
    )
      throw new Error('AUTH_WORKFORCE_PASSWORD_CHANGE_AUTH_REQUIRED')
  }
  const owners = new Set<unknown>()
  if (previous?.providerId === 'credential') owners.add(previous.userId)
  if (next?.providerId === 'credential') owners.add(next.userId)
  for (const userId of owners) await advanceWorkforceGeneration(ctx, userId)
}
