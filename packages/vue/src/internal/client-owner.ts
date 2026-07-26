import type { ConnectionState, ConvexClient } from 'convex/browser'
import { shallowRef, readonly, type Ref } from 'vue'

import { createIdentityChangedError } from './identity-changed-error'
import type { ClientIdentityPort } from './identity-port'

/**
 * The per-integration client owner (architecture invariant `clients`).
 *
 * This is the single source of truth for the current primary `ConvexClient` and
 * the lazy anonymous `none` client. It owns:
 *   - the identity-scoped REPLACEABLE primary client (replaced on every stable
 *     identity-key change; same-user token rotation keeps the current client);
 *   - the LAZY anonymous client for `none` transport (constructed on first use;
 *     its WebSocket connects eagerly at construction, so lazy is mandatory);
 *   - retirement of the prior primary — close it, reject its in-flight
 *     consumer-held calls with `IDENTITY_CHANGED`;
 *   - one stable {@link ConvexClientHandle} (`query|mutation|action|onUpdate`)
 *     whose `onUpdate` listeners rebind A→B synchronously before B is published;
 *   - the connection-state store observed by `useConvexConnectionState`;
 *   - one deterministic disposer that closes every allocated client.
 *
 * The owner allocates NEITHER counter: `authEpoch`/`identityGeneration` are
 * supplied by the auth coordinator through {@link replacePrimary} /
 * {@link attachIdentityPort} (architecture invariant). The owner interprets no tokens.
 */
export interface ConvexClientOwner {
  /** Stable replacement-safe public handle returned by `useConvex()`. */
  readonly handle: ConvexClientHandle
  /** The current primary and its identity generation, or null if none exists. */
  getPrimary(): {
    client: OwnedConvexClient
    identityGeneration: number
  } | null
  /**
   * The `none`-transport anonymous client. In an auth-enabled build this is a
   * dedicated client that never receives `setAuth`; in an auth-disabled build
   * the permanently-anonymous primary is reused.
   */
  getAnonymous(): OwnedConvexClient
  /** Replace the primary for a new stable identity (architecture invariant). */
  replacePrimary(input: ReplacePrimaryInput): Promise<OwnedConvexClient>
  /**
   * Drive replacement reactively from the frozen auth port. On every
   * `identityGeneration` change the owner replaces the primary; an
   * `authEpoch`-only change (same-user token rotation) is ignored.
   */
  attachIdentityPort(port: ClientIdentityPort): void
  /** Connection-state observation surface for `useConvexConnectionState`. */
  readonly connection: {
    readonly state: Readonly<Ref<ConnectionState>>
    /** Register one consumer; subscribes on first, unsubscribes on last. */
    addConsumer(): () => void
  }
  /** Register a teardown callback run by {@link dispose}. */
  addDisposer(dispose: () => void): void
  /** Observe committed identity-generation changes; listeners never own authority. */
  subscribeIdentityChange(listener: () => void): () => void
  /** Idempotent teardown: closes primary + anonymous, drops all listeners. */
  dispose(): Promise<void>
}

/**
 * The public stable handle. Exactly `query | mutation | action |
 * onUpdate`; `connectionState`/`setAuth`/`clearAuth`/`close` are intentionally
 * absent. `onUpdate`'s return preserves the augmented `Unsubscribe` shape so the
 * handle stays assignable to `ConvexClient['onUpdate']`.
 */
export interface ConvexClientHandle {
  query: ConvexClient['query']
  mutation: ConvexClient['mutation']
  action: ConvexClient['action']
  onUpdate: ConvexClient['onUpdate']
}

/**
 * The narrow client surface the owner drives. `ConvexClient` satisfies it; the
 * owner depends on this shape (not the whole class) so unit tests can substitute
 * a double.
 */
export interface OwnedConvexClient {
  query: ConvexClient['query']
  mutation: ConvexClient['mutation']
  action: ConvexClient['action']
  onUpdate: ConvexClient['onUpdate']
  connectionState(): ConnectionState
  subscribeToConnectionState(cb: (state: ConnectionState) => void): () => void
  close(): Promise<void>
}

export interface ReplacePrimaryInput {
  /** Generation assigned by the auth coordinator; the owner never allocates it. */
  identityGeneration: number
  /**
   * Latest-revision-wins guard, checked synchronously immediately before commit
   * with no `await` between the guard and publication. A stale candidate closes
   * without publishing.
   */
  isCurrent: () => boolean
  /**
   * Confirm the candidate before publication. For an authenticated identity this
   * runs the auth port's server-confirmed handshake; the owner awaits it and
   * interprets nothing about tokens.
   */
  initialize: (candidate: OwnedConvexClient) => Promise<void>
}

export interface CreateConvexClientOwnerInput {
  /** Constructs the primary client and every replacement candidate. */
  primaryFactory: () => OwnedConvexClient
  /**
   * Constructs the dedicated `none` anonymous client. Omit in an auth-disabled
   * build so `getAnonymous()` reuses the already-anonymous primary.
   */
  anonymousFactory?: () => OwnedConvexClient
  /** Optional adapter-owned observer for a retired client's background close failure. */
  onRetiredClientCloseError?: (cause: unknown) => void
}

const DEFAULT_CONNECTION_STATE: ConnectionState = {
  hasInflightRequests: false,
  isWebSocketConnected: false,
  timeOfOldestInflightRequest: null,
  hasEverConnected: false,
  connectionCount: 0,
  connectionRetries: 0,
  inflightMutations: 0,
  inflightActions: 0,
}

type OwnedUnsubscribe = ReturnType<ConvexClient['onUpdate']> & {
  /** Present at runtime in Convex 1.40 but stripped from its public declarations. */
  getQueryLogs(): string[] | undefined
}

interface OnUpdateEntry {
  query: unknown
  args: unknown
  callback: (result: unknown) => unknown
  onError?: (e: Error) => unknown
  underlying: OwnedUnsubscribe | null
  active: boolean
}

interface PendingCall {
  generation: number
  reject: (reason: unknown) => void
}

export function createConvexClientOwner(input: CreateConvexClientOwnerInput): ConvexClientOwner {
  const { primaryFactory, anonymousFactory, onRetiredClientCloseError } = input

  let primary: OwnedConvexClient | null = primaryFactory()
  let currentIdentityGeneration = 0
  let anonymous: OwnedConvexClient | null = null
  let disposed = false
  let resolveDisposed!: () => void
  const disposedSignal = new Promise<void>((resolve) => {
    resolveDisposed = resolve
  })
  let disposePromise: Promise<void> | null = null
  let replacementInFlight: Promise<OwnedConvexClient> | null = null
  let authPort: ClientIdentityPort | null = null
  const replacementCandidates = new Set<OwnedConvexClient>()
  const closedReplacementCandidates = new WeakSet<OwnedConvexClient>()

  const listeners = new Set<OnUpdateEntry>()
  const pendingCalls = new Set<PendingCall>()
  const disposers = new Set<() => void>()
  const identityListeners = new Set<() => void>()

  function closeReplacementCandidate(candidate: OwnedConvexClient): Promise<void> {
    if (closedReplacementCandidates.has(candidate)) return Promise.resolve()
    closedReplacementCandidates.add(candidate)
    return candidate.close()
  }

  function closeRetiredPrimary(client: OwnedConvexClient): void {
    const reportCloseError = (error: unknown) => {
      try {
        onRetiredClientCloseError?.(error)
      } catch {
        // Adapter diagnostics must never affect client retirement.
      }
    }
    try {
      void client.close().catch(reportCloseError)
    } catch (error) {
      // Retirement is the synchronous `primary = null` boundary below. A
      // non-conforming client that throws from close must not reopen that path
      // or prevent the replacement failure from reaching the auth port.
      reportCloseError(error)
    }
  }

  // ---- connection-state store (owned here; single ownership) ----------
  const connectionState = shallowRef<ConnectionState>({
    ...DEFAULT_CONNECTION_STATE,
  })
  let connectionUnsubscribe: (() => void) | null = null
  let connectionConsumers = 0

  function subscribeConnection() {
    if (!primary || connectionUnsubscribe) return
    connectionState.value = primary.connectionState()
    connectionUnsubscribe = primary.subscribeToConnectionState((state) => {
      connectionState.value = state
    })
  }
  function unsubscribeConnection() {
    connectionUnsubscribe?.()
    connectionUnsubscribe = null
  }
  // On replacement: reset synchronously to the disconnected default, drop the
  // old subscription (old-epoch callbacks are thereby ignored), and re-subscribe
  // to the replacement only when it has consumers (architecture invariant).
  function resetConnectionForReplacement() {
    unsubscribeConnection()
    connectionState.value = { ...DEFAULT_CONNECTION_STATE }
    if (connectionConsumers > 0) subscribeConnection()
  }

  // ---- onUpdate listener registry -------------------------------------------
  function subscribeEntry(entry: OnUpdateEntry) {
    if (!primary || (authPort && !authPort.snapshot().settled)) return
    const subscribedClient = primary
    const subscribedGeneration = currentIdentityGeneration
    const isCurrentSubscription = () =>
      entry.active &&
      primary === subscribedClient &&
      currentIdentityGeneration === subscribedGeneration
    entry.underlying = (
      subscribedClient.onUpdate as (
        q: unknown,
        a: unknown,
        cb: (r: unknown) => unknown,
        onErr?: (e: Error) => unknown,
      ) => OwnedUnsubscribe
    )(
      entry.query,
      entry.args,
      (result) => {
        if (isCurrentSubscription()) return entry.callback(result)
      },
      (error) => {
        if (isCurrentSubscription()) return entry.onError?.(error)
      },
    )
  }
  function detachEntry(entry: OnUpdateEntry) {
    entry.underlying?.()
    entry.underlying = null
  }
  // Rebind every active listener A→B: detach from A first, swap `primary`, then
  // reattach on B — fully synchronous, before B is published to consumers.
  function rebindListeners(newClient: OwnedConvexClient) {
    for (const entry of listeners) detachEntry(entry)
    primary = newClient
    for (const entry of listeners) subscribeEntry(entry)
  }

  // ---- pending consumer-held call tracking (IDENTITY_CHANGED rejection) -----
  function rejectPendingForGeneration(generation: number) {
    for (const pending of [...pendingCalls]) {
      if (pending.generation === generation) {
        pendingCalls.delete(pending)
        pending.reject(createIdentityChangedError())
      }
    }
  }
  function rejectAllPending() {
    for (const pending of [...pendingCalls]) {
      pendingCalls.delete(pending)
      pending.reject(createIdentityChangedError())
    }
  }

  // Await any replacement already in progress and never dispatch to a superseded
  // client. Throws if no usable primary survives.
  async function primaryForDispatch(): Promise<{
    client: OwnedConvexClient
    identityGeneration: number
  }> {
    if (authPort && !authPort.snapshot().settled) {
      await Promise.race([authPort.waitForInitialSettlement(), disposedSignal])
    }
    if (replacementInFlight) {
      try {
        await replacementInFlight
      } catch {
        // Replacement failure is surfaced by the null-primary check below.
      }
    }
    if (disposed || !primary) throw createIdentityChangedError()
    return { client: primary, identityGeneration: currentIdentityGeneration }
  }

  async function dispatch(
    method: 'query' | 'mutation' | 'action',
    fn: unknown,
    args: unknown,
    // The optional third argument (`mutation`'s optimistic-update option) is
    // forwarded verbatim to the current primary so routing through the handle
    // never silently drops it; the handle stays behaviourally equal to
    // the raw client for the four supported operations).
    options?: unknown,
  ): Promise<unknown> {
    // Capture the caller's identity synchronously, before auth settlement can
    // suspend this dispatch. A call entered by generation A must never resume
    // against generation B merely because B settled while the caller waited.
    const entryGeneration = authPort?.snapshot().identityGeneration ?? currentIdentityGeneration
    const target = await primaryForDispatch()
    const { client, identityGeneration: generation } = target
    // `primaryForDispatch` necessarily crosses a promise boundary. Re-check its
    // atomic client+generation snapshot before invoking the wire method so a
    // synchronous retirement between capture and continuation cannot dispatch
    // once more through the retired principal.
    if (
      disposed ||
      generation !== entryGeneration ||
      (authPort?.snapshot().identityGeneration ?? currentIdentityGeneration) !== entryGeneration ||
      primary !== client ||
      currentIdentityGeneration !== generation
    ) {
      throw createIdentityChangedError(method)
    }
    let reject!: (reason: unknown) => void
    const aborted = new Promise<never>((_, r) => {
      reject = r
    })
    const pending: PendingCall = { generation, reject }
    pendingCalls.add(pending)

    // The underlying promise may never settle after `close()` (retired-client
    // hygiene); attach a no-op catch so a late rejection after we've raced away
    // via `aborted` never becomes an unhandled rejection.
    const underlying = (
      client[method] as (f: unknown, a: unknown, o?: unknown) => Promise<unknown>
    )(fn, args, options)
    underlying.catch(() => {})

    try {
      const result = await Promise.race([underlying, aborted])
      if (
        disposed ||
        currentIdentityGeneration !== generation ||
        (authPort?.snapshot().identityGeneration ?? currentIdentityGeneration) !== entryGeneration
      ) {
        throw createIdentityChangedError(method)
      }
      return result
    } finally {
      pendingCalls.delete(pending)
    }
  }

  const handle: ConvexClientHandle = {
    query: ((fn: unknown, args: unknown) => dispatch('query', fn, args)) as ConvexClient['query'],
    mutation: ((fn: unknown, args: unknown, options?: unknown) =>
      dispatch('mutation', fn, args, options)) as ConvexClient['mutation'],
    action: ((fn: unknown, args: unknown) =>
      dispatch('action', fn, args)) as ConvexClient['action'],
    onUpdate: ((
      query: unknown,
      args: unknown,
      callback: (result: unknown) => unknown,
      onError?: (e: Error) => unknown,
    ) => {
      if (disposed) {
        const stop = () => {}
        const unsubscribe = stop as OwnedUnsubscribe
        unsubscribe.unsubscribe = stop
        unsubscribe.getCurrentValue = () => undefined
        unsubscribe.getQueryLogs = () => undefined
        return unsubscribe
      }

      const entry: OnUpdateEntry = {
        query,
        args,
        callback,
        onError,
        underlying: null,
        active: true,
      }
      listeners.add(entry)
      subscribeEntry(entry)
      // Stable unsubscribe: closes over the registry entry (not a per-client
      // unsubscribe), so it detaches whichever client is current after A→B, and
      // preserves the augmented `Unsubscribe` shape (`unsubscribe`,
      // `getCurrentValue`, `getQueryLogs`).
      const stop = () => {
        if (!entry.active) return
        entry.active = false
        listeners.delete(entry)
        detachEntry(entry)
      }
      const unsubscribe = stop as OwnedUnsubscribe
      unsubscribe.unsubscribe = stop
      unsubscribe.getCurrentValue = () => entry.underlying?.getCurrentValue?.()
      unsubscribe.getQueryLogs = () => entry.underlying?.getQueryLogs?.()
      return unsubscribe
    }) as ConvexClient['onUpdate'],
  }

  function replacePrimary(replaceInput: ReplacePrimaryInput): Promise<OwnedConvexClient> {
    if (disposed) return Promise.reject(new Error('[client-owner] disposed'))

    const previous = primary
    const previousGeneration = currentIdentityGeneration

    // An identity transition is a security boundary. Retire the previous
    // principal before even constructing the candidate. A synchronous factory
    // failure must leave no dispatchable client authenticated as the old user.
    for (const entry of listeners) detachEntry(entry)
    primary = null
    resetConnectionForReplacement()
    rejectPendingForGeneration(previousGeneration)
    if (previous) closeRetiredPrimary(previous)

    let candidate: OwnedConvexClient | null = null
    const run = (async () => {
      try {
        // Keep factory construction inside this promise boundary. In particular,
        // attachIdentityPort must receive a rejected promise (and call failPrimary),
        // never a synchronous exception escaping the auth-port listener.
        candidate = primaryFactory()
        replacementCandidates.add(candidate)
        await Promise.race([replaceInput.initialize(candidate), disposedSignal])
        if (disposed) throw createIdentityChangedError()
      } catch (error) {
        // The candidate's WebSocket opens at construction; a
        // rejected/guard-failed confirmation must not leak it. Close before
        // rethrowing so the caller's error contract is unchanged.
        if (candidate) await closeReplacementCandidate(candidate)
        throw error
      }

      // `candidate` was assigned before the only successful path through the
      // try block. Keep the guard explicit for TypeScript and fail closed if a
      // future factory path violates that invariant.
      if (!candidate) throw createIdentityChangedError()

      // Latest-revision-wins. No `await` between this guard and publication.
      if (disposed || !replaceInput.isCurrent()) {
        await closeReplacementCandidate(candidate)
        throw createIdentityChangedError()
      }

      // Synchronous commit region: rebind listeners A→B (detach-swap-reattach,
      // which also reassigns `primary`), then publish the new generation and
      // reset connection observation. The prior primary was already retired at
      // the crossed generation boundary above.
      currentIdentityGeneration = replaceInput.identityGeneration
      rebindListeners(candidate)
      resetConnectionForReplacement()
      for (const listener of [...identityListeners]) {
        try {
          listener()
        } catch {
          // Adapter observers must never affect identity publication.
        }
      }
      // Defensive second sweep for a call that captured the prior generation
      // immediately before retirement and registered at its edge.
      rejectPendingForGeneration(previousGeneration)
      return candidate
    })().finally(() => {
      // A factory failure has no candidate; successful and failed candidates are
      // both removed from the disposal registry after their run settles.
      if (candidate) replacementCandidates.delete(candidate)
    })

    replacementInFlight = run
    void run
      .catch(() => {})
      .finally(() => {
        if (replacementInFlight === run) replacementInFlight = null
      })
    return run
  }

  function attachIdentityPort(port: ClientIdentityPort): void {
    authPort = port
    // A generation represents one security boundary and receives one candidate
    // attempt. Persistent factory/confirmation failure is terminal for that
    // generation; recovery requires a new coordinator transition/generation,
    // not an epoch notification that can spin client construction indefinitely.
    let observedGeneration = port.snapshot().identityGeneration
    let observedSettled = port.snapshot().settled
    const unsubscribe = port.subscribe(() => {
      const snapshot = port.snapshot()
      const becameSettled = !observedSettled && snapshot.settled
      observedSettled = snapshot.settled
      if (becameSettled) {
        for (const entry of listeners) {
          if (!entry.underlying) subscribeEntry(entry)
        }
      }
      // Only a stable identity-key change replaces the primary. An epoch-only
      // change (same-user token rotation) keeps the current client.
      if (snapshot.identityGeneration === observedGeneration) return
      const targetGeneration = snapshot.identityGeneration
      observedGeneration = targetGeneration
      void replacePrimary({
        identityGeneration: targetGeneration,
        isCurrent: () => port.snapshot().identityGeneration === targetGeneration,
        initialize: (candidate) => port.initializePrimary(candidate as ConvexClient),
      }).catch((error) => {
        port.failPrimary(targetGeneration, error)
      })
    })
    addDisposer(() => {
      unsubscribe()
      if (authPort === port) authPort = null
    })
  }

  function getAnonymous(): OwnedConvexClient {
    if (disposed) throw new Error('[client-owner] disposed')
    if (anonymousFactory) {
      if (!anonymous) anonymous = anonymousFactory()
      return anonymous
    }
    // Auth-disabled build: the primary is permanently anonymous, so reuse it.
    if (!primary) throw createIdentityChangedError()
    return primary
  }

  function addDisposer(dispose: () => void): void {
    // A disposer registered after teardown began runs immediately.
    if (disposed) {
      try {
        dispose()
      } catch {
        // Late-cleanup errors are swallowed so they never block other teardown.
      }
      return
    }
    disposers.add(dispose)
  }

  function subscribeIdentityChange(listener: () => void): () => void {
    if (disposed) return () => {}
    identityListeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      identityListeners.delete(listener)
    }
  }

  function dispose(): Promise<void> {
    if (disposePromise) return disposePromise
    disposed = true // marked before the first await so no late attach mutates state
    resolveDisposed()
    disposePromise = (async () => {
      for (const d of [...disposers]) {
        try {
          d()
        } catch {
          // collect-and-continue
        }
      }
      disposers.clear()
      unsubscribeConnection()
      for (const entry of [...listeners]) {
        entry.active = false
        detachEntry(entry)
      }
      listeners.clear()
      rejectAllPending()
      identityListeners.clear()
      // Candidate confirmation is controlled by an external auth client and may
      // never settle. Closing all allocated candidates is the cancellation
      // boundary; disposal itself must remain bounded.
      await Promise.allSettled([...replacementCandidates].map(closeReplacementCandidate))
      replacementCandidates.clear()
      const clients = new Set<OwnedConvexClient>()
      if (primary) clients.add(primary)
      if (anonymous) clients.add(anonymous)
      await Promise.allSettled([...clients].map((client) => client.close()))
      primary = null
      anonymous = null
    })()
    return disposePromise
  }

  return {
    handle,
    getPrimary() {
      if (!primary) return null
      return { client: primary, identityGeneration: currentIdentityGeneration }
    },
    getAnonymous,
    replacePrimary,
    attachIdentityPort,
    connection: {
      state: readonly(connectionState) as Readonly<Ref<ConnectionState>>,
      addConsumer() {
        connectionConsumers += 1
        if (connectionConsumers === 1) subscribeConnection()
        let removed = false
        return () => {
          if (removed) return
          removed = true
          connectionConsumers -= 1
          if (connectionConsumers === 0) unsubscribeConnection()
        }
      },
    },
    addDisposer,
    subscribeIdentityChange,
    dispose,
  }
}
