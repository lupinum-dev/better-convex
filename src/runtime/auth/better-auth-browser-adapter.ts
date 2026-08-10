import type { BetterConvexAuthAdapter } from 'better-convex-vue'
import { watch, type Ref } from 'vue'

import type { ConvexUser } from '../utils/types'
import { fetchConvexToken, isTokenUsable, type ConvexTokenSource } from './token-fetcher'

type BrowserAuthSnapshot = ReturnType<BetterConvexAuthAdapter['snapshot']>

interface BetterAuthSessionState {
  data?: {
    session?: { token?: unknown }
    user?: { id?: unknown }
  } | null
  isPending?: boolean
  error?: unknown
  refetch?: () => Promise<void>
}

interface BetterAuthBrowserSource extends ConvexTokenSource {
  useSession(): Readonly<Ref<BetterAuthSessionState>>
}

const UNAVAILABLE = 'Authentication is temporarily unavailable'

function isUnauthorized(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status?: unknown }).status === 401,
  )
}

/** Private first-party adapter proof. It becomes a Nuxt adapter only after the atomic package cut. */
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
  options: { initialIdentityKey?: string } = {},
): BetterConvexAuthAdapter & {
  failClosed(message: string): void
  dispose(): void
} {
  const session = source.useSession()
  const listeners = new Set<() => void>()
  let disposed = false
  let sessionGeneration = 0
  let observedSessionToken: string | null | undefined
  let observedIdentityKey: string | null | undefined = options.initialIdentityKey
  let cachedToken: string | null = null
  let snapshot: BrowserAuthSnapshot = options.initialIdentityKey
    ? {
        status: 'authenticated',
        identityKey: options.initialIdentityKey,
        sessionGeneration,
        error: null,
      }
    : {
        status: 'loading',
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
        snapshot.status === 'authenticated'
      ) {
        return
      }
      snapshot = {
        status: 'loading',
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
      snapshot.status === 'authenticated' &&
      observedSessionToken === sessionToken &&
      observedIdentityKey === key
    if (retainsEstablishedSession) return

    if (value.error || malformed) {
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
    if (!sessionToken) callbacks.anonymous(null)
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

  return Object.freeze({
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async fetchToken() {
      if (disposed || snapshot.status !== 'authenticated') return null
      const expectedKey = snapshot.identityKey
      const outcome = await fetchConvexToken(source)
      if (disposed || snapshot.status !== 'authenticated' || snapshot.identityKey !== expectedKey) {
        return null
      }
      if (outcome.identity) {
        const fetchedKey = outcome.identity.user.id
        if (fetchedKey !== expectedKey) {
          cachedToken = null
          return null
        }
        cachedToken = outcome.identity.token
        callbacks.authenticated(outcome.identity.token, outcome.identity.user)
        return cachedToken
      }
      if (!outcome.definitive && isTokenUsable(cachedToken)) return cachedToken
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
      } catch {
        throw new Error(UNAVAILABLE)
      }
      if (session.value.error) throw new Error(UNAVAILABLE)
    },
    failClosed(message: string) {
      if (disposed) return
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
      stop()
      listeners.clear()
      cachedToken = null
      observedSessionToken = null
    },
  })
}
