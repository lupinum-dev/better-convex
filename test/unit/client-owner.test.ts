import type { ConnectionState } from 'convex/browser'
import { describe, expect, it, vi } from 'vitest'

import {
  createConvexClientOwner,
  type OwnedConvexClient,
} from '../../packages/vue/src/internal/client-owner'
import { IDENTITY_CHANGED } from '../../packages/vue/src/internal/identity-changed-error'
import type {
  ClientIdentityPort,
  ClientIdentitySnapshot,
} from '../../packages/vue/src/internal/identity-port'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'

type RuntimeUnsubscribe = ReturnType<OwnedConvexClient['onUpdate']> & {
  getQueryLogs(): string[] | undefined
}

/**
 * A counting ConvexClient double for the owner's lifecycle invariants (internal
 * "count effects, not only visible outcomes"). It records close() calls,
 * onUpdate subscribe/unsubscribe counts, and exposes controllable mutation
 * settlement so we can hold a mutation in flight across a replacement.
 */
class CountingClient extends MockConvexClient {
  static created = 0
  static closed = 0
  readonly ordinal: number
  closeCalls = 0

  constructor() {
    super()
    CountingClient.created += 1
    this.ordinal = CountingClient.created
    const subscribe = this.onUpdate
    this.onUpdate = ((...args: Parameters<typeof subscribe>) => {
      const stop = subscribe(...args)
      const augmented = stop as typeof stop & {
        unsubscribe(): void
        getCurrentValue(): string
        getQueryLogs(): string[]
      }
      augmented.unsubscribe = stop
      augmented.getCurrentValue = () => `current:${this.ordinal}`
      augmented.getQueryLogs = () => [`logs:${this.ordinal}`]
      return augmented
    }) as typeof this.onUpdate
  }

  close = async (): Promise<void> => {
    this.closeCalls += 1
    CountingClient.closed += 1
    // A real retired client never settles its in-flight mutation; mirror that by
    // resolving close() while leaving any pending mutation promise hanging.
    return Promise.resolve()
  }

  /** A mutation that never settles — models a mutation in flight across close(). */
  hangingMutation() {
    return new Promise<string>(() => {})
  }
}

function owner(withAnonymous = true) {
  return createConvexClientOwner({
    primaryFactory: () => new CountingClient() as unknown as OwnedConvexClient,
    ...(withAnonymous
      ? {
          anonymousFactory: () => new CountingClient() as unknown as OwnedConvexClient,
        }
      : {}),
  })
}

function resetCounts() {
  CountingClient.created = 0
  CountingClient.closed = 0
}

/** Minimal fake auth port emitting identity-generation transitions on demand. */
function fakePort(initial: Partial<ClientIdentitySnapshot> = {}) {
  let snap: ClientIdentitySnapshot = {
    authEnabled: true,
    settled: true,
    identityKey: 'anonymous',
    identityGeneration: 0,
    error: null,
    ...initial,
  }
  const listeners = new Set<() => void>()
  const settlementWaiters = new Set<() => void>()
  const initializePrimary = vi.fn(async () => {})
  const failPrimary = vi.fn()
  const port: ClientIdentityPort = {
    snapshot: () => snap,
    waitForInitialSettlement: () => {
      if (snap.settled) return Promise.resolve()
      return new Promise<void>((resolve) => settlementWaiters.add(resolve))
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    initializePrimary,
    failPrimary,
  }
  const emit = (next: Partial<ClientIdentitySnapshot>) => {
    snap = { ...snap, ...next }
    if (snap.settled) {
      for (const resolve of [...settlementWaiters]) resolve()
      settlementWaiters.clear()
    }
    for (const l of [...listeners]) l()
  }
  return { port, emit, initializePrimary, failPrimary, current: () => snap }
}

describe('createConvexClientOwner', () => {
  it('creates one primary eagerly and exposes a stable handle', () => {
    resetCounts()
    const o = owner()
    expect(CountingClient.created).toBe(1) // anonymous is lazy, not created yet
    const primary = o.getPrimary()
    expect(primary?.identityGeneration).toBe(0)
    // Handle identity is stable across reads.
    expect(o.handle.query).toBe(o.handle.query)
  })

  it('creates the anonymous client lazily and reuses it', () => {
    resetCounts()
    const o = owner()
    expect(CountingClient.created).toBe(1)
    const a1 = o.getAnonymous()
    expect(CountingClient.created).toBe(2)
    const a2 = o.getAnonymous()
    expect(a2).toBe(a1)
    expect(CountingClient.created).toBe(2)
  })

  it('reuses the primary for anonymous transport when no anonymousFactory is given (auth-disabled)', () => {
    resetCounts()
    const o = owner(false)
    expect(o.getAnonymous()).toBe(o.getPrimary()!.client)
    expect(CountingClient.created).toBe(1)
  })

  describe('replacePrimary', () => {
    it('notifies adapter observers only when publishing a replacement', async () => {
      resetCounts()
      const o = owner()
      const observer = vi.fn()
      const unsubscribe = o.subscribeIdentityChange(observer)

      await o.replacePrimary({
        identityGeneration: 1,
        isCurrent: () => true,
        initialize: async () => {},
      })

      expect(observer).toHaveBeenCalledTimes(1)
      unsubscribe()
      await o.replacePrimary({
        identityGeneration: 2,
        isCurrent: () => true,
        initialize: async () => {},
      })
      expect(observer).toHaveBeenCalledTimes(1)
      await o.dispose()
    })

    it('creates B, publishes it, closes A, and advances the generation (create/close balance)', async () => {
      resetCounts()
      const o = owner()
      const a = o.getPrimary()!.client as unknown as CountingClient
      await o.replacePrimary({
        identityGeneration: 1,
        isCurrent: () => true,
        initialize: async () => {},
      })
      const b = o.getPrimary()!.client as unknown as CountingClient
      expect(b).not.toBe(a)
      expect(o.getPrimary()!.identityGeneration).toBe(1)
      expect(a.closeCalls).toBe(1) // A retired exactly once
      expect(b.closeCalls).toBe(0)
      expect(CountingClient.created).toBe(2) // A + B, no anonymous
    })

    it('contains adapter diagnostics when retired client close rejects', async () => {
      class RejectingCloseClient extends MockConvexClient {
        close = async (): Promise<void> => {
          throw new Error('close failed')
        }
      }
      let factoryCalls = 0
      const onRetiredClientCloseError = vi.fn(() => {
        throw new Error('diagnostic observer failed')
      })
      const o = createConvexClientOwner({
        primaryFactory: () => {
          factoryCalls += 1
          return (factoryCalls === 1
            ? new RejectingCloseClient()
            : new CountingClient()) as unknown as OwnedConvexClient
        },
        onRetiredClientCloseError,
      })

      const replacement = await o.replacePrimary({
        identityGeneration: 1,
        isCurrent: () => true,
        initialize: async () => {},
      })
      expect(replacement).toBe(o.getPrimary()?.client)
      await vi.waitFor(() => expect(onRetiredClientCloseError).toHaveBeenCalledTimes(1))
      await o.dispose()
    })

    it('rejects an in-flight consumer-held mutation with IDENTITY_CHANGED on retirement', async () => {
      resetCounts()
      const o = owner()
      const a = o.getPrimary()!.client as unknown as CountingClient
      a.setMutationHandler('m', () => a.hangingMutation())

      const inflight = o.handle.mutation(mockFnRef<'mutation'>('m'), {})
      const assertion = expect(inflight).rejects.toMatchObject({
        code: IDENTITY_CHANGED,
      })

      await o.replacePrimary({
        identityGeneration: 1,
        isCurrent: () => true,
        initialize: async () => {},
      })
      await assertion
    })

    it('closes the candidate and leaves no prior principal dispatchable when initialize rejects', async () => {
      resetCounts()
      const o = owner()
      const a = o.getPrimary()!.client as unknown as CountingClient
      const failure = new Error('confirmation failed')

      await expect(
        o.replacePrimary({
          identityGeneration: 1,
          isCurrent: () => true,
          initialize: async () => {
            throw failure
          },
        }),
      ).rejects.toBe(failure)

      expect(o.getPrimary()).toBeNull()
      await expect(o.handle.query(mockFnRef<'query'>('q'), {})).rejects.toMatchObject({
        code: IDENTITY_CHANGED,
      })

      // create/close balance: A (still open) + candidate B (created then closed).
      expect(CountingClient.created).toBe(2)
      expect(CountingClient.closed).toBe(2)
      expect(a.closeCalls).toBe(1)

      // Dispose still exits clean afterward.
      await o.dispose()
      expect(CountingClient.closed).toBe(2)
    })

    it('retires the prior principal before a synchronous replacement factory failure', async () => {
      resetCounts()
      const factoryFailure = new Error('primary factory failed')
      let factoryCalls = 0
      const o = createConvexClientOwner({
        primaryFactory: () => {
          factoryCalls += 1
          if (factoryCalls === 2) throw factoryFailure
          return new CountingClient() as unknown as OwnedConvexClient
        },
      })
      const a = o.getPrimary()!.client as unknown as CountingClient
      a.setMutationHandler('m', () => a.hangingMutation())
      const inflight = o.handle.mutation(mockFnRef<'mutation'>('m'), {})
      const inflightAssertion = expect(inflight).rejects.toMatchObject({
        code: IDENTITY_CHANGED,
      })
      // Let dispatch register the consumer-held call on A before crossing the
      // generation boundary.
      await Promise.resolve()

      let replacement: Promise<OwnedConvexClient> | undefined
      expect(() => {
        replacement = o.replacePrimary({
          identityGeneration: 1,
          isCurrent: () => true,
          initialize: async () => {},
        })
      }).not.toThrow()

      // Retirement is synchronous even though the factory error is delivered
      // through the returned promise.
      expect(o.getPrimary()).toBeNull()
      expect(a.closeCalls).toBe(1)
      await inflightAssertion
      await expect(replacement).rejects.toBe(factoryFailure)
      await expect(o.handle.query(mockFnRef<'query'>('q'), {})).rejects.toMatchObject({
        code: IDENTITY_CHANGED,
      })
      expect(factoryCalls).toBe(2)
      expect(CountingClient.created).toBe(1)
      expect(CountingClient.closed).toBe(1)

      await o.dispose()
      expect(CountingClient.closed).toBe(1)
    })

    it('a stale candidate (isCurrent=false) is closed and never published', async () => {
      resetCounts()
      const o = owner()
      const a = o.getPrimary()!.client as unknown as CountingClient
      await expect(
        o.replacePrimary({
          identityGeneration: 1,
          isCurrent: () => false,
          initialize: async () => {},
        }),
      ).rejects.toMatchObject({ code: IDENTITY_CHANGED })
      expect(o.getPrimary()).toBeNull()
      expect(CountingClient.created).toBe(2)
      expect(CountingClient.closed).toBe(2)
      expect(a.closeCalls).toBe(1)
    })
  })

  describe('onUpdate rebinding', () => {
    it('rebinds active listeners A→B with a stable unsubscribe and exactly one live subscription', async () => {
      resetCounts()
      const o = owner()
      const a = o.getPrimary()!.client as unknown as CountingClient
      const cb = vi.fn()
      const unsubscribe = o.handle.onUpdate(mockFnRef<'query'>('q'), {}, cb) as RuntimeUnsubscribe

      expect(a.activeListenerCount()).toBe(1)
      expect(unsubscribe.unsubscribe).toBe(unsubscribe)
      expect(unsubscribe.getCurrentValue()).toBe('current:1')
      expect(unsubscribe.getQueryLogs()).toEqual(['logs:1'])

      await o.replacePrimary({
        identityGeneration: 1,
        isCurrent: () => true,
        initialize: async () => {},
      })
      const b = o.getPrimary()!.client as unknown as CountingClient

      // Detached from A, reattached to B — exactly one live subscription total.
      expect(a.activeListenerCount()).toBe(0)
      expect(b.activeListenerCount()).toBe(1)
      expect(unsubscribe.getCurrentValue()).toBe('current:2')
      expect(unsubscribe.getQueryLogs()).toEqual(['logs:2'])

      // The unsubscribe identity is stable and removes the CURRENT (B) subscription.
      unsubscribe()
      expect(b.activeListenerCount()).toBe(0)
      // Idempotent.
      unsubscribe()
      expect(b.activeListenerCount()).toBe(0)
    })

    it('a B-side emission still reaches the original callback after rebinding', async () => {
      resetCounts()
      const o = owner()
      const cb = vi.fn()
      o.handle.onUpdate(mockFnRef<'query'>('q'), {}, cb)
      await o.replacePrimary({
        identityGeneration: 1,
        isCurrent: () => true,
        initialize: async () => {},
      })
      const b = o.getPrimary()!.client as unknown as CountingClient
      b.emitQueryResultByPath('q', 42)
      expect(cb).toHaveBeenCalledWith(42)
    })

    it('drops an already queued callback from the retired client', async () => {
      resetCounts()
      const o = owner()
      const a = o.getPrimary()!.client as unknown as CountingClient
      const cb = vi.fn()
      o.handle.onUpdate(mockFnRef<'query'>('q'), {}, cb)
      const deliverQueuedAResult = a.queuedQueryResultByPath('q', 'stale')

      await o.replacePrimary({
        identityGeneration: 1,
        isCurrent: () => true,
        initialize: async () => {},
      })
      deliverQueuedAResult()

      expect(cb).not.toHaveBeenCalled()
    })

    it('settles a pending replacement and closes its candidate during disposal', async () => {
      resetCounts()
      const o = owner()
      const replacement = o.replacePrimary({
        identityGeneration: 1,
        isCurrent: () => true,
        initialize: () => new Promise<void>(() => {}),
      })

      await o.dispose()

      await expect(replacement).rejects.toMatchObject({
        code: IDENTITY_CHANGED,
      })
      expect(CountingClient.created).toBe(2)
      expect(CountingClient.closed).toBeGreaterThanOrEqual(2)
    })
  })

  describe('handle dispatch generation guard', () => {
    const rawCallCases = [
      {
        method: 'query',
        invoke: (o: ReturnType<typeof owner>, path: string) =>
          o.handle.query(mockFnRef<'query'>(path), {}),
        prepare: (client: CountingClient, path: string, value: string) =>
          client.setQueryHandler(path, () => value),
        calls: (client: CountingClient) => client.calls.query,
      },
      {
        method: 'mutation',
        invoke: (o: ReturnType<typeof owner>, path: string) =>
          o.handle.mutation(mockFnRef<'mutation'>(path), {}),
        prepare: (client: CountingClient, path: string, value: string) =>
          client.setMutationHandler(path, () => value),
        calls: (client: CountingClient) => client.calls.mutation,
      },
      {
        method: 'action',
        invoke: (o: ReturnType<typeof owner>, path: string) =>
          o.handle.action(mockFnRef<'action'>(path), {}),
        prepare: (client: CountingClient, path: string, value: string) =>
          client.setActionHandler(path, () => value),
        calls: (client: CountingClient) => client.calls.action,
      },
    ] as const

    for (const rawCall of rawCallCases) {
      it(`rejects a raw ${rawCall.method} entered while generation A is unsettled before generation B can dispatch it`, async () => {
        resetCounts()
        const { port, emit } = fakePort({ settled: false })
        const o = owner()
        o.attachIdentityPort(port)
        const stableHandle = o.handle
        const a = o.getPrimary()!.client as unknown as CountingClient
        const path = `${rawCall.method}:crossing`

        const pending = rawCall.invoke(o, path)
        const rejection = expect(pending).rejects.toMatchObject({
          code: IDENTITY_CHANGED,
        })
        expect(rawCall.calls(a)).toHaveLength(0)

        emit({
          settled: true,
          identityKey: 'user:bob',
          identityGeneration: 1,
        })

        await rejection
        await vi.waitFor(() => expect(o.getPrimary()?.identityGeneration).toBe(1))
        const b = o.getPrimary()!.client as unknown as CountingClient
        expect(rawCall.calls(a)).toHaveLength(0)
        expect(rawCall.calls(b)).toHaveLength(0)
        expect(o.handle).toBe(stableHandle)

        rawCall.prepare(b, path, 'generation-b')
        await expect(rawCall.invoke(o, path)).resolves.toBe('generation-b')
        expect(rawCall.calls(b)).toHaveLength(1)
        await o.dispose()
      })

      it(`waits and runs a raw ${rawCall.method} when auth settles in the same generation`, async () => {
        resetCounts()
        const { port, emit } = fakePort({ settled: false })
        const o = owner()
        o.attachIdentityPort(port)
        const a = o.getPrimary()!.client as unknown as CountingClient
        const path = `${rawCall.method}:same-generation`
        rawCall.prepare(a, path, 'generation-a')

        const pending = rawCall.invoke(o, path)
        expect(rawCall.calls(a)).toHaveLength(0)
        emit({ settled: true, identityKey: 'anonymous', identityGeneration: 0 })

        await expect(pending).resolves.toBe('generation-a')
        expect(rawCall.calls(a)).toHaveLength(1)
        await o.dispose()
      })
    }

    it('resolves normally when the generation is unchanged', async () => {
      resetCounts()
      const o = owner()
      const a = o.getPrimary()!.client as unknown as CountingClient
      a.setQueryHandler('q', () => 'ok')
      await expect(o.handle.query(mockFnRef<'query'>('q'), {})).resolves.toBe('ok')
    })

    it('does not reject a same-generation notification', async () => {
      resetCounts()
      const { port, emit } = fakePort()
      const o = owner()
      o.attachIdentityPort(port)
      const a = o.getPrimary()!.client as unknown as CountingClient
      a.setQueryHandler('q', () => 'ok')
      emit({})
      await Promise.resolve()
      expect(o.getPrimary()!.client).toBe(a as unknown as OwnedConvexClient)
      expect(CountingClient.created).toBe(1) // no replacement client created
    })
  })

  describe('attachIdentityPort reactive replacement', () => {
    it('replaces the primary exactly on identityGeneration changes', async () => {
      resetCounts()
      const { port, emit, initializePrimary } = fakePort()
      const o = owner()
      o.attachIdentityPort(port)

      // Same-generation notification → no replacement.
      emit({})
      await Promise.resolve()
      expect(CountingClient.created).toBe(1)
      expect(initializePrimary).not.toHaveBeenCalled()

      // identity change → replacement
      emit({ identityGeneration: 1, identityKey: 'user:alice' })
      await Promise.resolve()
      await Promise.resolve()
      expect(initializePrimary).toHaveBeenCalledTimes(1)
      expect(CountingClient.created).toBe(2)
      expect(o.getPrimary()!.identityGeneration).toBe(1)
    })
  })

  describe('connection-state store', () => {
    it('subscribes on first consumer, unsubscribes on last', () => {
      resetCounts()
      const o = owner()
      const a = o.getPrimary()!.client as unknown as CountingClient
      expect(a.connectionSubscriberCount()).toBe(0)
      const r1 = o.connection.addConsumer()
      const r2 = o.connection.addConsumer()
      expect(a.connectionSubscriberCount()).toBe(1) // single underlying subscription
      r1()
      expect(a.connectionSubscriberCount()).toBe(1)
      r2()
      expect(a.connectionSubscriberCount()).toBe(0)
    })

    it('resets to default and rebinds to the replacement on primary replacement', async () => {
      resetCounts()
      const o = owner()
      const a = o.getPrimary()!.client as unknown as CountingClient
      o.connection.addConsumer()
      a.updateConnectionState({
        isWebSocketConnected: true,
        connectionCount: 3,
      })
      expect((o.connection.state.value as ConnectionState).isWebSocketConnected).toBe(true)

      await o.replacePrimary({
        identityGeneration: 1,
        isCurrent: () => true,
        initialize: async () => {},
      })
      const b = o.getPrimary()!.client as unknown as CountingClient

      // Synchronously reset; old subscription dropped; rebound to B (has consumer).
      expect(a.connectionSubscriberCount()).toBe(0)
      expect(b.connectionSubscriberCount()).toBe(1)
      // B starts at its default (disconnected) snapshot.
      expect((o.connection.state.value as ConnectionState).connectionCount).toBe(0)
    })
  })

  describe('dispose', () => {
    it('returns a complete inert unsubscribe without retaining a late listener', async () => {
      resetCounts()
      const o = owner()
      const original = o.getPrimary()!.client as unknown as CountingClient
      await o.dispose()

      const callback = vi.fn()
      const unsubscribe = o.handle.onUpdate(
        mockFnRef<'query'>('late'),
        {},
        callback,
      ) as RuntimeUnsubscribe

      expect(original.calls.onUpdate).toHaveLength(0)
      expect(unsubscribe.unsubscribe).toBe(unsubscribe)
      expect(unsubscribe.getCurrentValue()).toBeUndefined()
      expect(unsubscribe.getQueryLogs()).toBeUndefined()
      expect(() => {
        unsubscribe()
        unsubscribe.unsubscribe()
      }).not.toThrow()
      expect(callback).not.toHaveBeenCalled()
    })

    it('drops identity observers on disposal and makes late subscriptions inert', async () => {
      resetCounts()
      const o = owner()
      const observer = vi.fn()
      o.subscribeIdentityChange(observer)

      await o.dispose()
      expect(o.subscribeIdentityChange(observer)).toBeTypeOf('function')
      expect(observer).not.toHaveBeenCalled()
    })

    it('closes every allocated client and is idempotent (create/close balance)', async () => {
      resetCounts()
      const o = owner()
      o.getAnonymous() // force the anonymous client to exist
      expect(CountingClient.created).toBe(2)

      await o.dispose()
      expect(CountingClient.closed).toBe(2) // primary + anonymous both closed
      // Idempotent: second dispose does not double-close.
      await o.dispose()
      expect(CountingClient.closed).toBe(2)
    })

    it('rejects in-flight consumer calls with IDENTITY_CHANGED on dispose', async () => {
      resetCounts()
      const o = owner()
      const a = o.getPrimary()!.client as unknown as CountingClient
      a.setMutationHandler('m', () => a.hangingMutation())
      const inflight = o.handle.mutation(mockFnRef<'mutation'>('m'), {})
      const assertion = expect(inflight).rejects.toMatchObject({
        code: IDENTITY_CHANGED,
      })
      // Let dispatch resolve its primary and register the pending call before we
      // tear the owner down.
      await Promise.resolve()
      await o.dispose()
      await assertion
    })

    it('returns all live client counts to zero after disposal', async () => {
      resetCounts()
      const o = owner()
      o.getAnonymous()
      await o.replacePrimary({
        identityGeneration: 1,
        isCurrent: () => true,
        initialize: async () => {},
      })
      // created: primary A + anonymous + replacement B = 3; A already closed on replace.
      expect(CountingClient.created).toBe(3)
      expect(CountingClient.closed).toBe(1)
      await o.dispose()
      // B + anonymous close on dispose → all 3 closed.
      expect(CountingClient.closed).toBe(3)
    })
  })

  describe('handle argument forwarding', () => {
    it('forwards the optional mutation options (optimistic update) through the handle to the current client', async () => {
      // current implementation gate advisory: the handle must not silently drop mutation's
      // third argument, or optimistic updates die at the dispatch seam.
      const received: Array<{ args: unknown; options: unknown }> = []
      class RecordingClient extends MockConvexClient {
        override mutation = async (fn: unknown, args: unknown, options?: unknown) => {
          received.push({ args, options })
          return 'done' as never
        }

        close = async (): Promise<void> => {}
      }
      const o = createConvexClientOwner({
        primaryFactory: () => new RecordingClient() as unknown as OwnedConvexClient,
      })
      const optimisticUpdate = () => {}
      await o.handle.mutation(mockFnRef<'mutation'>('m'), { key: 'k' }, { optimisticUpdate })
      expect(received).toHaveLength(1)
      expect(received[0]!.args).toEqual({ key: 'k' })
      expect(received[0]!.options).toEqual({ optimisticUpdate })
      await o.dispose()
    })
  })

  it('does not retry a persistently failing candidate within the same identity generation', async () => {
    resetCounts()
    const { port, emit, initializePrimary, failPrimary } = fakePort()
    initializePrimary.mockRejectedValue(new Error('persistent confirmation failure'))
    const o = owner()
    o.attachIdentityPort(port)

    emit({ identityKey: 'user:alice', identityGeneration: 1 })
    await vi.waitFor(() => expect(initializePrimary).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(o.getPrimary()).toBeNull())
    await vi.waitFor(() => expect(failPrimary).toHaveBeenCalledWith(1, expect.any(Error)))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    // Same-generation notifications cannot spin a persistently broken client factory
    // or confirmation path. Recovery requires a real new identity generation.
    emit({})
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(initializePrimary).toHaveBeenCalledTimes(1)
    expect(failPrimary).toHaveBeenCalledTimes(1)
    expect(CountingClient.created).toBe(2)
    expect(o.getPrimary()).toBeNull()

    await o.dispose()
  })
})
