import type {
  ConvexAuthMode,
  ConvexQueryBlockedBy,
  UseConvexQueryOptions,
  UseConvexQueryParameters,
  UseConvexQueryState,
} from '@lupinum/better-convex-vue'
import {
  createConvexArgsState,
  createSettlementWaiters,
  useConvexQueryInternal,
  type ConvexArgsState,
} from '@lupinum/better-convex-vue/internal'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { computed, onScopeDispose, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'

import { useNuxtApp } from '#imports'

import type { ConvexCallError } from '../errors'
import { readConvexRuntimeContext } from '../runtime-context'
import { executeQueryHttp } from '../utils/query-execution'
import {
  useConvexQueryHydration,
  useConvexQueryIdentity,
  useConvexSsrQuery,
  type ConvexQueryBoundaryInput,
} from '../utils/query-foundation'
import { convexQueryAsyncDataKey, resolveConvexQueryGate } from '../utils/query-ssr'
import type { ConvexCallStatus } from '../utils/types'
import { createNuxtAwaitableState } from './nuxt-awaitable-state'
import { resolveQueryLifecycleOptions } from './query-lifecycle-options'

export type { ConvexAuthMode, ConvexCallStatus, ConvexQueryBlockedBy }
export type ConvexQuerySkip = 'skip'
export type ConvexQueryArgs<Args> = Args | ConvexQuerySkip

interface UseNuxtConvexQueryBaseOptions extends Omit<UseConvexQueryOptions, 'immediate'> {
  /** Disable the SSR fetch for a genuinely browser-only query. */
  readonly server?: boolean
}

/** `lazy` starts normally, so it is deliberately incompatible with a deferred query. */
export type UseNuxtConvexQueryOptions = UseNuxtConvexQueryBaseOptions &
  (
    | { readonly immediate?: true; readonly lazy?: boolean }
    | { readonly immediate: false; readonly lazy?: false }
  )

export type { UseConvexQueryOptions, UseConvexQueryParameters, UseConvexQueryState }

export type NuxtConvexQuery<Data> = UseConvexQueryState<Data> & Promise<UseConvexQueryState<Data>>

interface BuildConvexQueryResult<DataT> {
  resultData: UseConvexQueryState<DataT>
  resolvePromise: Promise<void>
}

interface ResolvedNuxtConvexQueryOptions {
  readonly auth: ConvexAuthMode
  readonly immediate: boolean
  readonly keepPreviousData: UseConvexQueryOptions['keepPreviousData']
  readonly lazy: boolean
  readonly server: boolean
}

function queryBoundary(
  query: FunctionReference<'query'>,
  args: ConvexArgsState<unknown>,
  options: ResolvedNuxtConvexQueryOptions,
): ConvexQueryBoundaryInput {
  return {
    namespace: 'convex',
    functionName: getFunctionName(query),
    auth: options.auth,
    server: options.server,
    immediate: options.immediate,
    args,
    keyHash: () => args.hash.value,
  }
}

/** DevTools registration, only for a development build with a live sink. */
function trackQueryDevtools(
  boundary: ConvexQueryBoundaryInput,
  options: ResolvedNuxtConvexQueryOptions,
  state: {
    status: ComputedRef<ConvexCallStatus>
    data: ComputedRef<unknown>
    error: ComputedRef<ConvexCallError | undefined>
  },
): void {
  const sink = readConvexRuntimeContext(useNuxtApp())?.getDevtoolsSink()
  if (!sink) return
  const identity = useConvexQueryIdentity()
  const logicalKey = computed(() =>
    convexQueryAsyncDataKey(
      boundary.namespace,
      boundary.functionName,
      boundary.keyHash(),
      boundary.auth,
      resolveConvexQueryGate({
        auth: boundary.auth,
        started: boundary.immediate,
        skipped: boundary.args.args.value === 'skip',
        identity: identity.value,
      }),
    ),
  )
  const id = sink.registerQuery({
    logicalKey: logicalKey.value,
    name: boundary.functionName,
    args: boundary.args.args.value,
    status: state.status.value,
    data: state.data.value,
    error: state.error.value?.message,
    options: {
      immediate: options.immediate,
      lazy: options.lazy,
      server: options.server,
      subscribe: true,
      auth: options.auth,
    },
  })
  if (!id) return
  watch(
    [logicalKey, boundary.args.args, state.status, state.data, state.error],
    ([key, args, status, data, error]) => {
      sink.updateQuery(id, { logicalKey: key, args, status, data, error: error?.message })
    },
  )
  onScopeDispose(() => sink.removeQuery(id))
}

function createClientConvexQueryState<Query extends FunctionReference<'query'>>(
  query: Query,
  args: ConvexArgsState<FunctionArgs<Query>>,
  options: ResolvedNuxtConvexQueryOptions,
): BuildConvexQueryResult<FunctionReturnType<Query>> {
  type RawT = FunctionReturnType<Query>
  const { auth, immediate, keepPreviousData, lazy, server } = options
  const boundary = queryBoundary(query, args, options)
  const hydration = useConvexQueryHydration<RawT>(boundary)
  const result = useConvexQueryInternal({
    query,
    args,
    options: { auth, keepPreviousData, immediate: immediate && !hydration.defersLiveStart },
    hydrationSeed: hydration.seed,
  })
  if (hydration.defersLiveStart) hydration.startLive(result)

  const view = hydration.view
  const error = computed(() =>
    view.value ? view.value.error : (result.error.value ?? hydration.error.value),
  )
  const status = computed<ConvexCallStatus>(
    () => view.value?.status ?? (error.value ? 'error' : result.status.value),
  )
  const pending = computed(() => status.value === 'pending')
  const data = computed(() => (view.value ? view.value.value : result.data.value))
  // While hydrating, the gate is the server's: the browser identity may still settle.
  const blockedBy = computed(() => (view.value ? view.value.blockedBy : result.blockedBy.value))
  if (import.meta.dev) trackQueryDevtools(boundary, options, { status, data, error })

  const resultData = Object.freeze({ ...result, data, error, pending, status, blockedBy })
  // A hydrating render never waits: the live lifecycle starts only after hydration.
  if (lazy || !immediate || !server || hydration.defersLiveStart || status.value !== 'pending') {
    return { resultData, resolvePromise: Promise.resolve() }
  }
  const settlement = createSettlementWaiters()
  onScopeDispose(settlement.dispose)
  return { resultData, resolvePromise: settlement.until(() => status.value !== 'pending') }
}

function createServerConvexQueryState<Query extends FunctionReference<'query'>>(
  query: Query,
  args: ConvexArgsState<FunctionArgs<Query>>,
  options: ResolvedNuxtConvexQueryOptions,
): BuildConvexQueryResult<FunctionReturnType<Query>> {
  type RawT = FunctionReturnType<Query>
  const boundary = queryBoundary(query, args, options)
  const ssr = useConvexSsrQuery<RawT>({
    ...boundary,
    lazy: options.lazy,
    fetch: (convexUrl, token, signal, bounds) =>
      executeQueryHttp<RawT>(
        convexUrl,
        boundary.functionName,
        args.args.value as FunctionArgs<Query>,
        token,
        signal,
        bounds,
      ),
  })
  const status = computed(() => ssr.view.value.status)
  return {
    resultData: Object.freeze({
      data: computed(() => ssr.view.value.value),
      error: computed(() => ssr.view.value.error),
      pending: computed(() => status.value === 'pending'),
      status,
      isStale: computed(() => false),
      blockedBy: computed(() => ssr.view.value.blockedBy),
      execute: ssr.execute,
      refresh: ssr.refresh,
    }),
    resolvePromise: ssr.settled,
  }
}

export function createConvexQueryState<
  Query extends FunctionReference<'query'>,
  Args extends ConvexQueryArgs<FunctionArgs<Query>> = FunctionArgs<Query>,
>(
  query: Query,
  args: MaybeRefOrGetter<Args>,
  options?: UseNuxtConvexQueryOptions,
): BuildConvexQueryResult<FunctionReturnType<Query>> {
  const { immediate, lazy } = resolveQueryLifecycleOptions(options)
  const resolvedOptions: ResolvedNuxtConvexQueryOptions = {
    auth: options?.auth ?? 'optional',
    immediate,
    keepPreviousData: options?.keepPreviousData,
    lazy,
    server: options?.server ?? true,
  }
  const argsState = createConvexArgsState<FunctionArgs<Query>>(
    args as MaybeRefOrGetter<ConvexQueryArgs<FunctionArgs<Query>>>,
  )

  return import.meta.client
    ? createClientConvexQueryState(query, argsState, resolvedOptions)
    : createServerConvexQueryState(query, argsState, resolvedOptions)
}

export function useConvexQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  ...parameters: UseConvexQueryParameters<Query, UseNuxtConvexQueryOptions>
): NuxtConvexQuery<FunctionReturnType<Query>> {
  const [providedArgs, options] = parameters
  const args = (parameters.length === 0 ? {} : providedArgs) as MaybeRefOrGetter<
    ConvexQueryArgs<FunctionArgs<Query>>
  >
  const result = createConvexQueryState(query, args, options)
  return createNuxtAwaitableState(result.resultData, result.resolvePromise)
}
