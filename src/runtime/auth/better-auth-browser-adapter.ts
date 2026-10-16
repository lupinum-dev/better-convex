import type { BetterConvexAuthAdapter } from '@lupinum/better-convex-vue'
import { watch, type Ref } from 'vue'

import { ConvexCallError } from '../errors'
import type { ConvexUser } from '../utils/types'
import {
  fetchConvexToken,
  retryDelayMs,
  TOKEN_EXPIRY_SAFETY_BUFFER_MS,
  usableTokenLifetimeMs,
  type ConvexTokenSource,
} from './token-fetcher'

type BrowserAuthSnapshot = ReturnType<BetterConvexAuthAdapter['snapshot']>

interface BetterAuthSessionState {
  data?: {
    session?: { token?: unknown }
    user?: { id?: unknown }
  } | null
  isPending?: boolean
  isRefetching?: boolean
  error?: unknown
  refetch?: () => Promise<void>
}

interface BetterAuthBrowserSource extends ConvexTokenSource {
  useSession(): Readonly<Ref<BetterAuthSessionState>>
}

const UNAVAILABLE = 'Authentication is temporarily unavailable'
const SESSION_SETTLEMENT_TIMEOUT_MS = 5_000
/**
 * Backoff after a token exchange that failed for a temporary reason (429, 5xx,
 * network, timeout): 1 s, 2 s, 4 s ... up to 30 s, plus jitter, never shorter
 * than the server's Retry-After.
 */
const TRANSIENT_RETRY_BASE_DELAY_MS = 1_000
const TRANSIENT_RETRY_MAX_DELAY_MS = 30_000
/**
 * How long one run of temporary token failures may last before the adapter
 * reports authentication as temporarily unavailable.
 */
const TRANSIENT_FAILURE_BUDGET_MS = 30_000
/**
 * Backoff before the adapter asks again after it reported authentication as
 * temporarily unavailable: 2 s, 4 s ... up to 60 s, plus jitter.
 */
const RECOVERY_BASE_DELAY_MS = 2_000
const RECOVERY_MAX_DELAY_MS = 60_000
/**
 * Convex asks for a new token this many seconds before the current one expires
 * (its default is 10). Session tokens live 15 minutes, so a refresh that has to
 * wait out a temporary failure still runs while the current token works.
 */
const TOKEN_REFRESH_LEEWAY_SECONDS = 60

function temporarilyUnavailable(): ConvexCallError {
  return new ConvexCallError({
    kind: 'authentication',
    code: 'AUTH_UNAVAILABLE',
    message: UNAVAILABLE,
  })
}

function isUnauthorized(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status?: unknown }).status === 401,
  )
}

/** Private first-party Better Auth browser adapter used by Nuxt. */
export function createBetterAuthBrowserAdapter(
  source: BetterAuthBrowserSource,
  callbacks: {
    authenticated(token: string, user: ConvexUser): void
    anonymous(error: string | null): void
    sessionChanged?(
      sessionToken: string | null,
      error: string | null,
      sessionGeneration: number,
    ): void
  } = { authenticated: () => {}, anonymous: () => {} },
  /**
   * `initialIdentityKey` is the principal the server rendered: a user ID, or
   * `null` for a page the server rendered anonymously. Left out, the identity
   * is unknown (no server render) and starts as `loading`. A matching first
   * provider settlement then confirms it without a new session generation.
   */
  options: { initialIdentityKey?: string | null } = {},
): BetterConvexAuthAdapter & {
  failClosed(message: string): void
  dispose(): void
} {
  const session = source.useSession()
  const listeners = new Set<() => void>()
  const cancelPendingWaits = new Set<() => void>()
  let disposed = false
  let sessionGeneration = 0
  let observedSessionToken: string | null | undefined
  let observedIdentityKey: string | null | undefined = options.initialIdentityKey
  let cachedToken: string | null = null
  // Monotonic expiry of `cachedToken`: receipt plus the token's own lifetime.
  // `performance.now()` is immune to a wrong or corrected system clock.
  let cachedTokenExpiresAt = 0
  // Monotonic start of the current run of temporary token failures, or null.
  let transientSince: number | null = null
  // Set while authentication is reported temporarily unavailable and a new
  // attempt is scheduled.
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null
  let recoveryAttempt = 0
  const cancelRecovery = () => {
    if (recoveryTimer !== null) clearTimeout(recoveryTimer)
    recoveryTimer = null
  }
  let snapshot: BrowserAuthSnapshot = options.initialIdentityKey
    ? {
        status: 'authenticated',
        identityKey: options.initialIdentityKey,
        sessionGeneration,
        error: null,
      }
    : options.initialIdentityKey === null
      ? // Anonymous transport carries no token, so it may run before the provider
        // confirms; a session found later is a new generation like any other.
        { status: 'anonymous', identityKey: null, sessionGeneration, error: null }
      : {
          status: 'pending',
          identityKey: null,
          sessionGeneration,
          error: null,
        }

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // Provider observers cannot affect canonical auth state.
      }
    }
  }

  const publishFromSession = (value: BetterAuthSessionState) => {
    const rawSessionToken = value.data?.session?.token
    const sessionToken =
      typeof rawSessionToken === 'string' && rawSessionToken.length > 0 ? rawSessionToken : null
    const rawUserId = value.data?.user?.id
    const userId = typeof rawUserId === 'string' && rawUserId.length > 0 ? rawUserId : null
    const key = userId

    if (value.isPending === true) {
      if (
        observedSessionToken === undefined &&
        observedIdentityKey !== undefined &&
        (snapshot.status === 'authenticated' || snapshot.status === 'anonymous')
      ) {
        return
      }
      snapshot = {
        status: 'pending',
        identityKey: null,
        sessionGeneration,
        error: null,
      }
      notify()
      return
    }

    const malformed =
      (value.data?.session !== undefined && sessionToken === null) ||
      (sessionToken !== null && key === null)
    const retainsEstablishedSession =
      Boolean(value.error) &&
      !isUnauthorized(value.error) &&
      (snapshot.status === 'authenticated' || recoveryTimer !== null) &&
      observedSessionToken === sessionToken &&
      observedIdentityKey === key
    if (retainsEstablishedSession) return

    if (value.error || malformed) {
      cancelRecovery()
      cachedToken = null
      sessionGeneration += 1
      // The published failed state is the null provider identity. Reset the
      // observed pair as well so recovery cannot reuse this revision for a
      // different token/key pair.
      observedSessionToken = null
      observedIdentityKey = null
      snapshot = {
        status: 'error',
        identityKey: null,
        sessionGeneration,
        error: new Error(UNAVAILABLE),
      }
      callbacks.anonymous(UNAVAILABLE)
      callbacks.sessionChanged?.(null, UNAVAILABLE, sessionGeneration)
      notify()
      return
    }

    const establishesMatchingProvisionalIdentity =
      observedSessionToken === undefined &&
      observedIdentityKey !== undefined &&
      observedIdentityKey === key
    const changed =
      !establishesMatchingProvisionalIdentity &&
      (observedSessionToken !== sessionToken || observedIdentityKey !== key)
    if (!changed && recoveryTimer !== null) {
      // Better Auth re-reads the session on focus, on reconnect and for every
      // other tab, each time as a new object. The same session does not start
      // a new attempt early; the scheduled one does.
      observedSessionToken = sessionToken
      observedIdentityKey = key
      return
    }
    cancelRecovery()
    if (changed) {
      sessionGeneration += 1
      cachedToken = null
    }
    observedSessionToken = sessionToken
    observedIdentityKey = key
    snapshot =
      sessionToken && key
        ? {
            status: 'authenticated',
            identityKey: key,
            sessionGeneration,
            error: null,
          }
        : {
            status: 'anonymous',
            identityKey: null,
            sessionGeneration,
            error: null,
          }
    if (snapshot.status === 'anonymous') callbacks.anonymous(null)
    callbacks.sessionChanged?.(sessionToken, null, sessionGeneration)
    notify()
  }

  const stop = watch(
    [
      () => session.value.isPending === true,
      () => session.value.data,
      () => session.value.error,
    ] as const,
    ([isPending, data, error]) => publishFromSession({ isPending, data, error }),
    {
      immediate: true,
      deep: false,
      // Identity observation is a security boundary: retire the old identity
      // in the same turn rather than after Vue's render queue flushes.
      flush: 'sync',
    },
  )

  const waitForSessionSettlement = async () => {
    const isUnsettled = () =>
      session.value.isPending === true || session.value.isRefetching === true
    if (!isUnsettled()) return

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let stopPending = () => {}
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        stopPending()
        clearTimeout(timer)
        cancelPendingWaits.delete(cancel)
        if (error) reject(error)
        else resolve()
      }
      const cancel = () => finish(new Error(UNAVAILABLE))

      cancelPendingWaits.add(cancel)
      stopPending = watch(
        isUnsettled,
        (unsettled) => {
          if (!unsettled) finish()
        },
        { flush: 'sync' },
      )
      const timer = setTimeout(cancel, SESSION_SETTLEMENT_TIMEOUT_MS)

      // Close the gap between the initial check and watcher registration.
      if (disposed) cancel()
      else if (!isUnsettled()) finish()
    })
  }

  // Resolves after `delayMs`, or at once on dispose. Never rejects.
  const pause = (delayMs: number) =>
    new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        cancelPendingWaits.delete(finish)
        resolve()
      }
      const timer = setTimeout(finish, delayMs)
      cancelPendingWaits.add(finish)
    })

  // Refetch the provider session and wait for it to settle, bounded by the
  // settlement timeout and cancelled on dispose: a hanging request must not
  // hold a token fetch open. Never rejects.
  const settleProviderSession = () =>
    new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        cancelPendingWaits.delete(finish)
        resolve()
      }
      const timer = setTimeout(finish, SESSION_SETTLEMENT_TIMEOUT_MS)
      cancelPendingWaits.add(finish)
      const unsettled = session.value.isPending === true || session.value.isRefetching === true
      void (async () => {
        if (!unsettled) await session.value.refetch?.()
        await waitForSessionSettlement()
      })().then(finish, finish)
    })

  // The temporary failures outlasted their budget: report authentication as
  // temporarily unavailable. The provider still reports the session, so the
  // observed session stays; only the token generation is retired, and a new
  // generation for the same session is scheduled with backoff.
  const failTransiently = (retryAfterMs: number) => {
    cachedToken = null
    transientSince = null
    sessionGeneration += 1
    const failedGeneration = sessionGeneration
    snapshot = {
      status: 'error',
      identityKey: null,
      sessionGeneration,
      error: temporarilyUnavailable(),
    }
    cancelRecovery()
    recoveryTimer = setTimeout(
      () => {
        recoveryTimer = null
        if (disposed || sessionGeneration !== failedGeneration || !observedIdentityKey) return
        sessionGeneration += 1
        snapshot = {
          status: 'authenticated',
          identityKey: observedIdentityKey,
          sessionGeneration,
          error: null,
        }
        callbacks.sessionChanged?.(observedSessionToken ?? null, null, sessionGeneration)
        notify()
      },
      retryDelayMs(recoveryAttempt++, {
        baseMs: RECOVERY_BASE_DELAY_MS,
        maxMs: RECOVERY_MAX_DELAY_MS,
        retryAfterMs,
      }),
    )
    callbacks.anonymous(UNAVAILABLE)
    callbacks.sessionChanged?.(observedSessionToken ?? null, null, sessionGeneration)
    notify()
  }

  return Object.freeze({
    tokenRefreshLeewaySeconds: TOKEN_REFRESH_LEEWAY_SECONDS,
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async fetchToken({ forceRefreshToken }: Parameters<BetterConvexAuthAdapter['fetchToken']>[0]) {
      if (disposed || snapshot.status !== 'authenticated') return null
      const expectedKey = snapshot.identityKey
      const expectedGeneration = sessionGeneration
      const isCurrent = () =>
        !disposed &&
        snapshot.status === 'authenticated' &&
        snapshot.identityKey === expectedKey &&
        sessionGeneration === expectedGeneration
      let outcome = await fetchConvexToken(source)
      // A 429, a 5xx, a network error or a timeout says nothing about the
      // session. While the provider still reports it, wait and ask again
      // instead of answering null, which Convex reports as signed out.
      for (let attempt = 0; !outcome.identity && !outcome.definitive; attempt += 1) {
        if (!isCurrent()) return null
        // A new client asks first without forcing a refresh: a usable cached
        // token stands in, and Convex schedules its next refresh from it. A
        // forced refresh never gets the same token back, because Convex then
        // stops refreshing (its `notRefetching` state).
        if (
          !forceRefreshToken &&
          cachedToken &&
          performance.now() < cachedTokenExpiresAt - TOKEN_EXPIRY_SAFETY_BUFFER_MS
        ) {
          return cachedToken
        }
        transientSince ??= performance.now()
        const delayMs = retryDelayMs(attempt, {
          baseMs: TRANSIENT_RETRY_BASE_DELAY_MS,
          maxMs: TRANSIENT_RETRY_MAX_DELAY_MS,
          retryAfterMs: outcome.retryAfterMs,
        })
        // Keep trying for the budget, and at least while the current token
        // still works: Convex keeps using it until a new one arrives.
        const deadline = Math.max(
          transientSince + TRANSIENT_FAILURE_BUDGET_MS,
          cachedToken ? cachedTokenExpiresAt : 0,
        )
        if (performance.now() + delayMs > deadline) {
          failTransiently(outcome.retryAfterMs ?? 0)
          return null
        }
        await pause(delayMs)
        if (!isCurrent()) return null
        outcome = await fetchConvexToken(source)
      }
      transientSince = null
      if (outcome.sessionRejected && !disposed) {
        // The session ended on the server (sign-out, revocation, expiry) before
        // the provider published it. Let the provider settle first: a session
        // it now reports as gone is a sign-out, not an authentication error,
        // and the generation check below drops this result.
        await settleProviderSession()
      }
      if (!isCurrent()) return null
      if (outcome.identity) {
        const fetchedKey = outcome.identity.user.id
        if (fetchedKey !== expectedKey) {
          cachedToken = null
          return null
        }
        recoveryAttempt = 0
        cachedToken = outcome.identity.token
        // The fetcher admitted only tokens with a usable lifetime; 0 fails closed.
        cachedTokenExpiresAt = performance.now() + (usableTokenLifetimeMs(cachedToken) ?? 0)
        callbacks.authenticated(outcome.identity.token, outcome.identity.user)
        return cachedToken
      }
      cachedToken = null
      callbacks.anonymous(outcome.authError)
      return null
    },
    async refreshSession() {
      if (disposed) return
      const refetch = session.value.refetch
      if (typeof refetch !== 'function') throw new Error(UNAVAILABLE)
      try {
        await refetch()
        await waitForSessionSettlement()
      } catch {
        throw new Error(UNAVAILABLE)
      }
      if (disposed || session.value.error) throw new Error(UNAVAILABLE)
    },
    failClosed(message: string) {
      if (disposed) return
      cancelRecovery()
      cachedToken = null
      sessionGeneration += 1
      snapshot = {
        status: 'error',
        identityKey: null,
        sessionGeneration,
        error: new Error(UNAVAILABLE),
      }
      observedSessionToken = null
      observedIdentityKey = null
      callbacks.anonymous(message)
      callbacks.sessionChanged?.(null, UNAVAILABLE, sessionGeneration)
      notify()
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelRecovery()
      stop()
      for (const cancel of [...cancelPendingWaits]) cancel()
      cancelPendingWaits.clear()
      listeners.clear()
      cachedToken = null
      observedSessionToken = null
    },
  })
}
