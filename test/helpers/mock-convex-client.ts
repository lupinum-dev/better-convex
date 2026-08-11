import { makeFunctionReference, type FunctionReference } from 'convex/server'

type OnResult = (value: unknown) => void
type OnError = (error: Error) => void

interface QueryListener {
  id: number
  key: string
  query: unknown
  args: unknown
  onResult: OnResult
  onError?: OnError
}

export interface MockConnectionState {
  hasInflightRequests: boolean
  isWebSocketConnected: boolean
  timeOfOldestInflightRequest: Date | null
  hasEverConnected: boolean
  connectionCount: number
  connectionRetries: number
  inflightMutations: number
  inflightActions: number
}

const DEFAULT_CONNECTION_STATE: MockConnectionState = {
  hasInflightRequests: false,
  isWebSocketConnected: false,
  timeOfOldestInflightRequest: null,
  hasEverConnected: false,
  connectionCount: 0,
  connectionRetries: 0,
  inflightMutations: 0,
  inflightActions: 0,
}

function fnPath(fn: unknown): string {
  if (!fn || typeof fn !== 'object') return String(fn)
  const record = fn as Record<string | symbol, unknown>
  const symbolPath = record[Symbol.for('functionName')]
  if (typeof symbolPath === 'string') return symbolPath
  if (typeof record._path === 'string') return record._path
  if (typeof record.functionPath === 'string') return record.functionPath
  return 'unknown'
}

function keyFor(query: unknown, args: unknown): string {
  return `${fnPath(query)}::${JSON.stringify(args ?? {})}`
}

export class MockConvexClient {
  private nextListenerId = 1
  private listeners = new Map<number, QueryListener>()
  private queryHandlers = new Map<string, (args: unknown) => unknown | Promise<unknown>>()
  private mutationHandlers = new Map<string, (args: unknown) => unknown | Promise<unknown>>()
  private actionHandlers = new Map<string, (args: unknown) => unknown | Promise<unknown>>()
  private connectionSubscribers = new Set<(state: MockConnectionState) => void>()
  private currentConnectionState: MockConnectionState = {
    ...DEFAULT_CONNECTION_STATE,
  }

  readonly calls = {
    onUpdate: [] as Array<{ query: unknown; args: unknown }>,
    query: [] as Array<{ query: unknown; args: unknown }>,
    mutation: [] as Array<{ mutation: unknown; args: unknown }>,
    action: [] as Array<{ action: unknown; args: unknown }>,
  }

  onUpdate = (
    query: unknown,
    args: unknown,
    onResult: OnResult,
    onError?: OnError,
  ): (() => void) => {
    const id = this.nextListenerId++
    const listener: QueryListener = {
      id,
      key: keyFor(query, args),
      query,
      args,
      onResult,
      onError,
    }
    this.listeners.set(id, listener)
    this.calls.onUpdate.push({ query, args })
    return () => {
      this.listeners.delete(id)
    }
  }

  mutation = async <T = unknown>(
    mutation: FunctionReference<'mutation'> | unknown,
    args: unknown,
  ): Promise<T> => {
    this.calls.mutation.push({ mutation, args })
    const handler = this.mutationHandlers.get(fnPath(mutation))
    if (!handler) {
      throw new Error(`No mock mutation handler for ${fnPath(mutation)}`)
    }
    return (await handler(args)) as T
  }

  query = async <T = unknown>(
    query: FunctionReference<'query'> | unknown,
    args: unknown,
  ): Promise<T> => {
    this.calls.query.push({ query, args })
    const handler = this.queryHandlers.get(fnPath(query))
    if (!handler) {
      throw new Error(`No mock query handler for ${fnPath(query)}`)
    }
    return (await handler(args)) as T
  }

  action = async <T = unknown>(
    action: FunctionReference<'action'> | unknown,
    args: unknown,
  ): Promise<T> => {
    this.calls.action.push({ action, args })
    const handler = this.actionHandlers.get(fnPath(action))
    if (!handler) {
      throw new Error(`No mock action handler for ${fnPath(action)}`)
    }
    return (await handler(args)) as T
  }

  connectionState(): MockConnectionState {
    return { ...this.currentConnectionState }
  }

  subscribeToConnectionState(cb: (state: MockConnectionState) => void): () => void {
    this.connectionSubscribers.add(cb)
    return () => {
      this.connectionSubscribers.delete(cb)
    }
  }

  setMutationHandler(name: string, handler: (args: unknown) => unknown | Promise<unknown>) {
    this.mutationHandlers.set(name, handler)
  }

  setQueryHandler(name: string, handler: (args: unknown) => unknown | Promise<unknown>) {
    this.queryHandlers.set(name, handler)
  }

  setActionHandler(name: string, handler: (args: unknown) => unknown | Promise<unknown>) {
    this.actionHandlers.set(name, handler)
  }

  emitQueryResult(query: unknown, args: unknown, value: unknown) {
    const key = keyFor(query, args)
    for (const listener of this.listeners.values()) {
      if (listener.key === key) {
        listener.onResult(value)
      }
    }
  }

  emitQueryResultByPath(path: string, value: unknown) {
    for (const listener of this.listeners.values()) {
      if (fnPath(listener.query) === path) {
        listener.onResult(value)
      }
    }
  }

  /** Capture callbacks now and invoke them later, modelling an already queued event. */
  queuedQueryResultByPath(path: string, value: unknown): () => void {
    const callbacks = [...this.listeners.values()]
      .filter((listener) => fnPath(listener.query) === path)
      .map((listener) => listener.onResult)
    return () => {
      for (const callback of callbacks) callback(value)
    }
  }

  emitQueryResultWhere(
    match: (entry: { query: unknown; args: unknown }) => boolean,
    value: unknown,
  ) {
    for (const listener of this.listeners.values()) {
      if (match({ query: listener.query, args: listener.args })) {
        listener.onResult(value)
      }
    }
  }

  emitQueryError(query: unknown, args: unknown, error: Error) {
    const key = keyFor(query, args)
    for (const listener of this.listeners.values()) {
      if (listener.key === key) {
        listener.onError?.(error)
      }
    }
  }

  emitQueryErrorByPath(path: string, error: Error) {
    for (const listener of this.listeners.values()) {
      if (fnPath(listener.query) === path) {
        listener.onError?.(error)
      }
    }
  }

  emitQueryErrorWhere(match: (entry: { query: unknown; args: unknown }) => boolean, error: Error) {
    for (const listener of this.listeners.values()) {
      if (match({ query: listener.query, args: listener.args })) {
        listener.onError?.(error)
      }
    }
  }

  activeListenerCount(query?: unknown, args?: unknown): number {
    if (!query) return this.listeners.size
    const key = keyFor(query, args)
    let count = 0
    for (const listener of this.listeners.values()) {
      if (listener.key === key) count++
    }
    return count
  }

  activeListenerCountWhere(match: (entry: { query: unknown; args: unknown }) => boolean): number {
    let count = 0
    for (const listener of this.listeners.values()) {
      if (match({ query: listener.query, args: listener.args })) count++
    }
    return count
  }

  updateConnectionState(partial: Partial<MockConnectionState>) {
    this.currentConnectionState = {
      ...this.currentConnectionState,
      ...partial,
    }
    const snapshot = { ...this.currentConnectionState }
    for (const cb of this.connectionSubscribers) {
      cb(snapshot)
    }
  }

  connectionSubscriberCount(): number {
    return this.connectionSubscribers.size
  }
}

export function mockFnRef<TKind extends 'query' | 'mutation' | 'action'>(
  path: string,
): FunctionReference<TKind> {
  return makeFunctionReference<TKind>(path)
}
