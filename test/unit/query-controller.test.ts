import type { FunctionReference } from 'convex/server'
import { describe, expect, it } from 'vitest'

import type { ConvexCallError } from '../../packages/vue/src/errors'
import {
  createQueryController,
  type QueryIsolationTag,
} from '../../packages/vue/src/internal/query-controller'
import { mockFnRef } from '../helpers/mock-convex-client'

interface Value {
  owner: string
  count: number
}

function makeHarness(options?: {
  keepPreviousData?: boolean
  transform?: (value: Value) => string
}) {
  const query = mockFnRef<'query'>('notes:list')
  let args: Record<string, unknown> | 'skip' = { page: 1 }
  let argsHash = 'page:1'
  let boundaryKey = 'notes:list:alice:page:1'
  let tag: QueryIsolationTag = {
    identityKey: 'user:alice',
    identityGeneration: 1,
  }
  let data: Value | null = null
  let hasData = false
  let error: ConvexCallError | null = null
  let active:
    | {
        value: (value: unknown) => void
        error: (error: Error) => void
      }
    | undefined
  let unsubscribes = 0
  const removed: string[] = []

  const client = {
    onUpdate(
      _query: FunctionReference<'query'>,
      _args: Record<string, unknown>,
      onValue: (value: unknown) => void,
      onError?: (error: Error) => void,
    ) {
      active = { value: onValue, error: onError ?? (() => {}) }
      return () => {
        unsubscribes += 1
        active = undefined
      }
    },
  }

  const controller = createQueryController<Value, string>({
    query,
    subscribe: true,
    keepPreviousData: options?.keepPreviousData ?? true,
    transform: options?.transform ?? ((value) => `${value.owner}:${value.count}`),
    getArgs: () => args,
    getArgsHash: () => argsHash,
    getBoundaryKey: () => boundaryKey,
    getIsolationTag: () => tag,
    getClient: () => client,
    boundary: {
      hasData: () => hasData,
      readData: () => {
        if (!hasData) throw new Error('test harness read before settlement')
        return data as Value
      },
      writeData: (value) => {
        data = value
        hasData = true
      },
      setError: (value) => {
        error = value
      },
      clearData: () => {
        data = null
        hasData = false
      },
    },
    events: { onRemove: (key) => removed.push(key) },
  })

  return {
    controller,
    state: {
      query,
      get data() {
        return data
      },
      get error() {
        return error
      },
      get active() {
        return active
      },
      get unsubscribes() {
        return unsubscribes
      },
      removed,
      setArgs(next: Record<string, unknown> | 'skip', hash: string, key: string) {
        args = next
        argsHash = hash
        boundaryKey = key
      },
      setIdentity(next: QueryIsolationTag, key: string) {
        tag = next
        boundaryKey = key
      },
    },
  }
}

describe('query controller', () => {
  it('owns one subscription and commits, transforms, and tags its first value', async () => {
    const { controller, state } = makeHarness()

    const operation = controller.setupSubscription()
    const first = controller.firstValue()
    expect(operation).not.toBeNull()
    expect(controller.setupSubscription()).toBeNull()
    expect(state.active).toBeDefined()

    state.active?.value({ owner: 'alice', count: 2 })

    await expect(first).resolves.toBeUndefined()
    expect(state.data).toEqual({ owner: 'alice', count: 2 })
    expect(controller.transformedData()).toBe('alice:2')
  })

  it('rejects queued stale work and clears all protected state on identity change', () => {
    const { controller, state } = makeHarness()
    controller.setupSubscription()
    const queuedAliceValue = state.active?.value
    state.active?.value({ owner: 'alice', count: 1 })

    state.setIdentity({ identityKey: 'user:bob', identityGeneration: 2 }, 'notes:list:bob:page:1')
    controller.handleIdentityBoundary({
      nextTag: { identityKey: 'user:bob', identityGeneration: 2 },
      previousTag: { identityKey: 'user:alice', identityGeneration: 1 },
      previousBoundaryKey: 'notes:list:alice:page:1',
    })
    queuedAliceValue?.({ owner: 'alice-stale', count: 99 })

    expect(state.data).toBeNull()
    expect(state.error).toBeNull()
    expect(state.unsubscribes).toBe(1)
    expect(state.removed).toEqual(['notes:list:alice:page:1'])
  })

  it('replaces the listener on an args boundary and marks retained data stale', () => {
    const { controller, state } = makeHarness()
    controller.setupSubscription()
    state.active?.value({ owner: 'alice', count: 1 })

    state.setArgs({ page: 2 }, 'page:2', 'notes:list:alice:page:2')
    controller.handleExecutionBoundary({
      nextBoundaryKey: 'notes:list:alice:page:2',
      previousBoundaryKey: 'notes:list:alice:page:1',
      nextLive: true,
      previousLive: true,
      nextIdle: false,
    })

    expect(state.unsubscribes).toBe(1)
    expect(state.active).toBeDefined()
    expect(controller.isStale({ idle: false, pending: true })).toBe(true)
  })

  it('clears the prior result on an args boundary when previous data is disabled', () => {
    const { controller, state } = makeHarness({ keepPreviousData: false })
    controller.setupSubscription()
    state.active?.value({ owner: 'alice', count: 1 })

    state.setArgs({ page: 2 }, 'page:2', 'notes:list:alice:page:2')
    controller.handleExecutionBoundary({
      nextBoundaryKey: 'notes:list:alice:page:2',
      previousBoundaryKey: 'notes:list:alice:page:1',
      nextLive: true,
      previousLive: true,
      nextIdle: false,
    })

    expect(state.data).toBeNull()
    expect(controller.isStale({ idle: false, pending: true })).toBe(false)
    expect(state.unsubscribes).toBe(1)
    expect(state.active).toBeDefined()
  })

  it('clears protected and previous data when the execution gate becomes idle', () => {
    const { controller, state } = makeHarness()
    controller.setupSubscription()
    state.active?.value({ owner: 'alice', count: 1 })

    state.setArgs('skip', 'skip', 'notes:list:idle')
    controller.handleExecutionBoundary({
      nextBoundaryKey: 'notes:list:idle',
      previousBoundaryKey: 'notes:list:alice:page:1',
      nextLive: false,
      previousLive: true,
      nextIdle: true,
    })

    expect(state.data).toBeNull()
    expect(state.unsubscribes).toBe(1)
  })

  it('normalizes current errors but ignores errors from retired operations', () => {
    const { controller, state } = makeHarness()
    const operation = controller.beginOperation()
    const normalized = controller.setOperationError(new TypeError('private details'), operation)

    expect(normalized?.kind).toBe('unknown')
    expect(state.error).toBe(normalized)

    controller.invalidateOperations()
    expect(controller.setOperationError(new Error('late'), operation)).toBeNull()
    expect(state.error).toBe(normalized)
  })

  it('settles a first-value waiter and disposes the listener exactly once', async () => {
    const { controller, state } = makeHarness()
    controller.setupSubscription()
    const first = controller.firstValue()

    controller.dispose()
    controller.dispose()

    await expect(first).resolves.toBeUndefined()
    expect(state.unsubscribes).toBe(1)
    expect(state.active).toBeUndefined()
    expect(controller.setupSubscription()).toBeNull()
  })

  it('does not subscribe when skipped and clear retires queued callbacks', () => {
    const { controller, state } = makeHarness()

    controller.setupSubscription()
    const queued = state.active?.value
    controller.clear()
    queued?.({ owner: 'late', count: 5 })
    expect(state.data).toBeNull()

    state.setArgs('skip', 'skip', 'notes:list:idle')
    expect(controller.setupSubscription()).toBeNull()
  })
})
