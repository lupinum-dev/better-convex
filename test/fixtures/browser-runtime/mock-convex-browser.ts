import type { FunctionReference } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { ConvexError } from 'convex/values'

interface MockSubscription {
  id: number
  functionName: string
  args: Record<string, unknown>
  active: boolean
  emit(value: unknown): void
  fail(error: unknown): void
}

interface MockStats {
  clients: number
  closed: number
  setAuth: number
  tokenFetches: number
  queryCalls: number
  mutationCalls: number
  actionCalls: number
  activeSubscriptions: number
}

const stats: Omit<MockStats, 'activeSubscriptions'> = {
  clients: 0,
  closed: 0,
  setAuth: 0,
  tokenFetches: 0,
  queryCalls: 0,
  mutationCalls: 0,
  actionCalls: 0,
}
const subscriptions: MockSubscription[] = []
let nextSubscriptionId = 1
let currentAuthChange: ((authenticated: boolean) => void) | null = null
let nextFailure: {
  operation: 'query' | 'mutation' | 'action'
  error: unknown
} | null = null
let deferredMutation:
  | {
      resolve(value: unknown): void
      reject(error: unknown): void
    }
  | undefined

export function readMockStats(): MockStats {
  return {
    ...stats,
    activeSubscriptions: subscriptions.filter((subscription) => subscription.active).length,
  }
}

export function readSubscriptions() {
  return subscriptions.map(({ id, functionName, args, active }) => ({
    id,
    functionName,
    args,
    active,
  }))
}

export function emitLatestSubscription(
  functionName: string,
  value: unknown,
  cursor?: string | null,
): number {
  let subscription: MockSubscription | undefined
  for (let index = subscriptions.length - 1; index >= 0; index -= 1) {
    const candidate = subscriptions[index]!
    if (
      candidate.active &&
      candidate.functionName === functionName &&
      (cursor === undefined ||
        (candidate.args.paginationOpts as { cursor?: string | null } | undefined)?.cursor ===
          cursor)
    ) {
      subscription = candidate
      break
    }
  }
  if (!subscription) {
    throw new Error(`No active ${functionName} subscription for cursor ${String(cursor)}`)
  }
  subscription.emit(value)
  return subscription.id
}

export function failLatestSubscription(functionName: string, message: string): number {
  let subscription: MockSubscription | undefined
  for (let index = subscriptions.length - 1; index >= 0; index -= 1) {
    const candidate = subscriptions[index]!
    if (candidate.active && candidate.functionName === functionName) {
      subscription = candidate
      break
    }
  }
  if (!subscription) throw new Error(`No active ${functionName} subscription`)
  subscription.fail(new Error(message))
  return subscription.id
}

export function failNextCall(
  operation: 'query' | 'mutation' | 'action',
  kind: 'plain' | 'application',
  message: string,
): void {
  nextFailure = {
    operation,
    error:
      kind === 'application'
        ? new ConvexError({ code: 'FIXTURE_DENIED', reason: 'fixture-policy' })
        : new Error(message),
  }
}

export function resolveDeferredMutation(value: unknown): void {
  if (!deferredMutation) throw new Error('No deferred mutation is pending')
  const pending = deferredMutation
  deferredMutation = undefined
  pending.resolve(value)
}

export function rejectCurrentCredential(): void {
  currentAuthChange?.(false)
}

function consumeFailure(operation: 'query' | 'mutation' | 'action'): unknown {
  if (nextFailure?.operation !== operation) return undefined
  const error = nextFailure.error
  nextFailure = null
  return error
}

export class ConvexClient {
  constructor(_url: string, _options: unknown) {
    stats.clients += 1
  }

  setAuth(
    fetchToken: () => Promise<string | null>,
    onChange: (authenticated: boolean) => void,
  ): void {
    stats.setAuth += 1
    currentAuthChange = onChange
    void fetchToken().then((token) => {
      stats.tokenFetches += 1
      queueMicrotask(() => onChange(typeof token === 'string' && token.length > 0))
    })
  }

  query = async (reference: FunctionReference<'query'>, _args: Record<string, unknown>) => {
    stats.queryCalls += 1
    const failure = consumeFailure('query')
    if (failure) throw failure
    return getFunctionName(reference).endsWith('listPaginated')
      ? { page: [], continueCursor: '', isDone: true }
      : []
  }

  mutation = async (_reference: FunctionReference<'mutation'>, args: Record<string, unknown>) => {
    stats.mutationCalls += 1
    const failure = consumeFailure('mutation')
    if (failure) throw failure
    if (args.defer === true) {
      return await new Promise((resolve, reject) => {
        deferredMutation = { resolve, reject }
      })
    }
    return { operation: 'mutation', value: args.value }
  }

  action = async (_reference: FunctionReference<'action'>, args: Record<string, unknown>) => {
    stats.actionCalls += 1
    const failure = consumeFailure('action')
    if (failure) throw failure
    return { operation: 'action', value: args.value }
  }

  onUpdate = (
    reference: FunctionReference<'query'>,
    args: Record<string, unknown>,
    onValue: (value: unknown) => void,
    onError: (error: unknown) => void,
  ) => {
    const subscription: MockSubscription = {
      id: nextSubscriptionId++,
      functionName: getFunctionName(reference),
      args,
      active: true,
      emit: onValue,
      fail: onError,
    }
    subscriptions.push(subscription)
    return () => {
      subscription.active = false
    }
  }

  connectionState = () => ({
    hasInflightRequests: false,
    isWebSocketConnected: true,
    timeOfOldestInflightRequest: null,
    hasEverConnected: true,
    connectionCount: 1,
    connectionRetries: 0,
    inflightMutations: 0,
    inflightActions: 0,
  })

  subscribeToConnectionState = () => () => {}

  async close(): Promise<void> {
    stats.closed += 1
    for (const subscription of subscriptions) subscription.active = false
  }
}

/**
 * Preserve the complete `convex/browser` export shape used by the packed Nuxt
 * runtime. The lifecycle fixture disables SSR queries, so this client must
 * remain uninstantiated; throwing makes an accidental server execution visible
 * instead of silently turning the browser mock into a second SSR protocol.
 */
export class ConvexHttpClient {
  setAuth(_token: string): void {}

  async query(): Promise<never> {
    throw new Error('The browser lifecycle fixture must not execute SSR queries')
  }
}
