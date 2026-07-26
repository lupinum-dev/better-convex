import type { AuthTokenFetcher, ConvexClient } from 'convex/browser'

import { ConvexCallError } from '../errors'
import { createIdentityChangedError } from './identity-changed-error'
import type { ClientIdentityPort, ClientIdentitySnapshot } from './identity-port'

export type BrowserAuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error'

/** Provider-neutral browser identity snapshot. It contains no credential or client control. */
export interface BrowserAuthSnapshot {
  readonly status: BrowserAuthStatus
  /** Stable, non-secret provider subject used only for local state isolation. */
  readonly identityKey: string | null
  /** Non-secret monotonic credential lifecycle owned by the provider adapter. */
  readonly sessionGeneration: number
  readonly error: Error | null
}

/** Provider-neutral auth adapter. It deliberately contains no client controls. */
export interface BrowserAuthAdapter {
  snapshot(): BrowserAuthSnapshot
  subscribe(listener: () => void): () => void
  fetchToken: AuthTokenFetcher
  refreshSession(): Promise<void>
}

interface AuthCapableClient extends ConvexClient {
  setAuth(
    fetchToken: AuthTokenFetcher,
    onChange: (isAuthenticated: boolean) => void,
    onRefreshChange?: (isRefreshing: boolean) => void,
  ): void
}

export interface AuthAdapterIdentityPort extends ClientIdentityPort {
  refresh(): Promise<void>
  dispose(): void
}

const CONFIRMATION_TIMEOUT_MS = 10_000

function validateSnapshot(snapshot: BrowserAuthSnapshot): BrowserAuthSnapshot {
  if (!Number.isSafeInteger(snapshot.sessionGeneration) || snapshot.sessionGeneration < 0) {
    throw new TypeError('Auth adapter sessionGeneration must be a non-negative safe integer.')
  }
  if (snapshot.status === 'authenticated') {
    if (typeof snapshot.identityKey !== 'string' || snapshot.identityKey.length === 0) {
      throw new TypeError(
        'An authenticated auth adapter snapshot requires a non-empty identityKey.',
      )
    }
  } else if (snapshot.identityKey !== null) {
    throw new TypeError(
      'A non-authenticated auth adapter snapshot cannot carry a user identityKey.',
    )
  }
  if (snapshot.status === 'error' && !(snapshot.error instanceof Error)) {
    throw new TypeError('An error auth adapter snapshot requires an Error.')
  }
  return snapshot
}

function clientIdentityKey(snapshot: BrowserAuthSnapshot): ClientIdentitySnapshot['identityKey'] {
  return snapshot.status === 'authenticated' ? `user:${snapshot.identityKey}` : 'anonymous'
}

function publicError(snapshot: BrowserAuthSnapshot): ConvexCallError | null {
  if (snapshot.status !== 'error') return null
  return new ConvexCallError({
    kind: 'authentication',
    message: 'Authentication failed',
  })
}

/**
 * Translates provider state into the shared
 * token-free identity port while retaining ownership of `setAuth` and raw clients.
 */
export function createAuthAdapterIdentityPort(
  adapter: BrowserAuthAdapter,
): AuthAdapterIdentityPort {
  let desired = validateSnapshot(adapter.snapshot())
  let identityGeneration = 0
  let disposed = false
  let currentClient: AuthCapableClient | null = null
  let currentClientGeneration = -1
  const activeAuthConfiguration = new WeakMap<AuthCapableClient, object>()
  let initialSettled = desired.status !== 'loading' && desired.status !== 'authenticated'
  let snapshot: ClientIdentitySnapshot = {
    authEnabled: true,
    settled: initialSettled,
    identityKey: clientIdentityKey(desired),
    identityGeneration,
    error: publicError(desired),
  }
  const listeners = new Set<() => void>()
  const settlementWaiters = new Set<() => void>()
  const generationSettlementWaiters = new Set<{
    check(): void
    cancel(error: ConvexCallError): void
  }>()
  let activeConfirmation: {
    client: AuthCapableClient
    generation: number
    promise: Promise<void>
    cancel(error: ConvexCallError): void
  } | null = null

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // Consumer observation must not change authentication state.
      }
    }
  }
  const resolveSettlement = () => {
    if (!snapshot.settled) return
    initialSettled = true
    for (const resolve of [...settlementWaiters]) resolve()
    settlementWaiters.clear()
  }
  const publish = (next: ClientIdentitySnapshot) => {
    snapshot = Object.freeze(next)
    resolveSettlement()
    for (const waiter of [...generationSettlementWaiters]) waiter.check()
    notify()
  }

  const waitForGenerationSettlement = (generation: number): Promise<void> => {
    if (snapshot.identityGeneration !== generation) {
      return Promise.reject(createIdentityChangedError('authentication refresh'))
    }
    if (snapshot.settled) {
      return snapshot.error ? Promise.reject(snapshot.error) : Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        check() {
          if (snapshot.identityGeneration !== generation) {
            waiter.cancel(createIdentityChangedError('authentication refresh'))
            return
          }
          if (!snapshot.settled) return
          generationSettlementWaiters.delete(waiter)
          if (snapshot.error) reject(snapshot.error)
          else resolve()
        },
        cancel(error: ConvexCallError) {
          generationSettlementWaiters.delete(waiter)
          reject(error)
        },
      }
      generationSettlementWaiters.add(waiter)
      waiter.check()
    })
  }

  const failClosed = (failedGeneration: number, cause: unknown) => {
    if (disposed || failedGeneration !== identityGeneration) return
    const rejection =
      cause instanceof ConvexCallError
        ? cause
        : new ConvexCallError({
            kind: 'authentication',
            message: 'Convex authentication failed',
          })
    identityGeneration += 1
    currentClient = null
    currentClientGeneration = -1
    desired = {
      status: 'error',
      identityKey: null,
      sessionGeneration: desired.sessionGeneration + 1,
      error: rejection,
    }
    publish({
      authEnabled: true,
      settled: true,
      identityKey: 'anonymous',
      identityGeneration,
      error: publicError(desired),
    })
    activeConfirmation?.cancel(rejection)
  }

  const confirm = (client: AuthCapableClient, expectedGeneration: number): Promise<void> => {
    if (
      activeConfirmation?.client === client &&
      activeConfirmation.generation === expectedGeneration
    ) {
      return activeConfirmation.promise
    }
    const superseded = createIdentityChangedError('authentication')
    activeConfirmation?.cancel(superseded)
    const configuration = {}
    activeAuthConfiguration.set(client, configuration)
    let resolvePromise!: () => void
    let rejectPromise!: (error: ConvexCallError) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const confirmation = {
      client,
      generation: expectedGeneration,
      promise,
      cancel(error: ConvexCallError) {
        finish(error)
      },
    }
    const finish = (error?: ConvexCallError) => {
      if (done) return
      done = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      if (activeConfirmation === confirmation) activeConfirmation = null
      if (error) rejectPromise(error)
      else resolvePromise()
    }
    activeConfirmation = confirmation
    timer = setTimeout(() => {
      const timeout = new ConvexCallError({
        kind: 'authentication',
        code: 'AUTH_CONFIRMATION_TIMEOUT',
        message: 'Convex authentication confirmation timed out',
      })
      failClosed(expectedGeneration, timeout)
      finish(timeout)
    }, CONFIRMATION_TIMEOUT_MS)
    try {
      client.setAuth(adapter.fetchToken, (authenticated) => {
        if (
          disposed ||
          expectedGeneration !== identityGeneration ||
          client !== currentClient ||
          activeAuthConfiguration.get(client) !== configuration
        ) {
          finish(createIdentityChangedError('authentication'))
          return
        }
        if (!authenticated) {
          const rejection = new ConvexCallError({
            kind: 'authentication',
            message: 'Convex rejected the authentication token',
          })
          failClosed(expectedGeneration, rejection)
          finish(rejection)
          return
        }
        publish({ ...snapshot, settled: true, error: null })
        finish()
      })
    } catch {
      const rejection = new ConvexCallError({
        kind: 'authentication',
        message: 'Convex authentication setup failed',
      })
      failClosed(expectedGeneration, rejection)
      finish(rejection)
    }
    return promise
  }

  const transition = (nextValue: BrowserAuthSnapshot) => {
    const next = validateSnapshot(nextValue)
    const previous = desired
    if (
      previous.status === next.status &&
      previous.identityKey === next.identityKey &&
      previous.sessionGeneration === next.sessionGeneration &&
      previous.error === next.error
    ) {
      return
    }
    desired = next
    const crossedIdentity =
      previous.status !== next.status ||
      previous.identityKey !== next.identityKey ||
      previous.sessionGeneration !== next.sessionGeneration

    if (crossedIdentity) {
      const retired = createIdentityChangedError('authentication')
      activeConfirmation?.cancel(retired)
      identityGeneration += 1
      currentClient = null
      currentClientGeneration = -1
      publish({
        authEnabled: true,
        settled: next.status === 'anonymous' || next.status === 'error',
        identityKey: clientIdentityKey(next),
        identityGeneration,
        error: publicError(next),
      })
      return
    }

    // The official Convex client owns same-session token refresh. This branch is
    // only an observable provider-error change within the current generation.
    publish({ ...snapshot, error: publicError(next) })
  }

  const unsubscribeAdapter = adapter.subscribe(() => {
    if (disposed) return
    try {
      transition(adapter.snapshot())
    } catch (cause) {
      transition({
        status: 'error',
        identityKey: null,
        sessionGeneration: desired.sessionGeneration + 1,
        error: cause instanceof Error ? cause : new Error('Invalid auth adapter state'),
      })
    }
  })

  return Object.freeze({
    snapshot: () => snapshot,
    waitForInitialSettlement: () => {
      if (initialSettled || snapshot.settled) return Promise.resolve()
      return new Promise<void>((resolve) => settlementWaiters.add(resolve))
    },
    subscribe(listener: () => void) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async initializePrimary(candidate: ConvexClient) {
      if (disposed) throw new Error('Auth adapter identity port is disposed.')
      const client = candidate as AuthCapableClient
      const generation = identityGeneration
      currentClient = client
      currentClientGeneration = generation
      if (desired.status !== 'authenticated') {
        // Replacement candidates are freshly constructed and therefore
        // anonymous. `convex/browser` exposes no `clearAuth()` on ConvexClient;
        // authenticated generations are retired by replacing the whole client.
        publish({ ...snapshot, settled: true })
        return
      }
      await confirm(client, generation)
    },
    failPrimary(failedGeneration: number, cause: unknown) {
      failClosed(failedGeneration, cause)
    },
    async refresh() {
      if (disposed) return
      await adapter.refreshSession()
      if (disposed || desired.status === 'anonymous') return
      if (desired.status !== 'authenticated') {
        throw (
          snapshot.error ??
          new ConvexCallError({
            kind: 'authentication',
            message: 'Authentication refresh failed',
          })
        )
      }
      const generation = identityGeneration
      const client = currentClient
      if (client) {
        await confirm(client, currentClientGeneration)
        return
      }
      await waitForGenerationSettlement(generation)
    },
    dispose() {
      if (disposed) return
      disposed = true
      const cancellation = new ConvexCallError({
        kind: 'authentication',
        message: 'Authentication runtime was disposed',
      })
      activeConfirmation?.cancel(cancellation)
      for (const waiter of [...generationSettlementWaiters]) waiter.cancel(cancellation)
      unsubscribeAdapter()
      listeners.clear()
      snapshot = Object.freeze({ ...snapshot, settled: true })
      resolveSettlement()
      currentClient = null
    },
  })
}
