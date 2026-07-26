import {
  useConvexPaginatedQuery as useVuePaginatedQuery,
  type PaginatedQueryArgs,
  type PaginatedQueryItem,
  type PaginatedQueryReference,
} from 'better-convex-vue'
import type { FunctionArgs, PaginationResult } from 'convex/server'
import {
  computed,
  onScopeDispose,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue'

import { useAsyncData, useNuxtApp, useRequestEvent, useState } from '#imports'

import { identityToken } from '../auth/auth-identity'
import { ConvexCallError, normalizeConvexError } from '../errors'
import { readConvexRuntimeContext } from '../runtime-context'
import type { ConvexQueryRest } from '../utils/args-tuple'
import { useConvexIdentityState } from '../utils/auth-identity-state'
import type { ConvexAuthMode } from '../utils/auth-status'
import {
  fetchAuthToken,
  matchesConvexHydrationIdentity,
  withAuthDimension,
} from '../utils/convex-cache'
import { createConvexQueryKey, getFunctionName } from '../utils/convex-shared'
import { executeQueryHttp } from '../utils/query-execution'
import { createQueryExecutionGate } from '../utils/query-execution-gate'
import { createConvexQueryAuthContext } from '../utils/query-foundation'
import { normalizeConvexReactiveArgs } from '../utils/reactive-args'
import { getConvexRuntimeConfig } from '../utils/runtime-config'
import {
  computeSsrPaginationStatus,
  isIncompletePaginationPage,
} from '../utils/ssr-pagination-state'

export type ConvexPaginatedQuerySkip = 'skip'
export type ConvexPaginatedQueryArgs<Args> = Args | ConvexPaginatedQuerySkip

export {
  insertAtTop,
  insertAtPosition,
  insertAtBottomIfLoaded,
  updateInPaginatedQuery,
  deleteFromPaginatedQuery,
  type PaginatedQueryReference,
  type PaginatedQueryArgs,
  type PaginatedQueryItem,
  type InsertAtTopOptions,
  type InsertAtPositionOptions,
  type InsertAtBottomIfLoadedOptions,
  type UpdateInPaginatedQueryOptions,
  type DeleteFromPaginatedQueryOptions,
} from './optimistic-updates'

export type PaginatedQueryStatus =
  | 'idle'
  | 'loading-first-page'
  | 'ready'
  | 'loading-more'
  | 'exhausted'
  | 'error'

export interface UseConvexPaginatedQueryOptions<Item = unknown, TransformedItem = Item> {
  initialNumItems?: number
  server?: boolean
  subscribe?: boolean
  initialData?: Item[] | (() => Item[])
  transform?: (results: Item[]) => TransformedItem[]
  keepPreviousData?: boolean
  auth?: ConvexAuthMode
}

export interface UseConvexPaginatedQueryData<Item> {
  results: ComputedRef<Item[]>
  status: ComputedRef<PaginatedQueryStatus>
  isLoading: ComputedRef<boolean>
  isStale: ComputedRef<boolean>
  hasNextPage: ComputedRef<boolean>
  loadMore: (numItems: number) => void
  error: Readonly<Ref<ConvexCallError | null>>
  refresh: () => Promise<void>
  reset: () => Promise<void>
}

interface BuildConvexPaginatedQueryResult<Item> {
  resultData: UseConvexPaginatedQueryData<Item>
  resolvePromise: Promise<void>
}

type CheckedPaginatedQuery<Query extends PaginatedQueryReference> =
  FunctionArgs<Query> extends { paginationOpts: unknown } ? Query : never

export function createConvexPaginatedQueryState<
  Query extends PaginatedQueryReference,
  Args extends ConvexPaginatedQueryArgs<PaginatedQueryArgs<Query>> = PaginatedQueryArgs<Query>,
  TransformedItem = PaginatedQueryItem<Query>,
>(
  query: CheckedPaginatedQuery<Query>,
  args: MaybeRefOrGetter<Args>,
  options?: UseConvexPaginatedQueryOptions<PaginatedQueryItem<Query>, TransformedItem>,
  resolveImmediately = false,
): BuildConvexPaginatedQueryResult<TransformedItem> {
  type Item = PaginatedQueryItem<Query>
  const config = getConvexRuntimeConfig()
  const initialNumItems = options?.initialNumItems ?? 10
  const server = options?.server ?? config.defaults.server
  const subscribe = options?.subscribe ?? config.defaults.subscribe
  const auth = options?.auth ?? 'optional'

  if (import.meta.client) {
    const authContext = createConvexQueryAuthContext()
    const hydratedArgs = normalizeConvexReactiveArgs(toValue(args)) as Args
    const hydrationGate = createQueryExecutionGate({
      authStatus: authContext.status.value,
      authMode: auth,
      identityKey: authContext.identityKey.value,
      skipped: hydratedArgs === 'skip',
      subscribe: false,
    })
    const hydrationKey =
      hydrationGate.outcome === 'execute'
        ? withAuthDimension(
            createConvexQueryKey(
              query,
              {
                ...(hydratedArgs as PaginatedQueryArgs<Query>),
                paginationOpts: { numItems: initialNumItems, cursor: null },
              } as never,
              'convex-paginated',
            ),
            auth,
            hydrationGate.cacheIdentity,
          )
        : `convex-paginated:${hydrationGate.outcome}:${getFunctionName(query)}`
    const nuxtApp = useNuxtApp()
    const runtime = readConvexRuntimeContext(nuxtApp)
    const hydrationIdentityMatches =
      hydrationGate.outcome === 'execute' &&
      matchesConvexHydrationIdentity(
        auth,
        hydrationGate.cacheIdentity,
        runtime?.attachment.identity.snapshot(),
      )
    const hydrated = hydrationIdentityMatches
      ? (nuxtApp.payload.data[hydrationKey] as PaginationResult<Item> | null | undefined)
      : undefined
    const hydratedErrors = useState<Record<string, ConvexCallError | null>>(
      'convex:query-errors',
      () => ({}),
    )
    const result = useVuePaginatedQuery<Query, TransformedItem>(query, args, {
      initialNumItems,
      subscribe,
      initialData: options?.initialData,
      initialPage: hydrated ?? undefined,
      transform: options?.transform,
      keepPreviousData: options?.keepPreviousData,
      auth,
    })
    const clearHydratedError = () => {
      if (!(hydrationKey in hydratedErrors.value)) return
      const { [hydrationKey]: _removed, ...rest } = hydratedErrors.value
      hydratedErrors.value = rest
    }
    const stopHydratedErrorReconciliation = watch(
      [result.error, result.status],
      ([liveError, liveStatus]) => {
        if (liveError || liveStatus !== 'loading-first-page') clearHydratedError()
      },
      { flush: 'sync' },
    )
    onScopeDispose(stopHydratedErrorReconciliation)
    const error = computed(
      () =>
        result.error.value ??
        (hydrationIdentityMatches ? hydratedErrors.value[hydrationKey] : null) ??
        null,
    )
    const status = computed<PaginatedQueryStatus>(() =>
      error.value ? 'error' : result.status.value,
    )
    const isLoading = computed(() => (error.value ? false : result.isLoading.value))
    const resultData: UseConvexPaginatedQueryData<TransformedItem> = {
      ...result,
      error,
      status,
      isLoading,
      reset: async () => {
        clearHydratedError()
        await result.reset()
      },
    }
    return {
      resultData,
      resolvePromise:
        resolveImmediately || hydrated !== undefined || error.value
          ? Promise.resolve()
          : subscribe
            ? result.firstPageSettled()
            : result.refresh(),
    }
  }

  const authContext = createConvexQueryAuthContext()
  const currentArgs = computed(
    () =>
      normalizeConvexReactiveArgs(toValue(args)) as ConvexPaginatedQueryArgs<
        PaginatedQueryArgs<Query>
      >,
  )
  const gate = computed(() =>
    createQueryExecutionGate({
      authStatus: authContext.status.value,
      authMode: auth,
      identityKey: authContext.identityKey.value,
      skipped: currentArgs.value === 'skip',
      subscribe: false,
    }),
  )
  const key = computed(() => {
    if (gate.value.outcome !== 'execute') {
      return `convex-paginated:${gate.value.outcome}:${getFunctionName(query)}`
    }
    return withAuthDimension(
      createConvexQueryKey(
        query,
        {
          ...(currentArgs.value as PaginatedQueryArgs<Query>),
          paginationOpts: { numItems: initialNumItems, cursor: null },
        } as never,
        'convex-paginated',
      ),
      auth,
      gate.value.cacheIdentity,
    )
  })
  const errors = useState<Record<string, ConvexCallError | null>>('convex:query-errors', () => ({}))
  const event = useRequestEvent()
  const identity = useConvexIdentityState()
  const cachedToken = computed(() => identityToken(identity.value))
  const asyncData = useAsyncData<PaginationResult<Item> | null>(
    key,
    async () => {
      const decision = gate.value
      if (decision.outcome !== 'execute') return null
      if (!config.url) return null
      try {
        const token = fetchAuthToken({
          auth,
          cookieHeader: event?.headers.get('cookie') ?? '',
          cachedToken,
        })
        if (auth !== 'none' && decision.cacheIdentity !== 'anonymous' && !token) return null
        const value = await executeQueryHttp<PaginationResult<Item>>(
          config.url,
          getFunctionName(query),
          {
            ...(currentArgs.value as PaginatedQueryArgs<Query>),
            paginationOpts: { numItems: initialNumItems, cursor: null },
          },
          token,
          event?.web?.request?.signal,
        )
        if (isIncompletePaginationPage(value)) {
          throw new ConvexCallError({
            kind: 'unknown',
            code: 'PAGINATION_SPLIT_REQUIRED',
            message: 'Convex pagination page requires a bounded live split',
          })
        }
        const { [key.value]: _removed, ...rest } = errors.value
        errors.value = rest
        return value
      } catch (error) {
        errors.value = {
          ...errors.value,
          [key.value]: normalizeConvexError(error),
        }
        return null
      }
    },
    { server, lazy: resolveImmediately, deep: false },
  )
  const rawResults = computed(() => asyncData.data.value?.page ?? options?.initialData ?? [])
  const results = computed<TransformedItem[]>(() => {
    const raw = typeof rawResults.value === 'function' ? rawResults.value() : rawResults.value
    return options?.transform ? options.transform(raw) : (raw as unknown as TransformedItem[])
  })
  const error = computed(
    () =>
      errors.value[key.value] ??
      (gate.value.outcome === 'error'
        ? (authContext.error.value ??
          normalizeConvexError(new Error('Authentication failed before the query could execute')))
        : null),
  )
  const status = computed<PaginatedQueryStatus>(() =>
    computeSsrPaginationStatus({
      execution: gate.value.outcome,
      hasError: error.value !== null,
      pending: asyncData.pending.value,
      hasPage: asyncData.data.value !== null,
      hasInitialData: options?.initialData !== undefined,
      isDone: asyncData.data.value?.isDone === true,
    }),
  )
  const resultData: UseConvexPaginatedQueryData<TransformedItem> = {
    results,
    status,
    isLoading: computed(() => status.value === 'loading-first-page'),
    isStale: computed(() => false),
    hasNextPage: computed(() => Boolean(asyncData.data.value && !asyncData.data.value.isDone)),
    loadMore: () => {},
    error,
    refresh: asyncData.refresh,
    reset: async () => {
      asyncData.clear()
      await asyncData.refresh()
    },
  }
  return {
    resultData,
    resolvePromise:
      server && gate.value.outcome !== 'idle' ? asyncData.then(() => {}) : Promise.resolve(),
  }
}

export async function useConvexPaginatedQuery<
  Query extends PaginatedQueryReference,
  Args extends ConvexPaginatedQueryArgs<PaginatedQueryArgs<Query>> = PaginatedQueryArgs<Query>,
  TransformedItem = PaginatedQueryItem<Query>,
>(
  query: CheckedPaginatedQuery<Query>,
  ...rest: ConvexQueryRest<
    PaginatedQueryArgs<Query>,
    MaybeRefOrGetter<ConvexPaginatedQueryArgs<NoInfer<Args>>>,
    UseConvexPaginatedQueryOptions<PaginatedQueryItem<Query>, TransformedItem>
  >
): Promise<UseConvexPaginatedQueryData<TransformedItem>> {
  const [args, options] = rest
  const result = createConvexPaginatedQueryState(query, args as MaybeRefOrGetter<Args>, options)
  await result.resolvePromise
  return result.resultData
}
