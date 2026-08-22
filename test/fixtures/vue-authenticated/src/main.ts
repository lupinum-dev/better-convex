import {
  createBetterConvex,
  useConvexAction,
  useConvexMutation,
  useConvexPaginatedQuery,
  useConvexQuery,
  type BetterConvexAuthAdapter,
} from '@lupinum/better-convex-vue'
import {
  makeFunctionReference,
  type FunctionReference,
  type PaginationOptions,
  type PaginationResult,
} from 'convex/server'
import { createApp, defineComponent, h, nextTick, onUnmounted, ref } from 'vue'

import {
  emitLatestSubscription,
  failLatestSubscription,
  failNextCall,
  readMockStats,
  readSubscriptions,
  rejectCurrentCredential,
  resolveDeferredMutation,
} from '../../browser-runtime/mock-convex-browser'

type BrowserAuthSnapshot = ReturnType<BetterConvexAuthAdapter['snapshot']>
type AuthStatus = BrowserAuthSnapshot['status']
interface Note {
  id: string
}
interface OperationValue {
  operation: 'mutation' | 'action'
  value: string
}

const notesQuery = makeFunctionReference<'query'>('notes:list') as FunctionReference<
  'query',
  'public',
  { owner: string },
  Note[]
>
const paginatedNotesQuery = makeFunctionReference<'query'>(
  'notes:listPaginated',
) as FunctionReference<
  'query',
  'public',
  { owner: string; paginationOpts: PaginationOptions },
  PaginationResult<Note>
>
const writeNote = makeFunctionReference<'mutation'>('notes:write') as FunctionReference<
  'mutation',
  'public',
  { value: string; defer?: boolean },
  OperationValue
>
const generateNote = makeFunctionReference<'action'>('notes:generate') as FunctionReference<
  'action',
  'public',
  { value: string },
  OperationValue
>

let authSnapshot: BrowserAuthSnapshot = {
  status: 'loading',
  identityKey: null,
  sessionGeneration: 0,
  error: null,
}
let credential: string | null = null
const authListeners = new Set<() => void>()
const adapter: BetterConvexAuthAdapter = {
  snapshot: () => authSnapshot,
  subscribe(listener) {
    authListeners.add(listener)
    return () => authListeners.delete(listener)
  },
  fetchToken: async () => credential,
  refreshSession: async () => {},
}

const plugin = createBetterConvex({
  convexUrl: 'https://authenticated-consumer.invalid',
  auth: adapter,
})
const renderedSnapshot = ref('loading')
const queryOwner = ref('alice')
let operations: ReturnType<typeof createOperations> | null = null
let deferredMutation: Promise<OperationValue> | null = null

function safeSnapshot() {
  return plugin.attachment().identity.snapshot()
}

function renderSnapshot(): void {
  renderedSnapshot.value = JSON.stringify(safeSnapshot())
}

async function waitForCurrentSettlement(): Promise<void> {
  const identity = plugin.attachment().identity
  if (identity.snapshot().settled) return
  await new Promise<void>((resolve) => {
    let stop: (() => void) | null = null
    let settledBeforeSubscriptionReturned = false
    const finish = () => {
      if (!identity.snapshot().settled) return
      if (stop) stop()
      else settledBeforeSubscriptionReturned = true
      resolve()
    }
    stop = identity.subscribe(finish)
    if (settledBeforeSubscriptionReturned) stop()
    else finish()
  })
}

function serializeError(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const candidate = error as {
    name?: unknown
    kind?: unknown
    message?: unknown
    code?: unknown
    status?: unknown
    data?: unknown
  }
  return {
    name: candidate.name,
    kind: candidate.kind,
    message: candidate.message,
    code: candidate.code,
    status: candidate.status,
    data: candidate.data,
  }
}

function createOperations() {
  const query = useConvexQuery(notesQuery, () => ({ owner: queryOwner.value }))
  const pagination = useConvexPaginatedQuery(
    paginatedNotesQuery,
    () => ({ owner: queryOwner.value }),
    { initialNumItems: 1 },
  )
  const mutation = useConvexMutation(writeNote)
  const action = useConvexAction(generateNote)
  return { query, pagination, mutation, action }
}

function operationSnapshot() {
  if (!operations) throw new Error('Operation composables are not mounted')
  return {
    owner: queryOwner.value,
    query: {
      data: operations.query.data.value,
      status: operations.query.status.value,
      pending: operations.query.pending.value,
      error: serializeError(operations.query.error.value),
    },
    pagination: {
      data: operations.pagination.data.value,
      status: operations.pagination.status.value,
      loading: operations.pagination.pending.value,
      stale: operations.pagination.isStale.value,
      canLoadMore: operations.pagination.canLoadMore.value,
      error: serializeError(operations.pagination.error.value),
    },
    mutation: {
      data: operations.mutation.data.value,
      status: operations.mutation.status.value,
      pending: operations.mutation.pending.value,
      error: serializeError(operations.mutation.error.value),
    },
    action: {
      data: operations.action.data.value,
      status: operations.action.status.value,
      pending: operations.action.pending.value,
      error: serializeError(operations.action.error.value),
    },
  }
}

const AuthenticatedConsumer = defineComponent({
  setup() {
    const stop = plugin.attachment().identity.subscribe(renderSnapshot)
    operations = createOperations()
    onUnmounted(stop)
    renderSnapshot()
    return () =>
      h(
        'main',
        {
          'data-consumer': 'better-convex-vue-authenticated',
        },
        renderedSnapshot.value,
      )
  },
})

const app = createApp(AuthenticatedConsumer)
app.use(plugin)
app.mount('#app')

async function transition(
  status: AuthStatus,
  identityKey: string | null,
  sessionGeneration: number,
  token: string | null = null,
): Promise<ReturnType<typeof safeSnapshot>> {
  credential = token
  authSnapshot = {
    status,
    identityKey,
    sessionGeneration,
    error: status === 'error' ? new Error(token ?? 'Provider authentication failed') : null,
  }
  for (const listener of [...authListeners]) listener()
  await waitForCurrentSettlement()
  await nextTick()
  renderSnapshot()
  return safeSnapshot()
}

Object.assign(window, {
  __betterConvexAuthProof: {
    snapshot: safeSnapshot,
    operationSnapshot,
    subscriptions: readSubscriptions,
    attachmentKeys: () => Object.keys(plugin.attachment()).sort(),
    clientKeys: () => Object.keys(plugin.attachment().client).sort(),
    stats: readMockStats,
    transition,
    emitQuery(value: Note[]) {
      emitLatestSubscription('notes:list', value)
      return operationSnapshot()
    },
    emitPage(cursor: string | null, value: PaginationResult<Note>) {
      emitLatestSubscription('notes:listPaginated', value, cursor)
      return operationSnapshot()
    },
    loadMore(count = 1) {
      if (!operations) throw new Error('Operation composables are not mounted')
      operations.pagination.loadMore(count)
      return operationSnapshot()
    },
    async setOwner(owner: string) {
      queryOwner.value = owner
      await nextTick()
      return operationSnapshot()
    },
    failQuery(message: string) {
      failLatestSubscription('notes:list', message)
      return operationSnapshot()
    },
    async runMutation(value: string) {
      if (!operations) throw new Error('Operation composables are not mounted')
      return await operations.mutation({ value })
    },
    async runAction(value: string) {
      if (!operations) throw new Error('Operation composables are not mounted')
      return await operations.action({ value })
    },
    async safeMutation(kind: 'plain' | 'application', message: string) {
      if (!operations) throw new Error('Operation composables are not mounted')
      failNextCall('mutation', kind, message)
      try {
        return { ok: true, data: await operations.mutation({ value: 'denied' }) }
      } catch (error) {
        return { ok: false, error: serializeError(error) }
      }
    },
    startDeferredMutation() {
      if (!operations) throw new Error('Operation composables are not mounted')
      deferredMutation = operations.mutation({ value: 'late', defer: true })
      return operationSnapshot()
    },
    async finishDeferredMutation(value: string) {
      if (!deferredMutation) throw new Error('No deferred mutation promise is pending')
      const pending = deferredMutation
      resolveDeferredMutation({ operation: 'mutation', value })
      deferredMutation = null
      try {
        return { ok: true, data: await pending }
      } catch (error) {
        return { ok: false, error: serializeError(error) }
      }
    },
    rejectCurrent() {
      rejectCurrentCredential()
      renderSnapshot()
      return safeSnapshot()
    },
    unmount() {
      app.unmount()
      return { listeners: authListeners.size, ...readMockStats() }
    },
  },
})

declare global {
  interface Window {
    __betterConvexAuthProof: Record<string, (...args: never[]) => unknown>
  }
}
