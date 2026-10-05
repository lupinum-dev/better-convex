import type { ConnectionState, MutationOptions } from 'convex/browser'
import type { FunctionReference } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { ConvexError } from 'convex/values'
import { hash } from 'ohash'

import { ConvexCallError } from '../errors'
import type { OwnedConvexClient } from '../internal/client-owner'
import type { ConvexIdentityKey } from '../internal/identity-key'

/** The user a request was sent as: `user:<subject>`, or `anonymous`. */
export type BetterConvexTestIdentity = 'anonymous' | `user:${string}`

type Args = Record<string, unknown>
export type WriteKind = 'mutation' | 'action'

/** One request a component sent through the controlled transport. */
export interface BetterConvexTestRequest<RequestArgs = unknown, Result = unknown> {
  readonly args: RequestArgs
  /** The identity of the Convex client that carried the request. */
  readonly identity: BetterConvexTestIdentity
  readonly state: 'pending' | 'resolved' | 'rejected'
  /** Answer this request, for example after the component moved on. */
  resolve(value: Result): void
  /** Fail this request with a server error (a `ConvexError`) or transport error. */
  reject(error: unknown): void
}

/** One live subscription (`subscribe`) or one-shot read (`query`). */
export interface BetterConvexTestQueryCall<RequestArgs = unknown> {
  readonly kind: 'subscribe' | 'query'
  readonly args: RequestArgs
  readonly identity: BetterConvexTestIdentity
}

type Outcome =
  | { readonly state: 'resolved'; readonly value: unknown }
  | { readonly state: 'rejected'; readonly error: unknown }

type WriteBehavior =
  | Outcome
  | { readonly state: 'respond'; readonly handler: (args: Args) => unknown }

/** Microtask rounds `flush()` and `nextCall()` drain; fake timers never stall them. */
const MICROTASK_ROUNDS = 100

export async function drainMicrotasks(): Promise<void> {
  for (let round = 0; round < MICROTASK_ROUNDS; round += 1) await Promise.resolve()
}

export async function waitForArrival<T>(take: () => T | undefined, what: string): Promise<T> {
  for (let round = 0; round < MICROTASK_ROUNDS; round += 1) {
    const value = take()
    if (value !== undefined) return value
    await Promise.resolve()
  }
  const value = take()
  if (value !== undefined) return value
  throw new Error(
    `[better-convex-test] no ${what} arrived. Start the call first, and make sure the component is mounted with the test plugin.`,
  )
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

class TestRequest implements BetterConvexTestRequest {
  readonly args: unknown
  readonly identity: ConvexIdentityKey
  #state: BetterConvexTestRequest['state'] = 'pending'
  readonly #settle: (outcome: Outcome) => void

  constructor(args: unknown, identity: ConvexIdentityKey, settle: (outcome: Outcome) => void) {
    this.args = args
    this.identity = identity
    this.#settle = settle
  }

  get state() {
    return this.#state
  }

  resolve(value: unknown): void {
    this.#finish({ state: 'resolved', value })
  }

  reject(error: unknown): void {
    this.#finish({ state: 'rejected', error })
  }

  #finish(outcome: Outcome): void {
    if (this.#state !== 'pending') {
      throw new Error(`[better-convex-test] this request is already ${this.#state}`)
    }
    this.#state = outcome.state
    this.#settle(outcome)
  }
}

function applyWriteBehavior(behavior: WriteBehavior, request: TestRequest): void {
  if (behavior.state === 'resolved') request.resolve(behavior.value)
  else if (behavior.state === 'rejected') request.reject(behavior.error)
  else {
    Promise.resolve()
      .then(() => behavior.handler(request.args as Args))
      .then(
        (value) => {
          if (request.state === 'pending') request.resolve(value)
        },
        (error: unknown) => {
          if (request.state === 'pending') request.reject(error)
        },
      )
  }
}

export interface WriteRecord {
  readonly name: string
  readonly requests: TestRequest[]
  behavior?: WriteBehavior
  cursor: number
}

export interface QueryMatcher {
  readonly key: string
  readonly name: string
  /** Exact arguments beat a page cursor, which beats every argument variant. */
  readonly specificity: number
  matches(args: Args): boolean
}

export interface QueryRecord {
  readonly matcher: QueryMatcher
  outcome?: Outcome
  cursor: number
}

interface LiveSubscription {
  readonly name: string
  readonly args: Args
  readonly identity: ConvexIdentityKey
  active: boolean
  current?: Outcome
  readonly onResult: (value: unknown) => unknown
  readonly onError?: (error: Error) => unknown
}

interface PendingRead {
  readonly name: string
  readonly args: Args
  readonly request: TestRequest
}

export interface LoggedQueryCall extends BetterConvexTestQueryCall<Args> {
  readonly name: string
}

export function exactQueryMatcher(name: string, args: unknown): QueryMatcher {
  const argsHash = hash(args ?? {})
  return {
    key: `exact:${name}:${argsHash}`,
    name,
    specificity: 3,
    matches: (candidate) => hash(candidate) === argsHash,
  }
}

export function anyQueryMatcher(name: string): QueryMatcher {
  return { key: `any:${name}`, name, specificity: 0, matches: () => true }
}

/** Match one page of a paginated query by its request cursor, optionally for exact list arguments. */
export function pageQueryMatcher(
  name: string,
  listArgs: unknown,
  cursor: string | null,
): QueryMatcher {
  const listHash = listArgs === undefined ? undefined : hash(listArgs)
  return {
    key: `page:${name}:${listHash ?? '*'}:${cursor ?? ''}`,
    name,
    specificity: listHash === undefined ? 1 : 2,
    matches(candidate) {
      const options = candidate.paginationOpts as { cursor?: string | null } | undefined
      if (!options || typeof options !== 'object') return false
      if ((options.cursor ?? null) !== cursor) return false
      if (listHash === undefined) return true
      const { paginationOpts: _paginationOpts, ...rest } = candidate
      return hash(rest) === listHash
    },
  }
}

/** Every page of a paginated query, optionally for exact list arguments; never answered. */
export function listQueryMatcher(name: string, listArgs: unknown): QueryMatcher {
  const listHash = listArgs === undefined ? undefined : hash(listArgs)
  return {
    key: `list:${name}:${listHash ?? '*'}`,
    name,
    specificity: -1,
    matches(candidate) {
      if (!candidate.paginationOpts || typeof candidate.paginationOpts !== 'object') return false
      if (listHash === undefined) return true
      const { paginationOpts: _paginationOpts, ...rest } = candidate
      return hash(rest) === listHash
    },
  }
}

/** The error Convex reports for a stale pagination cursor. */
export function invalidCursorError(): ConvexError<{
  isConvexSystemError: true
  paginationError: 'InvalidCursor'
}> {
  return new ConvexError({ isConvexSystemError: true, paginationError: 'InvalidCursor' })
}

const CONNECTED: ConnectionState = Object.freeze({
  hasInflightRequests: false,
  isWebSocketConnected: true,
  timeOfOldestInflightRequest: null,
  hasEverConnected: true,
  connectionCount: 1,
  connectionRetries: 0,
  inflightMutations: 0,
  inflightActions: 0,
})

const TOKEN_PREFIX = 'better-convex-test:'

/** The opaque token the test auth adapter hands to `setAuth`. */
export function testTokenFor(subject: string): string {
  return `${TOKEN_PREFIX}${subject}`
}

/**
 * An in-memory Convex deployment at the client boundary. Every Convex client
 * the real runtime constructs is one of its clients, so the real client owner,
 * auth port, and composable controllers run unchanged on top of it.
 */
export function createTestTransport() {
  const writes = new Map<string, WriteRecord>()
  const queries = new Map<string, QueryRecord>()
  const queryLog: LoggedQueryCall[] = []
  const subscriptions = new Set<LiveSubscription>()
  const pendingReads = new Set<PendingRead>()
  const connectionListeners = new Set<(state: ConnectionState) => void>()
  let connection: ConnectionState = CONNECTED

  function writeRecord(kind: WriteKind, reference: FunctionReference<WriteKind>): WriteRecord {
    const name = getFunctionName(reference)
    const key = `${kind}:${name}`
    let record = writes.get(key)
    if (!record) {
      record = { name, requests: [], cursor: 0 }
      writes.set(key, record)
    }
    return record
  }

  function configureWrite(record: WriteRecord, behavior: WriteBehavior | undefined): void {
    record.behavior = behavior
    if (!behavior) return
    for (const request of record.requests) {
      if (request.state === 'pending') applyWriteBehavior(behavior, request)
    }
  }

  function dispatchWrite(
    kind: WriteKind,
    reference: FunctionReference<WriteKind>,
    args: unknown,
    identity: ConvexIdentityKey,
  ): Promise<unknown> {
    const record = writeRecord(kind, reference)
    return new Promise((resolve, reject) => {
      const request = new TestRequest(args ?? {}, identity, (outcome) => {
        if (outcome.state === 'resolved') resolve(outcome.value)
        else reject(outcome.error)
      })
      record.requests.push(request)
      if (record.behavior) applyWriteBehavior(record.behavior, request)
    })
  }

  function queryRecord(matcher: QueryMatcher): QueryRecord {
    let record = queries.get(matcher.key)
    if (!record) {
      record = { matcher, cursor: 0 }
      queries.set(matcher.key, record)
    }
    return record
  }

  function bestRecord(name: string, args: Args): QueryRecord | undefined {
    let best: QueryRecord | undefined
    for (const record of queries.values()) {
      if (record.outcome === undefined || record.matcher.name !== name) continue
      if (!record.matcher.matches(args)) continue
      if (!best || record.matcher.specificity > best.matcher.specificity) best = record
    }
    return best
  }

  function deliver(subscription: LiveSubscription, outcome: Outcome): void {
    if (!subscription.active) return
    subscription.current = outcome
    if (outcome.state === 'resolved') subscription.onResult(outcome.value)
    else subscription.onError?.(asError(outcome.error))
  }

  function settleRead(read: PendingRead, outcome: Outcome): void {
    pendingReads.delete(read)
    if (read.request.state !== 'pending') return
    if (outcome.state === 'resolved') read.request.resolve(outcome.value)
    else read.request.reject(outcome.error)
  }

  function configureQuery(record: QueryRecord, outcome: Outcome | undefined): void {
    record.outcome = outcome
    if (!outcome) return
    const { matcher } = record
    for (const subscription of [...subscriptions]) {
      if (subscription.name !== matcher.name || !matcher.matches(subscription.args)) continue
      if (bestRecord(subscription.name, subscription.args) === record)
        deliver(subscription, outcome)
    }
    for (const read of [...pendingReads]) {
      if (read.name !== matcher.name || !matcher.matches(read.args)) continue
      if (bestRecord(read.name, read.args) === record) settleRead(read, outcome)
    }
  }

  function queryCalls(matcher: QueryMatcher): LoggedQueryCall[] {
    return queryLog.filter((call) => call.name === matcher.name && matcher.matches(call.args))
  }

  function activeSubscriptions(matcher: QueryMatcher): number {
    let count = 0
    for (const subscription of subscriptions) {
      if (subscription.name === matcher.name && matcher.matches(subscription.args)) count += 1
    }
    return count
  }

  function setConnectionState(update: Partial<ConnectionState>): void {
    connection = Object.freeze({ ...connection, ...update })
    for (const listener of [...connectionListeners]) listener(connection)
  }

  /** One Convex client. Its identity is anonymous until `setAuth` confirms a token. */
  function createClient(): OwnedConvexClient {
    let identity: ConvexIdentityKey = 'anonymous'
    let closed = false
    let authRevision = 0
    const owned = new Set<LiveSubscription>()
    const ownedConnectionListeners = new Set<(state: ConnectionState) => void>()

    const assertOpen = () => {
      if (closed) throw new Error('[better-convex-test] this Convex client is closed')
    }

    const client = {
      query(reference: FunctionReference<'query'>, args?: Args): Promise<unknown> {
        assertOpen()
        const name = getFunctionName(reference)
        const callArgs = args ?? {}
        queryLog.push({ kind: 'query', name, args: callArgs, identity })
        return new Promise((resolve, reject) => {
          const request = new TestRequest(callArgs, identity, (outcome) => {
            if (outcome.state === 'resolved') resolve(outcome.value)
            else reject(outcome.error)
          })
          const read: PendingRead = { name, args: callArgs, request }
          const best = bestRecord(name, callArgs)
          if (best?.outcome) settleRead(read, best.outcome)
          else pendingReads.add(read)
        })
      },
      async mutation(
        reference: FunctionReference<'mutation'>,
        args?: Args,
        options?: MutationOptions,
      ): Promise<unknown> {
        assertOpen()
        if (options?.optimisticUpdate !== undefined) {
          throw new ConvexCallError({
            kind: 'unknown',
            message:
              'The Better Convex test kit does not run optimistic updates; test them with the real Convex client in real-stack end-to-end tests.',
          })
        }
        return dispatchWrite('mutation', reference, args, identity)
      },
      action(reference: FunctionReference<'action'>, args?: Args): Promise<unknown> {
        assertOpen()
        return dispatchWrite('action', reference, args, identity)
      },
      onUpdate(
        reference: FunctionReference<'query'>,
        args: Args | undefined,
        onResult: (value: unknown) => unknown,
        onError?: (error: Error) => unknown,
      ) {
        assertOpen()
        const name = getFunctionName(reference)
        const callArgs = args ?? {}
        const subscription: LiveSubscription = {
          name,
          args: callArgs,
          identity,
          active: true,
          onResult,
          onError,
        }
        queryLog.push({ kind: 'subscribe', name, args: callArgs, identity })
        subscriptions.add(subscription)
        owned.add(subscription)
        // Use microtasks for deterministic tests; Convex uses setTimeout(0).
        if (bestRecord(name, callArgs)) {
          queueMicrotask(() => {
            const best = bestRecord(name, callArgs)
            if (subscription.current === undefined && best?.outcome) {
              deliver(subscription, best.outcome)
            }
          })
        }
        const unsubscribe = () => {
          subscription.active = false
          subscriptions.delete(subscription)
          owned.delete(subscription)
        }
        return Object.assign(unsubscribe, {
          unsubscribe,
          // Like Convex: a result is known while any subscription to the same
          // query and arguments on this client holds it, not only this one.
          getCurrentValue: () => {
            const known = [...owned].find(
              (other) =>
                other.current !== undefined &&
                other.name === subscription.name &&
                other.identity === subscription.identity &&
                hash(other.args) === hash(subscription.args),
            )?.current
            if (known?.state === 'rejected') throw asError(known.error)
            return known?.value
          },
          getQueryLogs: () => undefined,
        })
      },
      connectionState: () => connection,
      subscribeToConnectionState(listener: (state: ConnectionState) => void) {
        connectionListeners.add(listener)
        ownedConnectionListeners.add(listener)
        return () => {
          connectionListeners.delete(listener)
          ownedConnectionListeners.delete(listener)
        }
      },
      /** Convex confirms the token asynchronously; this client does the same. */
      setAuth(
        fetchToken: (options: { forceRefreshToken: boolean }) => Promise<string | null | undefined>,
        onChange: (isAuthenticated: boolean) => void,
      ) {
        const revision = ++authRevision
        void Promise.resolve(fetchToken({ forceRefreshToken: false })).then(
          (token) => {
            if (closed || revision !== authRevision) return
            if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) {
              onChange(false)
              return
            }
            identity = `user:${token.slice(TOKEN_PREFIX.length)}`
            onChange(true)
          },
          () => {
            if (!closed && revision === authRevision) onChange(false)
          },
        )
      },
      async close() {
        closed = true
        for (const subscription of owned) {
          subscription.active = false
          subscriptions.delete(subscription)
        }
        owned.clear()
        for (const listener of ownedConnectionListeners) connectionListeners.delete(listener)
        ownedConnectionListeners.clear()
      },
    }
    // The controls store untyped answers keyed by function name. These four
    // assertions bind those answers to the caller's generated reference types;
    // the client surface and mutation options remain structurally checked.
    return {
      ...client,
      query: client.query as OwnedConvexClient['query'],
      mutation: client.mutation as OwnedConvexClient['mutation'],
      action: client.action as OwnedConvexClient['action'],
      onUpdate: client.onUpdate as OwnedConvexClient['onUpdate'],
    }
  }

  return {
    createClient,
    writeRecord,
    configureWrite,
    queryRecord,
    configureQuery,
    queryCalls,
    activeSubscriptions,
    setConnectionState,
    connectionState: () => connection,
  }
}

export type TestTransport = ReturnType<typeof createTestTransport>
