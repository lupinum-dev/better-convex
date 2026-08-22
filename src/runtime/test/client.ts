import type { ConnectionState } from 'convex/browser'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { hash } from 'ohash'

type OperationKind = 'mutation' | 'action'
type AnyQuery = FunctionReference<'query'>
type AnyOperation = FunctionReference<OperationKind>

export interface BetterConvexTestCall<Args> {
  readonly args: Args
}

export interface BetterConvexTestQueryCall<Args> extends BetterConvexTestCall<Args> {
  readonly kind: 'subscribe' | 'refresh'
}

export interface BetterConvexTestQueryController<Query extends AnyQuery> {
  readonly calls: readonly BetterConvexTestQueryCall<FunctionArgs<Query>>[]
  resolve(value: FunctionReturnType<Query>): void
  push(value: FunctionReturnType<Query>): void
  reject(error: unknown): void
  reset(): void
  activeSubscriptions(): number
}

export interface BetterConvexTestOperationController<Operation extends AnyOperation> {
  readonly calls: readonly BetterConvexTestCall<FunctionArgs<Operation>>[]
  resolve(value: FunctionReturnType<Operation>): void
  reject(error: unknown): void
  reset(): void
}

interface QueryListener {
  readonly args: unknown
  readonly onResult: (value: unknown) => void
  readonly onError?: (error: Error) => void
}

interface QueryBehavior {
  readonly state: 'resolved' | 'rejected'
  readonly value: unknown
}

interface PendingOperation {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
}

interface OperationBehavior {
  readonly state: 'resolved' | 'rejected'
  readonly value: unknown
}

interface QueryRecord {
  readonly name: string
  readonly isDefault: boolean
  readonly calls: Array<BetterConvexTestQueryCall<unknown>>
  readonly listeners: Set<QueryListener>
  behavior?: QueryBehavior
}

interface OperationRecord {
  readonly calls: Array<BetterConvexTestCall<unknown>>
  readonly pending: Set<PendingOperation>
  behavior?: OperationBehavior
}

const DEFAULT_CONNECTION_STATE: ConnectionState = {
  hasInflightRequests: false,
  isWebSocketConnected: true,
  timeOfOldestInflightRequest: null,
  hasEverConnected: true,
  connectionCount: 1,
  connectionRetries: 0,
  inflightMutations: 0,
  inflightActions: 0,
}

function argsKey(args: unknown): string {
  return hash(args ?? {})
}

function queryKey(query: AnyQuery, args: unknown): string {
  return `${getFunctionName(query)}:${argsKey(args)}`
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export class BetterConvexTestClient {
  readonly #queryRecords = new Map<string, QueryRecord>()
  readonly #queryDefaults = new Map<string, QueryRecord>()
  readonly #operationRecords = new Map<string, OperationRecord>()
  readonly #connectionSubscribers = new Set<(state: ConnectionState) => void>()
  #connectionState: ConnectionState = { ...DEFAULT_CONNECTION_STATE }

  readonly handle = Object.freeze({
    query: <Query extends AnyQuery>(query: Query, args: FunctionArgs<Query>) =>
      this.refresh(query, args),
    mutation: <Mutation extends FunctionReference<'mutation'>>(
      mutation: Mutation,
      args: FunctionArgs<Mutation>,
    ) => this.invoke('mutation', mutation, args),
    action: <Action extends FunctionReference<'action'>>(
      action: Action,
      args: FunctionArgs<Action>,
    ) => this.invoke('action', action, args),
    onUpdate: <Query extends AnyQuery>(
      query: Query,
      args: FunctionArgs<Query>,
      onResult: (value: FunctionReturnType<Query>) => void,
      onError?: (error: Error) => void,
    ) => this.subscribe(query, args, onResult, onError),
  })

  query<Query extends AnyQuery>(
    query: Query,
    args?: FunctionArgs<Query>,
  ): BetterConvexTestQueryController<Query> {
    const name = getFunctionName(query)
    const record =
      args === undefined ? this.defaultQueryRecord(name) : this.exactQueryRecord(query, args)
    return {
      get calls() {
        return record.calls.slice() as BetterConvexTestQueryCall<FunctionArgs<Query>>[]
      },
      resolve: (value) => this.setQueryBehavior(record, { state: 'resolved', value }),
      push: (value) => this.setQueryBehavior(record, { state: 'resolved', value }),
      reject: (error) => this.setQueryBehavior(record, { state: 'rejected', value: error }),
      reset: () => {
        record.behavior = undefined
      },
      activeSubscriptions: () => {
        if (!record.isDefault) return record.listeners.size
        let count = 0
        for (const exact of this.#queryRecords.values()) {
          if (exact.name === record.name) count += exact.listeners.size
        }
        return count
      },
    }
  }

  operation<Operation extends AnyOperation>(
    kind: OperationKind,
    operation: Operation,
  ): BetterConvexTestOperationController<Operation> {
    const record = this.operationRecord(kind, operation)
    return {
      get calls() {
        return record.calls.slice() as BetterConvexTestCall<FunctionArgs<Operation>>[]
      },
      resolve: (value) => this.setOperationBehavior(record, { state: 'resolved', value }),
      reject: (error) => this.setOperationBehavior(record, { state: 'rejected', value: error }),
      reset: () => {
        record.behavior = undefined
        for (const pending of record.pending) {
          pending.reject(new Error('Better Convex test operation reset'))
        }
        record.pending.clear()
      },
    }
  }

  connectionState(): ConnectionState {
    return { ...this.#connectionState }
  }

  setConnectionState(update: Partial<ConnectionState>): void {
    this.#connectionState = { ...this.#connectionState, ...update }
    const snapshot = this.connectionState()
    for (const subscriber of this.#connectionSubscribers) subscriber(snapshot)
  }

  subscribeToConnectionState(subscriber: (state: ConnectionState) => void): () => void {
    this.#connectionSubscribers.add(subscriber)
    return () => this.#connectionSubscribers.delete(subscriber)
  }

  private defaultQueryRecord(name: string): QueryRecord {
    let record = this.#queryDefaults.get(name)
    if (!record) {
      record = { name, isDefault: true, calls: [], listeners: new Set() }
      this.#queryDefaults.set(name, record)
    }
    return record
  }

  private exactQueryRecord(query: AnyQuery, args: unknown): QueryRecord {
    const key = queryKey(query, args)
    let record = this.#queryRecords.get(key)
    if (!record) {
      record = {
        name: getFunctionName(query),
        isDefault: false,
        calls: [],
        listeners: new Set(),
      }
      this.#queryRecords.set(key, record)
    }
    return record
  }

  private setQueryBehavior(record: QueryRecord, behavior: QueryBehavior): void {
    record.behavior = behavior
    for (const listener of record.listeners) this.publishQuery(listener, behavior)
    if (!record.isDefault) return
    for (const exact of this.#queryRecords.values()) {
      if (exact.name !== record.name || exact.behavior !== undefined) continue
      for (const listener of exact.listeners) this.publishQuery(listener, behavior)
    }
  }

  private subscribe<Query extends AnyQuery>(
    query: Query,
    args: FunctionArgs<Query>,
    onResult: (value: FunctionReturnType<Query>) => void,
    onError?: (error: Error) => void,
  ) {
    const exact = this.exactQueryRecord(query, args)
    const fallback = this.defaultQueryRecord(getFunctionName(query))
    const behavior = exact.behavior ?? fallback.behavior
    const listener: QueryListener = {
      args,
      onResult: onResult as (value: unknown) => void,
      onError,
    }
    exact.calls.push({ kind: 'subscribe', args })
    fallback.calls.push({ kind: 'subscribe', args })
    exact.listeners.add(listener)
    if (behavior) queueMicrotask(() => this.publishQuery(listener, behavior))
    const unsubscribe = () => {
      exact.listeners.delete(listener)
    }
    return Object.assign(unsubscribe, {
      unsubscribe,
      getCurrentValue: () =>
        (exact.behavior ?? fallback.behavior)?.state === 'resolved'
          ? (exact.behavior ?? fallback.behavior)?.value
          : undefined,
    })
  }

  private async refresh<Query extends AnyQuery>(
    query: Query,
    args: FunctionArgs<Query>,
  ): Promise<FunctionReturnType<Query>> {
    const exact = this.exactQueryRecord(query, args)
    const fallback = this.defaultQueryRecord(getFunctionName(query))
    const record = exact.behavior === undefined ? fallback : exact
    exact.calls.push({ kind: 'refresh', args })
    fallback.calls.push({ kind: 'refresh', args })
    if (!record.behavior) {
      throw new Error(`[better-convex-test] unresolved query ${getFunctionName(query)}`)
    }
    if (record.behavior.state === 'rejected') throw record.behavior.value
    return record.behavior.value as FunctionReturnType<Query>
  }

  private publishQuery(listener: QueryListener, behavior: QueryBehavior): void {
    if (behavior.state === 'rejected') listener.onError?.(asError(behavior.value))
    else listener.onResult(behavior.value)
  }

  private operationRecord(kind: OperationKind, operation: AnyOperation): OperationRecord {
    const key = `${kind}:${getFunctionName(operation)}`
    let record = this.#operationRecords.get(key)
    if (!record) {
      record = { calls: [], pending: new Set() }
      this.#operationRecords.set(key, record)
    }
    return record
  }

  private invoke<Operation extends AnyOperation>(
    kind: OperationKind,
    operation: Operation,
    args: FunctionArgs<Operation>,
  ): Promise<FunctionReturnType<Operation>> {
    const record = this.operationRecord(kind, operation)
    record.calls.push({ args })
    if (record.behavior) return this.settledOperation(record.behavior)
    return new Promise((resolve, reject) => {
      record.pending.add({ resolve, reject })
    }) as Promise<FunctionReturnType<Operation>>
  }

  private settledOperation<Result>(behavior: OperationBehavior): Promise<Result> {
    return behavior.state === 'resolved'
      ? Promise.resolve(behavior.value as Result)
      : Promise.reject(behavior.value)
  }

  private setOperationBehavior(record: OperationRecord, behavior: OperationBehavior): void {
    record.behavior = behavior
    for (const pending of record.pending) {
      if (behavior.state === 'resolved') pending.resolve(behavior.value)
      else pending.reject(behavior.value)
    }
    record.pending.clear()
  }
}
