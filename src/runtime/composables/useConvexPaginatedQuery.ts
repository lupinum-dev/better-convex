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

export type {
  PaginatedQueryArgs,
  PaginatedQueryItem,
  PaginatedQueryReference,
  UseConvexPaginatedQueryState,
}

export interface UseNuxtConvexPaginatedQueryOptions extends UseConvexPaginatedQueryOptions {
  readonly server?: boolean
}

export type NuxtConvexPaginatedQuery<Item> = UseConvexPaginatedQueryState<Item> &
  Promise<UseConvexPaginatedQueryState<Item>>

interface BuildConvexPaginatedQueryResult<Item> {
  resultData: UseConvexPaginatedQueryState<Item>
  resolvePromise: Promise<void>
}

function asNativeNuxtPromise<Item>(
  state: UseConvexPaginatedQueryState<Item>,
  resolvePromise: Promise<void>,
): NuxtConvexPaginatedQuery<Item> {
  const awaitedState = Object.freeze({ ...state }) as UseConvexPaginatedQueryState<Item>
  const promise = resolvePromise.then(
    () => awaitedState,
    () => awaitedState,
  )

  void Object.assign(promise, state)
  void Object.defineProperties(promise, {
    then: { enumerable: true, value: promise.then.bind(promise) },
    catch: { enumerable: true, value: promise.catch.bind(promise) },
    finally: { enumerable: true, value: promise.finally.bind(promise) },
  })
  return promise as NuxtConvexPaginatedQuery<Item>
}

export function createConvexPaginatedQueryState<Query extends PaginatedQueryReference>(
  query: Query,
  args: MaybeRefOrGetter<PaginatedQueryArgs<Query> | 'skip'>,
  options: UseNuxtConvexPaginatedQueryOptions,
  resolveImmediately = false,
): BuildConvexPaginatedQueryResult<PaginatedQueryItem<Query>> {
  type Item = PaginatedQueryItem<Query>
  const config = getConvexRuntimeConfig()
  const initialNumItems = options.initialNumItems
  if (!Number.isSafeInteger(initialNumItems) || initialNumItems < 1) {
    throw new Error('[better-convex-nuxt] initialNumItems must be a positive safe integer')
  }
  const server = options.server ?? true
  const auth = options.auth ?? 'optional'

  if (import.meta.client) {
    const authContext = createConvexQueryAuthContext()
    const currentBoundary = computed(() => {
      const currentArgs = normalizeConvexReactiveArgs(toValue(args)) as
        | PaginatedQueryArgs<Query>
        | 'skip'
      const gate = createQueryExecutionGate({
        authStatus: authContext.status.value,
        authMode: auth,
        identityKey: authContext.identityKey.value,
        skipped: currentArgs === 'skip',
      })
      const key =
        gate.outcome === 'execute'
          ? withAuthDimension(
              createConvexQueryKey(
                query,
                {
                  ...(currentArgs as PaginatedQueryArgs<Query>),
                  paginationOpts: { numItems: initialNumItems, cursor: null },
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
      { initialNumItems, auth, keepPreviousData: options.keepPreviousData },
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
    const isLoading = computed(() => status.value === 'pending')
    const resultData: UseConvexPaginatedQueryState<Item> = Object.freeze({
      ...result,
      error,
      status,
      isLoading,
    })
    return {
      resultData,
      resolvePromise:
        resolveImmediately ||
        !server ||
        hasHydratedPage ||
        error.value !== undefined ||
        status.value === 'idle'
          ? Promise.resolve()
          : firstPageSettled,
    }
  }

  const authContext = createConvexQueryAuthContext()
  const currentArgs = computed(
    () => normalizeConvexReactiveArgs(toValue(args)) as PaginatedQueryArgs<Query> | 'skip',
  )
  const gate = computed(() =>
    createQueryExecutionGate({
      authStatus: authContext.status.value,
      authMode: auth,
      identityKey: authContext.identityKey.value,
      skipped: currentArgs.value === 'skip',
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
    isLoading: computed(() => status.value === 'pending'),
    isStale: computed(() => false),
    canLoadMore: computed(
      () => status.value === 'success' && asyncData.data.value?.isDone === false,
    ),
    loadMore: () => {},
    error,
    refresh: asyncData.refresh,
  })
  return {
    resultData,
    resolvePromise:
      server && gate.value.outcome !== 'idle'
        ? Promise.resolve(asyncData).then(() => {})
        : Promise.resolve(),
  }
}

export function useConvexPaginatedQuery<Query extends PaginatedQueryReference>(
  query: Query,
  args: MaybeRefOrGetter<PaginatedQueryArgs<Query> | 'skip'>,
  options: UseNuxtConvexPaginatedQueryOptions,
): NuxtConvexPaginatedQuery<PaginatedQueryItem<Query>> {
  const result = createConvexPaginatedQueryState(query, args, options)
  return asNativeNuxtPromise(result.resultData, result.resolvePromise)
}
