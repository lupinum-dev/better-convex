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
  setError(error: ConvexCallError | undefined): void
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

export interface CreateQueryControllerInput<RawT> {
  query: FunctionReference<'query'>
  keepPreviousData: boolean
  getArgs(): Record<string, unknown> | 'skip'
  getArgsHash(): string
  getBoundaryKey(): string
  getIsolationTag(): QueryIsolationTag
  getClient(): QuerySubscriptionClient | null
  boundary: QueryControllerBoundary<RawT>
  events?: QueryControllerEvent<RawT>
}

export interface QueryController<RawT> {
  beginOperation(): QueryOperationContext
  invalidateOperations(): void
  isOperationCurrent(operation: QueryOperationContext): boolean
  markSettled(operation?: QueryOperationContext): void
  setOperationError(error: unknown, operation: QueryOperationContext): ConvexCallError | null
  setupSubscription(): QueryOperationContext | null
  teardownSubscription(): void
  isAwaitingFirstValue(): boolean
  hasData(): boolean
  hasSettledForCurrentArgs(): boolean
  data(): RawT | undefined
  isStale(input: { idle: boolean; pending: boolean; errored: boolean }): boolean
  handleIdentityBoundary(input: {
    nextTag: QueryIsolationTag
    previousTag: QueryIsolationTag
  }): void
  handleExecutionBoundary(input: {
    nextBoundaryKey: string
    previousBoundaryKey: string
    nextLive: boolean
    previousLive: boolean
    nextIdle: boolean
  }): void
  dispose(): void
}

function sameTag(a: QueryIsolationTag, b: QueryIsolationTag): boolean {
  return a.identityKey === b.identityKey && a.identityGeneration === b.identityGeneration
}

/**
 * Framework-neutral regular-query lifecycle.
 *
 * It owns one subscription, operation-generation fencing, identity-partitioned
 * previous data, and first-value settlement. Framework adapters own SSR,
 * request credentials, payload storage, and their data-fetching primitive.
 */
export function createQueryController<RawT>(
  input: CreateQueryControllerInput<RawT>,
): QueryController<RawT> {
  const lastSettledArgsHash = shallowRef<string | undefined>(undefined)

  let operationRevision = 0
  let unsubscribe: (() => void) | null = null
  let subscribedKey: string | null = null
  let awaitingFirstValue = false
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

  function markSettled(operation?: QueryOperationContext): void {
    lastSettledArgsHash.value = operation?.argsHash ?? input.getArgsHash()
  }

  function teardownSubscription(): void {
    const previousKey = subscribedKey
    unsubscribe?.()
    unsubscribe = null
    awaitingFirstValue = false
    subscribedKey = null
    if (previousKey) input.events?.onRemove?.(previousKey)
  }

  function setOperationError(
    error: unknown,
    operation: QueryOperationContext,
  ): ConvexCallError | null {
    if (!isOperationCurrent(operation)) return null
    const normalized = normalizeConvexError(error)
    input.boundary.setError(normalized)
    return normalized
  }

  function setupSubscription(): QueryOperationContext | null {
    if (disposed) return null
    const args = input.getArgs()
    if (args === 'skip') return null

    const key = input.getBoundaryKey()
    if (subscribedKey === key && unsubscribe) return null

    teardownSubscription()
    const client = input.getClient()
    if (!client) return null

    const operation = beginOperation()
    subscribedKey = key
    awaitingFirstValue = true
    unsubscribe = client.onUpdate(
      input.query,
      args,
      (raw) => {
        if (!isOperationCurrent(operation)) return
        const value = raw as RawT
        input.boundary.setError(undefined)
        input.boundary.writeData(value)
        markSettled(operation)
        awaitingFirstValue = false
        input.events?.onUpdate?.({ key, args, value })
      },
      (error) => {
        if (!isOperationCurrent(operation)) return
        const normalized = normalizeConvexError(error)
        input.boundary.setError(normalized)
        awaitingFirstValue = false
        input.events?.onError?.({ key, args, error, normalized })
      },
    )
    input.events?.onSubscribe?.({ key, args })
    return operation
  }

  function resetSettled(): void {
    lastSettledArgsHash.value = undefined
  }

  function handleIdentityBoundary(boundary: {
    nextTag: QueryIsolationTag
    previousTag: QueryIsolationTag
  }): void {
    if (sameTag(boundary.nextTag, boundary.previousTag)) return
    invalidateOperations()
    teardownSubscription()
    input.boundary.setError(undefined)
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
    input.boundary.setError(undefined)
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

  function hasSettledForCurrentArgs(): boolean {
    return lastSettledArgsHash.value === input.getArgsHash()
  }

  function data(): RawT | undefined {
    if (!input.boundary.hasData()) return undefined
    return input.boundary.readData()
  }

  function isStale(state: { idle: boolean; pending: boolean; errored: boolean }): boolean {
    return (
      !state.idle &&
      input.boundary.hasData() &&
      lastSettledArgsHash.value !== undefined &&
      (state.pending ||
        state.errored ||
        (input.keepPreviousData && input.getArgsHash() !== lastSettledArgsHash.value))
    )
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
    markSettled,
    setOperationError,
    setupSubscription,
    teardownSubscription,
    isAwaitingFirstValue: () => awaitingFirstValue,
    hasData: input.boundary.hasData,
    hasSettledForCurrentArgs,
    data,
    isStale,
    handleIdentityBoundary,
    handleExecutionBoundary,
    dispose,
  }
}
