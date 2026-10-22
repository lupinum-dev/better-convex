import type { AuthWaterfall, AuthWaterfallPhase } from '../../devtools/types'
import {
  classifyAuthFailure,
  decodeUserFromJwt,
  isJwtUsable,
  type ClassifiedAuthFailure,
} from '../../utils/convex-shared'
import type { AuthEvent } from '../../utils/logger'
import { filterBetterAuthCookies, getBetterAuthSessionToken } from '../../utils/shared-helpers'
import type { ConvexUser } from '../../utils/types'
import type { ConvexServerEvent } from './event'
import { exchangeConvexToken } from './token-exchange'

const AUTH_TOKEN_EXCHANGE_FAILED = 'AUTH_TOKEN_EXCHANGE_FAILED'

export interface ServerAuthLogEvent {
  phase: string
  outcome: AuthEvent['outcome']
  details?: Record<string, unknown>
}

export interface ResolveServerAuthSnapshotOptions {
  event: ConvexServerEvent
  siteUrl: string
  /** The normalized public application origin (`auth.origin`). */
  publicOrigin: string
  cookieHeader: string | null
  requestId: string
  trackWaterfall: boolean
  trustedClientIpHeader: string
}

export interface ServerAuthSnapshot {
  token: string | null
  user: ConvexUser | null
  /**
   * Why the render has no identity although a session cookie was sent: a
   * temporary or a setup failure. Null for a signed-in render, no session, or
   * a session the auth backend rejected (401/403).
   */
  authError: ClassifiedAuthFailure | null
  /** The exchange's HTTP status, when an exchange ran and answered. */
  exchangeStatus: number | undefined
  waterfall: AuthWaterfall | null
  logEvents: ServerAuthLogEvent[]
}

function buildPhase(
  name: string,
  startTime: number,
  waterfallStart: number,
  result: AuthWaterfallPhase['result'],
  details?: string,
): AuthWaterfallPhase {
  const end = Date.now()
  return {
    name,
    start: startTime - waterfallStart,
    end: end - waterfallStart,
    duration: end - startTime,
    result,
    details,
  }
}

export async function resolveServerAuthSnapshot(
  options: ResolveServerAuthSnapshotOptions,
): Promise<ServerAuthSnapshot> {
  const {
    event,
    siteUrl,
    publicOrigin,
    cookieHeader,
    requestId,
    trackWaterfall,
    trustedClientIpHeader,
  } = options
  const waterfallStart = trackWaterfall ? Date.now() : 0
  const phases: AuthWaterfallPhase[] = []
  const logEvents: ServerAuthLogEvent[] = []
  const buildWaterfall = (
    outcome: AuthWaterfall['outcome'],
    error?: string,
  ): AuthWaterfall | null =>
    trackWaterfall
      ? {
          requestId,
          timestamp: waterfallStart,
          phases,
          totalDuration: Date.now() - waterfallStart,
          outcome,
          error,
        }
      : null

  const sessionCheckStart = trackWaterfall ? Date.now() : 0
  const sessionToken = getBetterAuthSessionToken(cookieHeader)
  const authCookieHeader = filterBetterAuthCookies(cookieHeader)

  logEvents.push({
    phase: 'server-init',
    outcome: 'success',
    details: {
      hasCookieHeader: Boolean(cookieHeader),
      hasSessionToken: Boolean(sessionToken),
    },
  })

  if (!authCookieHeader || !sessionToken) {
    if (trackWaterfall) {
      phases.push(
        buildPhase('session-check', sessionCheckStart, waterfallStart, 'miss', 'No session cookie'),
      )
    }
    logEvents.push({ phase: 'session-check', outcome: 'miss' })
    return {
      token: null,
      user: null,
      authError: null,
      exchangeStatus: undefined,
      waterfall: buildWaterfall('unauthenticated'),
      logEvents,
    }
  }

  if (trackWaterfall) {
    phases.push(
      buildPhase('session-check', sessionCheckStart, waterfallStart, 'success', 'Cookie found'),
    )
  }

  const exchangeStart = trackWaterfall ? Date.now() : 0
  let failure: ClassifiedAuthFailure
  let exchangeStatus: number | undefined
  try {
    const exchange = await exchangeConvexToken({
      event,
      siteUrl,
      publicOrigin,
      credential: { type: 'cookie', value: authCookieHeader },
      trustedClientIpHeader,
      timeoutMs: 5_000,
      renewsRequestSession: true,
    })
    exchangeStatus = exchange.status
    // A usable token must also name the person (`sub`). The server answered,
    // so a token without one is a setup error, never an outage.
    const user =
      exchange.token && isJwtUsable(exchange.token) ? decodeUserFromJwt(exchange.token) : null

    if (exchange.token && user) {
      if (trackWaterfall) {
        phases.push(
          buildPhase(
            'token-exchange',
            exchangeStart,
            waterfallStart,
            'success',
            `${siteUrl}/api/auth/convex/token`,
          ),
        )
      }
      logEvents.push({
        phase: 'ssr.jwt.exchange',
        outcome: 'success',
        details: { identityHydrated: true },
      })
      return {
        token: exchange.token,
        user,
        authError: null,
        exchangeStatus,
        waterfall: buildWaterfall('authenticated'),
        logEvents,
      }
    }

    // A 2xx answer without a usable token (none, too short-lived, or no `sub`)
    // breaks the token contract; any other failure is decided by its status.
    failure = classifyAuthFailure(
      exchange.error === null || exchange.error.code === 'INVALID_RESPONSE'
        ? { invalidToken: true }
        : { status: exchange.status },
    )
  } catch {
    // The exchange returns every outcome; it throws only for a cookie it
    // refuses to send, which no auth backend outage can cause.
    failure = classifyAuthFailure({ invalidToken: true })
  }

  // A rejected session is a plain anonymous render, not an error.
  const authError = failure.class === 'rejected' ? null : failure

  if (trackWaterfall) {
    phases.push(
      buildPhase(
        'token-exchange',
        exchangeStart,
        waterfallStart,
        authError ? 'error' : 'miss',
        exchangeStatus ? `HTTP ${exchangeStatus}` : 'No token returned',
      ),
    )
  }

  logEvents.push({
    phase: 'ssr.jwt.exchange',
    outcome: authError ? 'error' : 'miss',
    details:
      authError || exchangeStatus
        ? {
            ...(authError ? { code: AUTH_TOKEN_EXCHANGE_FAILED, reason: authError.code } : {}),
            ...(exchangeStatus ? { status: exchangeStatus } : {}),
          }
        : undefined,
  })

  return {
    token: null,
    user: null,
    authError,
    exchangeStatus,
    waterfall: buildWaterfall(
      authError ? 'error' : 'unauthenticated',
      authError ? AUTH_TOKEN_EXCHANGE_FAILED : undefined,
    ),
    logEvents,
  }
}
