import type {
  PaginatedQueryArgs,
  PaginatedQueryItem,
  PaginatedQueryReference,
  UseConvexPaginatedQueryOptions,
  UseConvexPaginatedQueryState,
} from '@lupinum/better-convex-vue'
import {
  createConvexArgsState,
  useConvexPaginatedQueryInternal,
  type ConvexArgsInput,
  type ConvexArgsState,
} from '@lupinum/better-convex-vue/internal'
import { getFunctionName, type PaginationResult } from 'convex/server'
import { computed, shallowRef, type MaybeRefOrGetter } from 'vue'

import { ConvexCallError, type ConvexCallErrorCode } from '../errors'
import { paginatedPayloadHash } from '../utils/convex-cache'
import { resolveDefaultQueryAuth } from '../utils/default-query-auth'
import { executeQueryHttp } from '../utils/query-execution'
import {
  useConvexQueryHydration,
  useConvexSsrQuery,
  type ConvexQueryBoundaryInput,
} from '../utils/query-foundation'
import { projectConvexSsrPagination } from '../utils/query-ssr'
import { isIncompletePaginationPage } from '../utils/ssr-pagination-state'
import { createNuxtAwaitableState } from './nuxt-awaitable-state'
import { resolveQueryLifecycleOptions } from './query-lifecycle-options'

export type {
  PaginatedQueryArgs,
  PaginatedQueryItem,
  PaginatedQueryReference,
  UseConvexPaginatedQueryState,
}

interface UseNuxtConvexPaginatedQueryBaseOptions extends Omit<
  UseConvexPaginatedQueryOptions,
  'immediate'
> {
  readonly server?: boolean
}

export type UseNuxtConvexPaginatedQueryOptions = UseNuxtConvexPaginatedQueryBaseOptions &
  (
    | { readonly immediate?: true; readonly lazy?: boolean }
    | { readonly immediate: false; readonly lazy?: false }
  )

export type NuxtConvexPaginatedQuery<Item> = UseConvexPaginatedQueryState<Item> &
  Promise<UseConvexPaginatedQueryState<Item>>

interface BuildConvexPaginatedQueryResult<Item> {
  resultData: UseConvexPaginatedQueryState<Item>
  resolvePromise: Promise<void>
}

interface ResolvedNuxtConvexPaginatedQueryOptions {
  readonly auth: NonNullable<UseConvexPaginatedQueryOptions['auth']>
  readonly immediate: boolean
  readonly initialCursor: string | null
  readonly initialNumItems: number
  readonly keepPreviousData: UseConvexPaginatedQueryOptions['keepPreviousData']
  readonly lazy: boolean
  readonly server: boolean
}

function paginatedBoundary(
  query: PaginatedQueryReference,
  args: ConvexArgsState<unknown>,
  options: ResolvedNuxtConvexPaginatedQueryOptions,
  cursor: () => string | null,
): ConvexQueryBoundaryInput {
  return {
    namespace: 'convex-paginated',
    functionName: getFunctionName(query),
    auth: options.auth,
    server: options.server,
    immediate: options.immediate,
    args,
    keyHash: () => paginatedPayloadHash(args.hash.value, options.initialNumItems, cursor()),
  }
}

function createClientConvexPaginatedQueryState<Query extends PaginatedQueryReference>(
  query: Query,
  args: ConvexArgsState<PaginatedQueryArgs<Query>>,
  options: ResolvedNuxtConvexPaginatedQueryOptions,
): BuildConvexPaginatedQueryResult<PaginatedQueryItem<Query>> {
  type Item = PaginatedQueryItem<Query>
  const { auth, immediate, initialCursor, initialNumItems, keepPreviousData, lazy, server } =
    options
  const hydration = useConvexQueryHydration<PaginationResult<Item>>(
    paginatedBoundary(query, args, options, () => initialCursor),
  )
  const live = useConvexPaginatedQueryInternal({
    query,
    args,
    options: {
      initialNumItems,
      initialCursor,
      auth,
      keepPreviousData,
      immediate: immediate && !hydration.defersLiveStart,
    },
    bridge: { initialPage: hydration.seed?.value },
  })
  const result = live.state
  if (hydration.defersLiveStart) hydration.startLive(result)

  // While hydrating, the list renders what the server rendered; a loadMore
  // requested meanwhile is held by the live list and shows as loading more.
  const ssr = computed(() => {
    const view = hydration.view.value
    return view ? projectConvexSsrPagination(view) : undefined
  })
  const error = computed(() =>
    ssr.value ? ssr.value.error : (result.error.value ?? hydration.error.value),
  )
  // A bridged SSR error is a first-page error until the live list settles. A
  // live error may be a later page's, which leaves the first page `success`.
  const status = computed(
    () =>
      ssr.value?.status ??
      (result.error.value === undefined && hydration.error.value !== undefined
        ? 'error'
        : result.status.value),
  )
  const resultData: UseConvexPaginatedQueryState<Item> = {
    ...result,
    data: computed(() => (ssr.value ? ssr.value.data : result.data.value)),
    error,
    status,
    pending: computed(() => status.value === 'pending'),
    blockedBy: computed(() => (ssr.value ? ssr.value.blockedBy : result.blockedBy.value)),
    canLoadMore: computed(() =>
      ssr.value ? ssr.value.canLoadMore && !result.isLoadingMore.value : result.canLoadMore.value,
    ),
    isExhausted: computed(() => (ssr.value ? ssr.value.isExhausted : result.isExhausted.value)),
    // A restart drops the server-rendered page along with the live pages.
    restart(cursor?: string | null) {
      result.restart(cursor)
      hydration.retire()
    },
  }
  return {
    resultData,
    resolvePromise:
      lazy || !immediate || !server || hydration.defersLiveStart || status.value !== 'pending'
        ? Promise.resolve()
        : live.firstPageSettled(),
  }
}

function createServerConvexPaginatedQueryState<Query extends PaginatedQueryReference>(
  query: Query,
  args: ConvexArgsState<PaginatedQueryArgs<Query>>,
  options: ResolvedNuxtConvexPaginatedQueryOptions,
): BuildConvexPaginatedQueryResult<PaginatedQueryItem<Query>> {
  type Item = PaginatedQueryItem<Query>
  const startCursor = shallowRef(options.initialCursor)
  const boundary = paginatedBoundary(query, args, options, () => startCursor.value)
  const ssr = useConvexSsrQuery<PaginationResult<Item>>({
    ...boundary,
    lazy: options.lazy,
    async fetch(convexUrl, token, signal, bounds) {
      const page = await executeQueryHttp<PaginationResult<Item>>(
        convexUrl,
        boundary.functionName,
        {
          ...(args.args.value as PaginatedQueryArgs<Query>),
          paginationOpts: {
            numItems: options.initialNumItems,
            cursor: startCursor.value,
          },
        },
        token,
        signal,
        bounds,
      )
      if (isIncompletePaginationPage(page)) {
        throw new ConvexCallError({
          kind: 'unknown',
          code: 'PAGINATION_SPLIT_REQUIRED' satisfies ConvexCallErrorCode,
          message: 'Convex pagination page requires a bounded live split',
          functionName: boundary.functionName,
        })
      }
      return page
    },
  })
  const view = computed(() => projectConvexSsrPagination(ssr.view.value))
  const status = computed(() => view.value.status)
  const resultData: UseConvexPaginatedQueryState<Item> = {
    data: computed(() => view.value.data),
    status,
    pending: computed(() => status.value === 'pending'),
    error: computed(() => view.value.error),
    isStale: computed(() => false),
    blockedBy: computed(() => view.value.blockedBy),
    canLoadMore: computed(() => view.value.canLoadMore),
    isLoadingMore: computed(() => false),
    isExhausted: computed(() => view.value.isExhausted),
    // The server renders the first page only; later pages load in the browser.
    loadMore: () => Promise.resolve(),
    execute: ssr.execute,
    restart(cursor: string | null = null) {
      if (typeof cursor !== 'string' && cursor !== null) {
        throw new Error('[better-convex-nuxt] restart cursor must be a string or null')
      }
      startCursor.value = cursor
      void ssr.reload()
    },
  }
  return { resultData, resolvePromise: ssr.settled }
}

export function createConvexPaginatedQueryState<Query extends PaginatedQueryReference>(
  query: Query,
  args: MaybeRefOrGetter<ConvexArgsInput<PaginatedQueryArgs<Query>> | 'skip'>,
  options: UseNuxtConvexPaginatedQueryOptions,
): BuildConvexPaginatedQueryResult<PaginatedQueryItem<Query>> {
  const initialNumItems = options.initialNumItems
  if (!Number.isSafeInteger(initialNumItems) || initialNumItems < 1) {
    throw new Error('[better-convex-nuxt] initialNumItems must be a positive safe integer')
  }
  const { immediate, lazy } = resolveQueryLifecycleOptions(options)
  const resolvedOptions: ResolvedNuxtConvexPaginatedQueryOptions = {
    auth: options.auth ?? resolveDefaultQueryAuth(),
    immediate,
    initialCursor: options.initialCursor ?? null,
    initialNumItems,
    keepPreviousData: options.keepPreviousData,
    lazy,
    server: options.server ?? true,
  }
  const argsState = createConvexArgsState(
    args as MaybeRefOrGetter<PaginatedQueryArgs<Query> | 'skip'>,
  )

  return import.meta.client
    ? createClientConvexPaginatedQueryState(query, argsState, resolvedOptions)
    : createServerConvexPaginatedQueryState(query, argsState, resolvedOptions)
}

export function useConvexPaginatedQuery<Query extends PaginatedQueryReference>(
  query: Query,
  args: MaybeRefOrGetter<ConvexArgsInput<PaginatedQueryArgs<Query>> | 'skip'>,
  options: UseNuxtConvexPaginatedQueryOptions,
): NuxtConvexPaginatedQuery<PaginatedQueryItem<Query>> {
  const result = createConvexPaginatedQueryState(query, args, options)
  return createNuxtAwaitableState(result.resultData, result.resolvePromise)
}
