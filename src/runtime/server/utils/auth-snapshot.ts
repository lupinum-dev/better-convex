import type { H3Event } from 'h3'

import type { AuthWaterfall, AuthWaterfallPhase } from '../../devtools/types'
import { decodeUserFromJwt, isJwtUsable } from '../../utils/convex-shared'
import { filterBetterAuthCookies, getBetterAuthSessionToken } from '../../utils/shared-helpers'
import type { ConvexUser } from '../../utils/types'
import { exchangeConvexToken } from './token-exchange'

type AuthLogOutcome = 'success' | 'error' | 'skip' | 'miss'

const GENERIC_AUTH_ERROR_MESSAGE = 'Authentication is temporarily unavailable'
const AUTH_TOKEN_EXCHANGE_FAILED = 'AUTH_TOKEN_EXCHANGE_FAILED'

export interface ServerAuthLogEvent {
  phase: string
  outcome: AuthLogOutcome
  details?: Record<string, unknown>
}

export interface ResolveServerAuthSnapshotOptions {
  event: H3Event
  siteUrl: string
  cookieHeader: string | null
  requestId: string
  trackWaterfall: boolean
  trustedClientIpHeader: string
}

export interface ServerAuthSnapshot {
  token: string | null
  user: ConvexUser | null
  authError: string | null
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
  const { event, siteUrl, cookieHeader, requestId, trackWaterfall, trustedClientIpHeader } = options
  const waterfallStart = trackWaterfall ? Date.now() : 0
  const phases: AuthWaterfallPhase[] = []
  const logEvents: ServerAuthLogEvent[] = []
  const cacheHit = false
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
          cacheHit,
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
      waterfall: buildWaterfall('unauthenticated'),
      logEvents,
    }
  }

  if (trackWaterfall) {
    phases.push(
      buildPhase('session-check', sessionCheckStart, waterfallStart, 'success', 'Cookie found'),
    )
  }

  try {
    if (trackWaterfall) {
      phases.push({
        name: 'cache-lookup',
        start: 0,
        end: 0,
        duration: 0,
        result: 'skipped',
        details: 'Cache disabled',
      })
    }

    const exchangeStart = trackWaterfall ? Date.now() : 0
    const exchange = await exchangeConvexToken({
      event,
      siteUrl,
      credential: { type: 'cookie', value: authCookieHeader },
      trustedClientIpHeader,
      timeoutMs: 5_000,
    })
    const tokenExchangeStatus = exchange.status
    const unusableHydrationToken = Boolean(exchange.token && !isJwtUsable(exchange.token))

    if (exchange.token && !unusableHydrationToken) {
      const token = exchange.token

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

      const decodeStart = trackWaterfall ? Date.now() : 0
      const user = decodeUserFromJwt(token)
      if (!user) {
        // Keep this fail-closed assertion at the display boundary; do not
        // create a second identity path through /get-session.
        throw new Error('Convex token exchange returned an invalid display identity')
      }
      if (trackWaterfall) {
        phases.push(buildPhase('jwt-decode', decodeStart, waterfallStart, 'success'))
      }

      logEvents.push({
        phase: 'ssr.jwt.exchange',
        outcome: 'success',
        details: { identityHydrated: true },
      })
      return {
        token,
        user,
        authError: null,
        waterfall: buildWaterfall('authenticated'),
        logEvents,
      }
    }

    const isDefinitiveAuthMiss = tokenExchangeStatus === 401 || tokenExchangeStatus === 403
    const isExchangeFailure =
      unusableHydrationToken || (exchange.error !== null && !isDefinitiveAuthMiss)
    const authError = isExchangeFailure ? GENERIC_AUTH_ERROR_MESSAGE : null

    if (trackWaterfall) {
      phases.push(
        buildPhase(
          'token-exchange',
          exchangeStart,
          waterfallStart,
          isExchangeFailure ? 'error' : 'miss',
          tokenExchangeStatus ? `HTTP ${tokenExchangeStatus}` : 'No token returned',
        ),
      )
    }

    const exchangeLogDetails: Record<string, unknown> | undefined = tokenExchangeStatus
      ? {
          ...(isExchangeFailure ? { code: AUTH_TOKEN_EXCHANGE_FAILED } : {}),
          status: tokenExchangeStatus,
        }
      : isExchangeFailure
        ? { code: AUTH_TOKEN_EXCHANGE_FAILED }
        : undefined

    logEvents.push({
      phase: 'ssr.jwt.exchange',
      outcome: isExchangeFailure ? 'error' : 'miss',
      details: exchangeLogDetails,
    })

    return {
      token: null,
      user: null,
      authError,
      waterfall: buildWaterfall(
        isExchangeFailure ? 'error' : 'unauthenticated',
        isExchangeFailure ? AUTH_TOKEN_EXCHANGE_FAILED : undefined,
      ),
      logEvents,
    }
  } catch {
    logEvents.push({
      phase: 'ssr.jwt.exchange',
      outcome: 'error',
      details: { code: AUTH_TOKEN_EXCHANGE_FAILED },
    })

    return {
      token: null,
      user: null,
      authError: GENERIC_AUTH_ERROR_MESSAGE,
      waterfall: buildWaterfall('error', AUTH_TOKEN_EXCHANGE_FAILED),
      logEvents,
    }
  }
}
