import type { GenericEndpointContext } from '@better-auth/core'
import type { BetterAuthOptions } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { expireCookie } from 'better-auth/cookies'

import { workforceSessionPolicy } from './operations'
import { bindWorkforceTotpReplay } from './otp-binding'
import {
  getWorkforceOperation,
  relayWorkforceSession,
  setWorkforceOperation,
} from './request-context'
import { getWorkforceSessionAssurance, isFullWorkforceSession } from './session-assurance'

const publicPaths = new Set([
  '/ok',
  '/error',
  '/jwks',
  '/sign-up/email',
  '/request-password-reset',
  '/reset-password/:token',
  '/reset-password',
  '/verify-email',
  '/send-verification-email',
  '/sign-out',
])
type Row = Record<string, unknown>
type SessionCreateAfter = NonNullable<
  NonNullable<
    NonNullable<NonNullable<BetterAuthOptions['databaseHooks']>['session']>['create']
  >['after']
>

function deny(code = 'AUTH_WORKFORCE_ROUTE_FORBIDDEN', headers?: Headers): never {
  throw new APIError(
    'FORBIDDEN',
    {
      code,
      message: 'This authentication operation is not available.',
    },
    headers,
  )
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function generation(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function epoch(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value
}

function bodyRecord(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Read the signed provider token, then canonical rows, never returned:false output or cookie cache. */
async function liveSession(ctx: GenericEndpointContext) {
  const token = await ctx.getSignedCookie(
    ctx.context.authCookies.sessionToken.name,
    ctx.context.secret,
  )
  if (!token) return null
  const raw = await ctx.context.adapter.findOne<Row>({
    model: 'session',
    where: [{ field: 'token', value: token }],
  })
  if (!raw) return null
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.userId !== 'string' || !raw.userId)
    deny('AUTH_WORKFORCE_SESSION_INVALID')
  const user = await ctx.context.adapter.findOne<Row>({
    model: 'user',
    where: [{ field: 'id', value: raw.userId }],
  })
  const session: Row = { ...raw, expiresAt: epoch(raw.expiresAt) }
  const now = Date.now()
  if (
    !user ||
    user.id !== raw.userId ||
    user.emailVerified !== true ||
    !generation(user.bcnSecurityGeneration) ||
    raw.bcnAssuranceGeneration !== user.bcnSecurityGeneration ||
    !positive(session.expiresAt) ||
    session.expiresAt <= now ||
    !positive(raw.bcnSessionStartedAt) ||
    !positive(raw.bcnAuthenticatedAt) ||
    raw.bcnSessionStartedAt > raw.bcnAuthenticatedAt ||
    raw.bcnAuthenticatedAt > now ||
    now - raw.bcnSessionStartedAt >= workforceSessionPolicy.absoluteLifetimeMs
  )
    deny('AUTH_WORKFORCE_SESSION_INVALID')
  return {
    user,
    session,
    userId: raw.userId,
    sessionId: raw.id,
    generation: user.bcnSecurityGeneration,
    now,
  }
}

async function bindChallenge(ctx: GenericEndpointContext, recovery: boolean) {
  // Cookie purpose names are pinned provider protocol constants, not application configuration.
  const cookie = ctx.context.createAuthCookie('two_factor')
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret)
  if (!identifier) deny('AUTH_WORKFORCE_CHALLENGE_REQUIRED')
  const challenge: Row | null = await ctx.context.internalAdapter.findVerificationValue(identifier)
  if (
    !challenge ||
    typeof challenge.id !== 'string' ||
    !challenge.id ||
    typeof challenge.value !== 'string' ||
    !challenge.value
  )
    deny('AUTH_WORKFORCE_CHALLENGE_REQUIRED')
  const user = await ctx.context.adapter.findOne<Row>({
    model: 'user',
    where: [{ field: 'id', value: challenge.value }],
  })
  const expiresAt = epoch(challenge.expiresAt)
  if (
    !user ||
    user.id !== challenge.value ||
    user.emailVerified !== true ||
    !generation(user.bcnSecurityGeneration) ||
    challenge.bcnAssuranceGeneration !== user.bcnSecurityGeneration ||
    !positive(expiresAt) ||
    expiresAt <= Date.now()
  )
    deny('AUTH_WORKFORCE_CHALLENGE_REQUIRED')
  await setWorkforceOperation({
    operation: recovery ? 'recovery-sign-in' : 'totp-sign-in',
    userId: challenge.value,
    challengeId: challenge.id,
    expectedGeneration: user.bcnSecurityGeneration,
    ...(!recovery
      ? {
          replay: await bindWorkforceTotpReplay(ctx, {
            userId: challenge.value,
            expectedGeneration: user.bcnSecurityGeneration,
          }),
        }
      : {}),
  })
}

/** Factory-owned fixed profile, after the owned internal bearer conversion. */
export function createWorkforceProviderHooks() {
  const before = createAuthMiddleware(async (ctx) => {
    const path = ctx.path
    const body = bodyRecord(ctx.body) ? ctx.body : {}
    if (path === '/sign-in/email') {
      const trustCookie = ctx.context.createAuthCookie('trust_device')
      if (ctx.getCookie(trustCookie.name) !== null) {
        expireCookie(ctx, trustCookie)
        // A thrown before-hook error must explicitly carry its response headers.
        deny('AUTH_WORKFORCE_TRUST_DEVICE_FORBIDDEN', ctx.responseHeaders)
      }
      if (typeof body.email !== 'string') return
      const user = await ctx.context.adapter.findOne<Row>({
        model: 'user',
        where: [{ field: 'email', value: body.email.toLowerCase() }],
      })
      // Unknown credentials retain the provider's normal failure and timing path.
      if (!user) return
      if (typeof user.id !== 'string' || !user.id || !generation(user.bcnSecurityGeneration))
        deny('AUTH_WORKFORCE_USER_INVALID')
      await setWorkforceOperation({
        operation: 'password-sign-in',
        userId: user.id,
        expectedGeneration: user.bcnSecurityGeneration,
      })
      return
    }
    if (path && publicPaths.has(path)) return
    if (path === '/get-session') {
      // An absent cookie remains an anonymous session. A stale live cookie does
      // not restore revoked authority; restricted onboarding sessions stay usable.
      await liveSession(ctx)
      return
    }
    const verifyTotp = path === '/two-factor/verify-totp'
    const verifyRecovery = path === '/two-factor/verify-backup-code'
    const enable = path === '/two-factor/enable'
    const regenerate = path === '/two-factor/generate-backup-codes'
    const token = path === '/convex/token'
    const changePassword = path === '/change-password'
    if (!verifyTotp && !verifyRecovery && !enable && !regenerate && !token && !changePassword)
      deny()
    if ((verifyTotp || verifyRecovery) && (body.trustDevice || body.disableSession)) deny()
    if (enable && body.method !== undefined && body.method !== 'totp') deny()
    if (changePassword && body.revokeOtherSessions) deny()
    const live = await liveSession(ctx)
    if ((verifyTotp || verifyRecovery) && !live) {
      await bindChallenge(ctx, verifyRecovery)
      return
    }
    if (!live) deny('AUTH_WORKFORCE_SESSION_REQUIRED')
    if (verifyRecovery) deny()
    if (verifyTotp && live.session.bcnAssuranceMethod !== 'totp-enrollment') deny()
    if (enable || verifyTotp) {
      await setWorkforceOperation({
        operation: enable ? 'begin-enrollment' : 'confirm-enrollment',
        userId: live.userId,
        sessionId: live.sessionId,
        expectedGeneration: live.generation,
        ...(verifyTotp
          ? {
              replay: await bindWorkforceTotpReplay(ctx, {
                userId: live.userId,
                expectedGeneration: live.generation,
                sessionId: live.sessionId,
              }),
            }
          : {}),
      })
      return
    }
    if (!isFullWorkforceSession(live)) deny('AUTH_WORKFORCE_FULL_AUTH_REQUIRED')
    if (token) return
    if (
      getWorkforceSessionAssurance({
        ...live,
        absoluteLifetimeMs: workforceSessionPolicy.absoluteLifetimeMs,
        maxAuthenticationAgeMs: workforceSessionPolicy.freshAuthenticationMs,
      })?.method !== 'password-totp'
    )
      deny('AUTH_WORKFORCE_FRESH_AUTH_REQUIRED')
    if (regenerate || changePassword)
      await setWorkforceOperation({
        operation: regenerate ? 'regenerate-backup-codes' : 'change-password',
        userId: live.userId,
        sessionId: live.sessionId,
        expectedGeneration: live.generation,
      })
  })
  const sessionCreateAfter: SessionCreateAfter = async (session) => {
    if ((await getWorkforceOperation())?.operation === 'confirm-enrollment')
      await relayWorkforceSession(session)
  }
  return { before, sessionCreateAfter }
}
