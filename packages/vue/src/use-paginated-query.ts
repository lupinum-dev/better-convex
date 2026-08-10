import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  PaginationOptions,
  PaginationResult,
} from 'convex/server'
import { getFunctionName } from 'convex/server'
import { hash } from 'ohash'
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  shallowRef,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
} from 'vue'

import type { ConvexCallError } from './errors'
import { createPaginationController } from './internal/pagination-controller'
import { normalizeConvexArgs, isConvexArgsSkipped } from './internal/query-args'
import type { QueryIsolationTag } from './internal/query-controller'
import { decideQueryExecution } from './internal/query-execution'
import { useBetterConvexRuntime } from './runtime-context'
import type { ConvexAuthMode } from './use-query'

export type PaginatedQueryReference = FunctionReference<
  'query',
  'public',
  { paginationOpts: PaginationOptions },
  PaginationResult<unknown>
>

export type PaginatedQueryArgs<Query extends PaginatedQueryReference> = Omit<
  FunctionArgs<Query>,
  'paginationOpts'
>

export type PaginatedQueryItem<Query extends PaginatedQueryReference> =
  FunctionReturnType<Query>['page'][number]

export interface UseConvexPaginatedQueryOptions {
  readonly initialNumItems: number
  readonly auth?: ConvexAuthMode
  readonly keepPreviousData?: boolean
}

export interface UseConvexPaginatedQueryState<Item> {
  readonly data: ComputedRef<readonly Item[] | undefined>
  readonly status: ComputedRef<'idle' | 'pending' | 'success' | 'error'>
  readonly isLoading: ComputedRef<boolean>
  readonly canLoadMore: ComputedRef<boolean>
  readonly error: ComputedRef<ConvexCallError | undefined>
  readonly isStale: ComputedRef<boolean>
  loadMore(numItems: number): void
  refresh(): Promise<void>
}

interface NuxtPaginationBridge<Item> {
  initialPage?: PaginationResult<Item>
  onFirstPageSettled(promise: Promise<void>): void
}

export function useConvexPaginatedQuery<Query extends PaginatedQueryReference>(
  query: Query,
  args: MaybeRefOrGetter<PaginatedQueryArgs<Query> | 'skip'>,
  options: UseConvexPaginatedQueryOptions,
): UseConvexPaginatedQueryState<PaginatedQueryItem<Query>>
export function useConvexPaginatedQuery<Query extends PaginatedQueryReference>(
  query: Query,
  ...parameters: [
    args: MaybeRefOrGetter<PaginatedQueryArgs<Query> | 'skip'>,
    options: UseConvexPaginatedQueryOptions,
    bridge?: NuxtPaginationBridge<PaginatedQueryItem<Query>>,
  ]
): UseConvexPaginatedQueryState<PaginatedQueryItem<Query>> {
  const [args, options, bridge] = parameters
  if (!getCurrentScope()) {
    throw new Error(
      '[better-convex-vue] useConvexPaginatedQuery must run inside a Vue effect scope',
    )
  }
  if (!Number.isSafeInteger(options.initialNumItems) || options.initialNumItems < 1) {
    throw new Error('[better-convex-vue] initialNumItems must be a positive safe integer')
  }

  type Item = PaginatedQueryItem<Query>
  // Nuxt passes SSR state through a private fourth runtime-only slot via Reflect.apply.
  // The public overload above intentionally omits it from generated declarations.
  const runtime = useBetterConvexRuntime()
  const auth = options.auth ?? 'optional'
  const initialNumItems = options.initialNumItems
  const identity = runtime.identity.snapshot
  const currentArgs = computed(() => normalizeConvexArgs(args))
  const argsHash = computed(() => hash(currentArgs.value))
  const functionName = getFunctionName(query)
  const boundaryFirstPage = shallowRef<PaginationResult<Item> | null>(bridge?.initialPage ?? null)
  const boundaryError = shallowRef<ConvexCallError | undefined>(undefined)

  const gate = computed(() =>
    decideQueryExecution({
      auth,
      skipped: isConvexArgsSkipped(currentArgs.value),
      identity: identity.value,
    }),
  )
  const idle = computed(() => gate.value === 'idle' || gate.value === 'error')
  const live = computed(() => gate.value === 'execute')
  const tag = computed<QueryIsolationTag>(() => ({
    identityKey: auth === 'none' ? 'anonymous' : (identity.value.identityKey ?? 'anonymous'),
    identityGeneration: auth === 'none' ? 0 : identity.value.identityGeneration,
  }))
  const boundaryKey = computed(
    () => `${functionName}:${auth}:${tag.value.identityKey}:${argsHash.value}:${initialNumItems}`,
  )

  const fetchPage = async (paginationOpts: {
    numItems: number
    cursor: string | null
    id: number
  }): Promise<PaginationResult<Item> | null> => {
    if (gate.value !== 'execute' || isConvexArgsSkipped(currentArgs.value)) return null
    return (await runtime.browser.clientFor(auth).query(query, {
      ...(currentArgs.value as PaginatedQueryArgs<Query>),
      paginationOpts,
    } as FunctionArgs<Query>)) as PaginationResult<Item>
  }

  const controller = createPaginationController<Item>({
    query,
    initialNumItems,
    keepPreviousData: options.keepPreviousData ?? false,
    getArgs: () =>
      isConvexArgsSkipped(currentArgs.value)
        ? 'skip'
        : (currentArgs.value as Record<string, unknown>),
    getArgsHash: () => argsHash.value,
    getBoundaryKey: () => boundaryKey.value,
    getIsolationTag: () => tag.value,
    isIdle: () => idle.value,
    isLive: () => live.value,
    getBoundaryFirstPage: () => boundaryFirstPage.value,
    getBoundaryError: () =>
      auth === 'none' ? boundaryError.value : (identity.value.error ?? boundaryError.value),
    setBoundaryError: (error) => {
      boundaryError.value = error
    },
    getClient: () => (gate.value === 'execute' ? runtime.browser.clientFor(auth) : null),
    fetchPage,
  })
  controller.start()
  bridge?.onFirstPageSettled(controller.firstPageSettled())

  let previousTag = tag.value
  let previousBoundaryKey = boundaryKey.value
  let previousLive = live.value
  let initialized = false
  const reconcile = () => {
    const nextTag = tag.value
    const nextBoundaryKey = boundaryKey.value
    if (!initialized) {
      initialized = true
      previousTag = nextTag
      previousBoundaryKey = nextBoundaryKey
      previousLive = live.value
      return
    }
    const priorTag = previousTag
    const priorBoundaryKey = previousBoundaryKey
    const priorLive = previousLive
    previousTag = nextTag
    previousBoundaryKey = nextBoundaryKey
    previousLive = live.value
    if (
      nextTag.identityGeneration !== priorTag.identityGeneration ||
      nextTag.identityKey !== priorTag.identityKey
    ) {
      boundaryFirstPage.value = null
      controller.handleIdentityBoundary({
        nextTag,
        previousTag: priorTag,
        previousBoundaryKey: priorBoundaryKey,
      })
    } else {
      if (nextBoundaryKey !== priorBoundaryKey || idle.value) boundaryFirstPage.value = null
      void controller.handleExecutionBoundary({
        nextBoundaryKey,
        previousBoundaryKey: priorBoundaryKey,
        nextLive: live.value,
        previousLive: priorLive,
      })
    }
  }
  const stop = watch([argsHash, gate, live, () => identity.value.identityGeneration], reconcile, {
    immediate: true,
    flush: 'sync',
  })
  onScopeDispose(() => {
    stop()
    controller.dispose()
  })

  return Object.freeze({
    data: controller.data,
    status: controller.status,
    isLoading: controller.isLoading,
    isStale: controller.isStale,
    canLoadMore: controller.canLoadMore,
    loadMore: controller.loadMore,
    error: controller.error,
    refresh: controller.refresh,
  })
}
