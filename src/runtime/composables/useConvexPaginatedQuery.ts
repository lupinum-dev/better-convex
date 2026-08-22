import {
  useConvexPaginatedQuery as useVuePaginatedQuery,
  type PaginatedQueryArgs,
  type PaginatedQueryItem,
  type PaginatedQueryReference,
  type UseConvexPaginatedQueryOptions,
  type UseConvexPaginatedQueryState,
} from '@lupinum/better-convex-vue'
import type { PaginationResult } from 'convex/server'
import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

import { useAsyncData, useNuxtApp, useRequestEvent, useState } from '#imports'

import { identityToken } from '../auth/auth-identity'
import { ConvexCallError, normalizeConvexError } from '../errors'
import { readConvexRuntimeContext } from '../runtime-context'
import { useConvexIdentityState } from '../utils/auth-identity-state'
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

function createClientConvexPaginatedQueryState<Query extends PaginatedQueryReference>(
  query: Query,
  args: MaybeRefOrGetter<PaginatedQueryArgs<Query> | 'skip'>,
  options: ResolvedNuxtConvexPaginatedQueryOptions,
  resolveImmediately: boolean,
): BuildConvexPaginatedQueryResult<PaginatedQueryItem<Query>> {
  type Item = PaginatedQueryItem<Query>
  const { auth, immediate, initialCursor, initialNumItems, keepPreviousData, lazy, server } =
    options
  const authContext = createConvexQueryAuthContext()
  const currentBoundary = computed(() => {
    const currentArgs = normalizeConvexReactiveArgs(toValue(args)) as
      | PaginatedQueryArgs<Query>
      | 'skip'
    const gate = immediate
      ? createQueryExecutionGate({
          authStatus: authContext.status.value,
          authMode: auth,
          identityKey: authContext.identityKey.value,
          skipped: currentArgs === 'skip',
        })
      : ({ outcome: 'idle', cacheIdentity: 'anonymous' } as const)
    const key =
      gate.outcome === 'execute'
        ? withAuthDimension(
            createConvexQueryKey(
              query,
              {
                ...(currentArgs as PaginatedQueryArgs<Query>),
                paginationOpts: {
                  numItems: initialNumItems,
                  cursor: initialCursor,
                },
              } as never,
              'convex-paginated',
            ),
            auth,
            gate.cacheIdentity,
          )
        : `convex-paginated:${gate.outcome}:${getFunctionName(query)}`
    return { gate, key }
  })
  const hydrationBoundary = currentBoundary.value
  const hydrationKey = hydrationBoundary.key
  const nuxtApp = useNuxtApp()
  const runtime = readConvexRuntimeContext(nuxtApp)
  const hydrationIdentityMatches =
    hydrationBoundary.gate.outcome === 'execute' &&
    matchesConvexHydrationIdentity(
      auth,
      hydrationBoundary.gate.cacheIdentity,
      runtime?.attachment.identity.snapshot(),
    )
  const hydrationRetired = ref(false)
  const matchesHydrationBoundary = () => {
    const boundary = currentBoundary.value
    return (
      hydrationIdentityMatches &&
      boundary.key === hydrationKey &&
      boundary.gate.outcome === 'execute' &&
      matchesConvexHydrationIdentity(
        auth,
        boundary.gate.cacheIdentity,
        runtime?.attachment.identity.snapshot(),
      )
    )
  }
  const hydrationBoundaryMatches = computed(
    () => !hydrationRetired.value && matchesHydrationBoundary(),
  )
  const stopHydrationBoundaryRetirement = watch(
    currentBoundary,
    () => {
      if (!matchesHydrationBoundary()) hydrationRetired.value = true
    },
    { flush: 'sync' },
  )
  const hydrated =
    hydrationIdentityMatches && Object.hasOwn(nuxtApp.payload.data, hydrationKey)
      ? (nuxtApp.payload.data[hydrationKey] as PaginationResult<Item> | null | undefined)
      : undefined
  const hasHydratedPage = hydrated !== null && hydrated !== undefined
  const hydratedErrors = useState<Record<string, ConvexCallError | null>>(
    'convex:query-errors',
    () => ({}),
  )
  let firstPageSettled = Promise.resolve()
  const result = Reflect.apply(useVuePaginatedQuery, undefined, [
    query,
    args,
    {
      initialNumItems,
      initialCursor,
      auth,
      keepPreviousData,
      immediate,
    },
    {
      initialPage: hasHydratedPage ? hydrated : undefined,
      onFirstPageSettled(promise: Promise<void>) {
        firstPageSettled = promise
      },
    },
  ]) as UseConvexPaginatedQueryState<Item>
  const clearHydratedError = () => {
    if (!(hydrationKey in hydratedErrors.value)) return
    const { [hydrationKey]: _removed, ...rest } = hydratedErrors.value
    hydratedErrors.value = rest
  }
  const stopHydratedErrorReconciliation = watch(
    [result.error, result.status, hydrationBoundaryMatches],
    ([liveError, liveStatus, boundaryMatches]) => {
      if (boundaryMatches && (liveError || liveStatus !== 'pending')) clearHydratedError()
    },
    { flush: 'sync' },
  )
  onScopeDispose(() => {
    stopHydrationBoundaryRetirement()
    stopHydratedErrorReconciliation()
  })
  const error = computed(
    () =>
      result.error.value ??
      (hydrationBoundaryMatches.value ? hydratedErrors.value[hydrationKey] : undefined) ??
      undefined,
  )
  const status = computed<'idle' | 'pending' | 'success' | 'error'>(() =>
    error.value ? 'error' : result.status.value,
  )
  const pending = computed(() => status.value === 'pending')
  const resultData: UseConvexPaginatedQueryState<Item> = Object.freeze({
    ...result,
    error,
    status,
    pending,
  })
  return {
    resultData,
    resolvePromise:
      resolveImmediately ||
      lazy ||
      !immediate ||
      !server ||
      hasHydratedPage ||
      error.value !== undefined ||
      status.value === 'idle'
        ? Promise.resolve()
        : firstPageSettled,
  }
}

function createServerConvexPaginatedQueryState<Query extends PaginatedQueryReference>(
  query: Query,
  args: MaybeRefOrGetter<PaginatedQueryArgs<Query> | 'skip'>,
  options: ResolvedNuxtConvexPaginatedQueryOptions,
  resolveImmediately: boolean,
  convexUrl: string | undefined,
): BuildConvexPaginatedQueryResult<PaginatedQueryItem<Query>> {
  type Item = PaginatedQueryItem<Query>
  const { auth, immediate, initialCursor, initialNumItems, lazy, server } = options
  const authContext = createConvexQueryAuthContext()
  const started = ref(immediate)
  const startCursor = ref(initialCursor)
  const currentArgs = computed(
    () => normalizeConvexReactiveArgs(toValue(args)) as PaginatedQueryArgs<Query> | 'skip',
  )
  const gate = computed(() =>
    started.value
      ? createQueryExecutionGate({
          authStatus: authContext.status.value,
          authMode: auth,
          identityKey: authContext.identityKey.value,
          skipped: currentArgs.value === 'skip',
        })
      : ({ outcome: 'idle', cacheIdentity: 'anonymous' } as const),
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
          paginationOpts: {
            numItems: initialNumItems,
            cursor: startCursor.value,
          },
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
      if (!convexUrl) return null
      try {
        const token = fetchAuthToken({
          auth,
          cookieHeader: event?.headers.get('cookie') ?? '',
          cachedToken,
        })
        if (auth !== 'none' && decision.cacheIdentity !== 'anonymous' && !token) return null
        const value = await executeQueryHttp<PaginationResult<Item>>(
          convexUrl,
          getFunctionName(query),
          {
            ...(currentArgs.value as PaginatedQueryArgs<Query>),
            paginationOpts: {
              numItems: initialNumItems,
              cursor: startCursor.value,
            },
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
    { server, immediate, lazy: lazy || resolveImmediately, deep: false },
  )
  const data = computed<readonly Item[] | undefined>(() => asyncData.data.value?.page)
  const error = computed(
    () =>
      errors.value[key.value] ??
      (gate.value.outcome === 'error'
        ? (authContext.error.value ??
          normalizeConvexError(new Error('Authentication failed before the query could execute')))
        : undefined) ??
      undefined,
  )
  const status = computed<'idle' | 'pending' | 'success' | 'error'>(() => {
    if (error.value) return 'error'
    if (gate.value.outcome === 'idle') return 'idle'
    if (gate.value.outcome === 'wait' || asyncData.pending.value) return 'pending'
    return asyncData.data.value === null ? 'pending' : 'success'
  })
  const resultData: UseConvexPaginatedQueryState<Item> = Object.freeze({
    data,
    status,
    pending: computed(() => status.value === 'pending'),
    isStale: computed(() => false),
    canLoadMore: computed(
      () => status.value === 'success' && asyncData.data.value?.isDone === false,
    ),
    cursor: computed(() => asyncData.data.value?.continueCursor ?? startCursor.value),
    pageStatus: computed(() => asyncData.data.value?.pageStatus ?? null),
    async execute() {
      if (!started.value) started.value = true
      await asyncData.execute().then(
        () => {},
        () => {},
      )
    },
    loadMore: () => {},
    error,
    async refresh() {
      if (!started.value) started.value = true
      await asyncData.refresh().then(
        () => {},
        () => {},
      )
    },
    reset(cursor: string | null = null) {
      if (typeof cursor !== 'string' && cursor !== null) {
        throw new Error('[better-convex-nuxt] reset cursor must be a string or null')
      }
      startCursor.value = cursor
      void asyncData.execute()
    },
  })
  return {
    resultData,
    resolvePromise:
      !lazy && immediate && server && gate.value.outcome !== 'idle'
        ? Promise.resolve(asyncData).then(() => {})
        : Promise.resolve(),
  }
}

export function createConvexPaginatedQueryState<Query extends PaginatedQueryReference>(
  query: Query,
  args: MaybeRefOrGetter<PaginatedQueryArgs<Query> | 'skip'>,
  options: UseNuxtConvexPaginatedQueryOptions,
  resolveImmediately = false,
): BuildConvexPaginatedQueryResult<PaginatedQueryItem<Query>> {
  const initialNumItems = options.initialNumItems
  if (!Number.isSafeInteger(initialNumItems) || initialNumItems < 1) {
    throw new Error('[better-convex-nuxt] initialNumItems must be a positive safe integer')
  }
  const { immediate, lazy } = resolveQueryLifecycleOptions(options)
  const resolvedOptions: ResolvedNuxtConvexPaginatedQueryOptions = {
    auth: options.auth ?? 'optional',
    immediate,
    initialCursor: options.initialCursor ?? null,
    initialNumItems,
    keepPreviousData: options.keepPreviousData,
    lazy,
    server: options.server ?? true,
  }

  return import.meta.client
    ? createClientConvexPaginatedQueryState(query, args, resolvedOptions, resolveImmediately)
    : createServerConvexPaginatedQueryState(
        query,
        args,
        resolvedOptions,
        resolveImmediately,
        getConvexRuntimeConfig().url,
      )
}

export function useConvexPaginatedQuery<Query extends PaginatedQueryReference>(
  query: Query,
  args: MaybeRefOrGetter<PaginatedQueryArgs<Query> | 'skip'>,
  options: UseNuxtConvexPaginatedQueryOptions,
): NuxtConvexPaginatedQuery<PaginatedQueryItem<Query>> {
  const result = createConvexPaginatedQueryState(query, args, options)
  return createNuxtAwaitableState(result.resultData, result.resolvePromise)
}
