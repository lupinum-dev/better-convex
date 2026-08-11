/**
 * Auth-enabled-only server plugin. Registered by the module only
 * when auth is enabled. It runs during SSR to:
 * 1. Read the session cookie from the request
 * 2. Exchange the session cookie for a JWT token via Better Auth API
 *    (with optional caching to reduce TTFB)
 * 3. Store the token and user data in useState for client hydration
 *
 * This ensures authenticated state is available on first render with zero flash.
 */

import { defineNuxtPlugin, useState, useRuntimeConfig, useRequestEvent } from '#app'

import { ANONYMOUS_IDENTITY, toAuthenticatedIdentity } from './auth/auth-identity'
import type { AuthWaterfall } from './devtools/types'
import { resolveServerAuthSnapshot } from './server/utils/auth-snapshot'
import { applyConvexAuthSsrHeaders } from './server/utils/ssr-auth-headers'
import { buildMissingSiteUrlMessage } from './utils/auth-errors'
import { useConvexIdentityState } from './utils/auth-identity-state'
import { createLogger, getLogLevel } from './utils/logger'
import { getConvexRuntimeConfig } from './utils/runtime-config'
import { filterBetterAuthCookies } from './utils/shared-helpers'

export default defineNuxtPlugin(async () => {
  const config = useRuntimeConfig()
  const convexConfig = getConvexRuntimeConfig()
  const authConfig = convexConfig.auth
  const publicConvex = config.public.convex as Record<string, unknown> | undefined
  const logLevel = getLogLevel(publicConvex)
  const logger = createLogger(logLevel)
  const endInit = logger.time('plugin:init (server)')

  // Defensive invariant: this entry is absent from a Convex-only build graph.
  if (authConfig === false) {
    throw new Error('[better-convex-nuxt] auth server plugin loaded in a no-auth build')
  }

  const event = useRequestEvent()
  if (!event) {
    logger.auth({
      phase: 'init',
      outcome: 'error',
      details: { code: 'AUTH_REQUEST_EVENT_MISSING' },
    })
    return
  }
  const requestMethod = event.method || 'GET'
  const requestId = crypto.randomUUID()
  const traceEnabled = logLevel === 'debug'
  const convexIdentity = useConvexIdentityState()
  const cookieHeader = event.headers.get('cookie')
  const hasSupportedBetterAuthCookie = filterBetterAuthCookies(cookieHeader) !== null

  const siteUrl = convexConfig.siteUrl
  if (!siteUrl) {
    applyConvexAuthSsrHeaders(event, {
      hasBetterAuthCookie: hasSupportedBetterAuthCookie,
      serializesToken: false,
    })
    const message = buildMissingSiteUrlMessage()
    const convexAuthError = useState<string | null>('convex:authError', () => null)
    convexAuthError.value = message
    endInit()
    logger.auth({
      phase: 'init',
      outcome: 'error',
      details: { code: 'AUTH_SITE_URL_MISSING' },
    })
    return
  }

  const logAuth = (
    phase: string,
    outcome: 'success' | 'error' | 'skip' | 'miss',
    details?: Record<string, unknown>,
  ) => {
    logger.auth({
      phase,
      outcome,
      details: traceEnabled ? { requestId, method: requestMethod, ...details } : details,
    })
  }

  if (traceEnabled) {
    logAuth('ssr.auth.started', 'success', {
      hasSupportedAuthCookie: hasSupportedBetterAuthCookie,
    })
  }

  // Initialize useState for hydration (must be done even if unauthenticated).
  const convexAuthError = useState<string | null>('convex:authError', () => null)
  const convexAuthWaterfall = useState<AuthWaterfall | null>('convex:authWaterfall', () => null)

  const snapshotStartedAt = Date.now()
  const snapshot = await resolveServerAuthSnapshot({
    event,
    siteUrl,
    cookieHeader,
    requestId,
    trackWaterfall: import.meta.dev,
    trustedClientIpHeader: authConfig.trustedClientIpHeader,
  })

  convexIdentity.value =
    snapshot.token && snapshot.user
      ? toAuthenticatedIdentity(snapshot.token, snapshot.user)
      : ANONYMOUS_IDENTITY
  convexAuthError.value = snapshot.authError
  convexAuthWaterfall.value = snapshot.waterfall

  // This is an auth-enabled SSR response, so it always varies by cookie. A
  // recognized Better Auth cookie OR a serialized per-user JWT also forbids
  // shared/CDN caching. Existing `Vary` values are preserved.
  applyConvexAuthSsrHeaders(event, {
    hasBetterAuthCookie: hasSupportedBetterAuthCookie,
    serializesToken: snapshot.token !== null,
  })

  endInit()
  for (const logEvent of snapshot.logEvents) {
    logAuth(logEvent.phase, logEvent.outcome, logEvent.details)
  }
  if (traceEnabled) {
    logAuth(
      'ssr.auth.completed',
      snapshot.token ? 'success' : snapshot.authError ? 'error' : 'miss',
      {
        durationMs: Date.now() - snapshotStartedAt,
        identityHydrated: snapshot.user !== null,
        tokenSerialized: snapshot.token !== null,
      },
    )
  }
})
