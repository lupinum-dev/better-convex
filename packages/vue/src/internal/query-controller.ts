import type { FunctionReference } from 'convex/server'
import { shallowRef } from 'vue'

import { normalizeConvexError, type ConvexCallError } from '../errors'
import type { ConvexIdentityKey } from './identity-key'

export interface QueryIsolationTag {
  identityKey: ConvexIdentityKey
  identityGeneration: number
}

export interface QueryOperationContext extends QueryIsolationTag {
  argsHash: string
  boundaryKey: string
  operationRevision: number
}

export interface QuerySubscriptionClient {
  onUpdate(
    query: FunctionReference<'query'>,
    args: Record<string, unknown>,
    onValue: (value: unknown) => void,
    onError?: (error: Error) => void,
  ): () => void
}

export interface QueryControllerBoundary<RawT> {
  hasData(): boolean
  readData(): RawT
  writeData(value: RawT): void
  setError(error: ConvexCallError | null, boundaryKey: string): void
  clearData(): void
}

export interface QueryControllerEvent<RawT> {
  onSubscribe?(input: { key: string; args: Record<string, unknown> }): void
  onUpdate?(input: { key: string; args: Record<string, unknown>; value: RawT }): void
  onError?(input: {
    key: string
    args: Record<string, unknown>
    error: Error
    normalized: ConvexCallError
  }): void
  onRemove?(key: string): void
}

export interface CreateQueryControllerInput<RawT, DataT> {
  query: FunctionReference<'query'>
  subscribe: boolean
  keepPreviousData: boolean
  transform?: (value: RawT) => DataT
  getArgs(): Record<string, unknown> | 'skip'
  getArgsHash(): string
  getBoundaryKey(): string
  getIsolationTag(): QueryIsolationTag
  getClient(): QuerySubscriptionClient | null
  boundary: QueryControllerBoundary<RawT>
  events?: QueryControllerEvent<RawT>
}

export interface QueryController<RawT, DataT> {
  beginOperation(): QueryOperationContext
  invalidateOperations(): void
  isOperationCurrent(operation: QueryOperationContext): boolean
  commitSettled(value: RawT, operation?: QueryOperationContext): void
  setOperationError(error: unknown, operation: QueryOperationContext): ConvexCallError | null
  setupSubscription(): QueryOperationContext | null
  teardownSubscription(): void
  firstValue(): Promise<void> | null
  hasData(): boolean
  transformedData(): DataT | null
  isStale(input: { idle: boolean; pending: boolean }): boolean
  handleIdentityBoundary(input: {
    nextTag: QueryIsolationTag
    previousTag: QueryIsolationTag
    previousBoundaryKey: string
  }): void
  handleExecutionBoundary(input: {
    nextBoundaryKey: string
    previousBoundaryKey: string
    nextLive: boolean
    previousLive: boolean
    nextIdle: boolean
  }): void
  clear(): void
  dispose(): void
}

interface FirstValue {
  promise: Promise<void>
  resolve(): void
  reject(error: unknown): void
}

function sameTag(a: QueryIsolationTag, b: QueryIsolationTag): boolean {
  return a.identityKey === b.identityKey && a.identityGeneration === b.identityGeneration
}

function deferred(): FirstValue {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

/**
 * Framework-neutral regular-query lifecycle.
 *
 * It owns one subscription, operation-generation fencing, identity-partitioned
 * previous data, and first-value settlement. Framework adapters own SSR,
 * request credentials, payload storage, and their data-fetching primitive.
 */
export function createQueryController<RawT, DataT = RawT>(
  input: CreateQueryControllerInput<RawT, DataT>,
): QueryController<RawT, DataT> {
  const noSettledValue = Symbol('no-settled-query-value')
  const lastSettledRaw = shallowRef<RawT | typeof noSettledValue>(noSettledValue)
  const lastSettledArgsHash = shallowRef<string | null>(null)

  let operationRevision = 0
  let unsubscribe: (() => void) | null = null
  let subscribedKey: string | null = null
  let pendingFirstValue: FirstValue | null = null
  let disposed = false

  function beginOperation(): QueryOperationContext {
    return {
      ...input.getIsolationTag(),
      argsHash: input.getArgsHash(),
      boundaryKey: input.getBoundaryKey(),
      operationRevision,
    }
  }

  function invalidateOperations(): void {
    operationRevision += 1
  }

  function isOperationCurrent(operation: QueryOperationContext): boolean {
    return (
      !disposed &&
      operation.operationRevision === operationRevision &&
      operation.argsHash === input.getArgsHash() &&
      operation.boundaryKey === input.getBoundaryKey() &&
      sameTag(operation, input.getIsolationTag())
    )
  }

  function commitSettled(value: RawT, operation?: QueryOperationContext): void {
    lastSettledRaw.value = value
    lastSettledArgsHash.value = operation?.argsHash ?? input.getArgsHash()
  }

  function teardownSubscription(): void {
    const previousKey = subscribedKey
    unsubscribe?.()
    unsubscribe = null
    pendingFirstValue?.resolve()
    pendingFirstValue = null
    subscribedKey = null
    if (previousKey) input.events?.onRemove?.(previousKey)
  }

  function setOperationError(
    error: unknown,
    operation: QueryOperationContext,
  ): ConvexCallError | null {
    if (!isOperationCurrent(operation)) return null
    const normalized = normalizeConvexError(error)
    input.boundary.setError(normalized, operation.boundaryKey)
    return normalized
  }

  function setupSubscription(): QueryOperationContext | null {
    if (disposed || !input.subscribe) return null
    const args = input.getArgs()
    if (args === 'skip') return null

    const key = input.getBoundaryKey()
    if (subscribedKey === key && unsubscribe) return null

    teardownSubscription()
    const client = input.getClient()
    if (!client) return null

    const operation = beginOperation()
    subscribedKey = key
    pendingFirstValue ??= deferred()
    unsubscribe = client.onUpdate(
      input.query,
      args,
      (raw) => {
        if (!isOperationCurrent(operation)) return
        const value = raw as RawT
        input.boundary.setError(null, operation.boundaryKey)
        input.boundary.writeData(value)
        commitSettled(value, operation)
        const firstValue = pendingFirstValue
        pendingFirstValue = null
        firstValue?.resolve()
        input.events?.onUpdate?.({ key, args, value })
      },
      (error) => {
        if (!isOperationCurrent(operation)) return
        const normalized = normalizeConvexError(error)
        if (!input.boundary.hasData()) {
          input.boundary.setError(normalized, operation.boundaryKey)
        }
        const firstValue = pendingFirstValue
        pendingFirstValue = null
        firstValue?.reject(error)
        input.events?.onError?.({ key, args, error, normalized })
      },
    )
    input.events?.onSubscribe?.({ key, args })
    return operation
  }

  function resetSettled(): void {
    lastSettledRaw.value = noSettledValue
    lastSettledArgsHash.value = null
  }

  function handleIdentityBoundary(boundary: {
    nextTag: QueryIsolationTag
    previousTag: QueryIsolationTag
    previousBoundaryKey: string
  }): void {
    if (sameTag(boundary.nextTag, boundary.previousTag)) return
    invalidateOperations()
    teardownSubscription()
    input.boundary.setError(null, boundary.previousBoundaryKey)
    resetSettled()
    input.boundary.clearData()
  }

  function handleExecutionBoundary(boundary: {
    nextBoundaryKey: string
    previousBoundaryKey: string
    nextLive: boolean
    previousLive: boolean
    nextIdle: boolean
  }): void {
    if (
      boundary.nextBoundaryKey === boundary.previousBoundaryKey &&
      boundary.nextLive === boundary.previousLive
    ) {
      return
    }
    input.boundary.setError(null, boundary.previousBoundaryKey)
    if (subscribedKey === boundary.nextBoundaryKey) return
    invalidateOperations()
    teardownSubscription()
    if (boundary.nextIdle) {
      resetSettled()
      input.boundary.clearData()
      return
    }
    if (!input.keepPreviousData && boundary.nextBoundaryKey !== boundary.previousBoundaryKey) {
      input.boundary.clearData()
    }
    if (boundary.nextLive) setupSubscription()
  }

  function transformedData(): DataT | null {
    if (!input.boundary.hasData()) return null
    const raw = input.boundary.readData()
    return input.transform ? input.transform(raw) : (raw as unknown as DataT)
  }

  function isStale(state: { idle: boolean; pending: boolean }): boolean {
    return (
      input.keepPreviousData &&
      !state.idle &&
      lastSettledRaw.value !== noSettledValue &&
      lastSettledArgsHash.value !== null &&
      state.pending &&
      input.getArgsHash() !== lastSettledArgsHash.value
    )
  }

  function clear(): void {
    invalidateOperations()
    teardownSubscription()
    input.boundary.setError(null, input.getBoundaryKey())
    resetSettled()
    input.boundary.clearData()
  }

  function dispose(): void {
    if (disposed) return
    invalidateOperations()
    teardownSubscription()
    disposed = true
  }

  return {
    beginOperation,
    invalidateOperations,
    isOperationCurrent,
    commitSettled,
    setOperationError,
    setupSubscription,
    teardownSubscription,
    firstValue: () => pendingFirstValue?.promise ?? null,
    hasData: input.boundary.hasData,
    transformedData,
    isStale,
    handleIdentityBoundary,
    handleExecutionBoundary,
    clear,
    dispose,
  }
}
