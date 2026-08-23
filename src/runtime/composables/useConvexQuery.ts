import {
  useConvexQuery as useVueConvexQuery,
  type ConvexAuthMode,
  type UseConvexQueryOptions,
  type UseConvexQueryParameters,
  type UseConvexQueryState,
} from '@lupinum/better-convex-vue'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import {
  computed,
  onMounted,
  onScopeDispose,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
} from 'vue'

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
import { computeQueryStatus, createConvexQueryKey, getFunctionName } from '../utils/convex-shared'
import { executeQueryHttp } from '../utils/query-execution'
import { createQueryExecutionGate } from '../utils/query-execution-gate'
import { createConvexQueryAuthContext } from '../utils/query-foundation'
import { computeConvexQueryPending } from '../utils/query-state'
import { normalizeConvexReactiveArgs } from '../utils/reactive-args'
import { getConvexRuntimeConfig } from '../utils/runtime-config'
import type { ConvexCallStatus } from '../utils/types'
import { createNuxtAwaitableState } from './nuxt-awaitable-state'
import { resolveQueryLifecycleOptions } from './query-lifecycle-options'

export type { ConvexAuthMode, ConvexCallStatus }
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

interface SsrQueryPayload<T> {
  value: T
}

interface ResolvedNuxtConvexQueryOptions {
  readonly auth: ConvexAuthMode
  readonly immediate: boolean
  readonly keepPreviousData: UseConvexQueryOptions['keepPreviousData']
  readonly lazy: boolean
  readonly server: boolean
}

function waitForClientTerminal(status: ComputedRef<string>): Promise<void> {
  if (status.value !== 'pending') return Promise.resolve()
  return new Promise<void>((resolve) => {
    let settled = false
    let stop = () => {}
    const finish = () => {
      if (settled) return
      settled = true
      stop()
      resolve()
    }
    stop = watch(
      status,
      (value) => {
        if (value === 'pending') return
        finish()
      },
      { flush: 'sync' },
    )
    onScopeDispose(finish)
  })
}

function createClientConvexQueryState<
  Query extends FunctionReference<'query'>,
  Args extends ConvexQueryArgs<FunctionArgs<Query>> = FunctionArgs<Query>,
>(
  query: Query,
  args: MaybeRefOrGetter<Args>,
  options: ResolvedNuxtConvexQueryOptions,
): BuildConvexQueryResult<FunctionReturnType<Query>> {
  type RawT = FunctionReturnType<Query>
  const { auth, immediate, keepPreviousData, lazy, server } = options
  const authContext = createConvexQueryAuthContext()
  const currentBoundary = computed(() => {
    const currentArgs = normalizeConvexReactiveArgs(toValue(args)) as Args
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
            createConvexQueryKey(query, currentArgs as FunctionArgs<Query>),
            auth,
            gate.cacheIdentity,
          )
        : `convex:${gate.outcome}:${getFunctionName(query)}`
    return { args: currentArgs, gate, key }
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
  const hydratedPayload = nuxtApp.payload.data[hydrationKey] as
    | SsrQueryPayload<RawT>
    | null
    | undefined
  const hasHydratedData =
    hydrationIdentityMatches &&
    hydratedPayload !== null &&
    hydratedPayload !== undefined &&
    Object.hasOwn(hydratedPayload, 'value')
  const hydratedErrors = useState<Record<string, ConvexCallError | undefined>>(
    'convex:query-errors',
    () => ({}),
  )
  const startsAfterHydration =
    immediate &&
    nuxtApp.isHydrating &&
    !hasHydratedData &&
    hydratedErrors.value[hydrationKey] === undefined
  const result = Reflect.apply(useVueConvexQuery, undefined, [
    query,
    args,
    { auth, keepPreviousData, immediate: immediate && !startsAfterHydration },
    hasHydratedData ? { value: hydratedPayload.value } : undefined,
  ]) as UseConvexQueryState<RawT>
  if (startsAfterHydration) {
    onMounted(() => {
      void result.execute()
    })
  }
  const clearHydratedError = () => {
    if (!(hydrationKey in hydratedErrors.value)) return
    const { [hydrationKey]: _removed, ...rest } = hydratedErrors.value
    hydratedErrors.value = rest
  }
  const stopHydratedErrorReconciliation = watch(
    [result.error, result.pending, hydrationBoundaryMatches],
    ([error, pending, boundaryMatches]) => {
      if (boundaryMatches && (error || !pending)) clearHydratedError()
    },
    { flush: 'sync' },
  )
  const error = computed(
    () =>
      result.error.value ??
      (hydrationBoundaryMatches.value ? hydratedErrors.value[hydrationKey] : undefined),
  )
  const pending = computed(() => (error.value ? false : result.pending.value))
  const status = computed<ConvexCallStatus>(() =>
    error.value ? 'error' : (result.status.value as ConvexCallStatus),
  )
  const devtoolsSink = runtime?.getDevtoolsSink()
  const devtoolsQueryId = devtoolsSink?.registerQuery({
    logicalKey: hydrationKey,
    name: getFunctionName(query),
    args: currentBoundary.value.args,
    status: status.value,
    data: result.data.value,
    error: error.value?.message,
    options: { immediate, lazy, server, subscribe: true, auth },
  })
  const stopDevtools = watch(
    [currentBoundary, status, result.data, error],
    ([boundary, currentStatus, data, currentError]) => {
      if (!devtoolsSink || !devtoolsQueryId) return
      devtoolsSink.updateQuery(devtoolsQueryId, {
        logicalKey: boundary.key,
        args: boundary.args,
        status: currentStatus,
        data,
        error: currentError?.message,
      })
    },
  )
  onScopeDispose(() => {
    stopHydrationBoundaryRetirement()
    stopHydratedErrorReconciliation()
    stopDevtools()
    if (devtoolsQueryId) devtoolsSink?.removeQuery(devtoolsQueryId)
  })
  return {
    resultData: Object.freeze({
      ...result,
      error,
      pending,
      status,
    }),
    resolvePromise:
      lazy || !immediate || !server || hasHydratedData || error.value || status.value !== 'pending'
        ? Promise.resolve()
        : waitForClientTerminal(status),
  }
}

function createServerConvexQueryState<
  Query extends FunctionReference<'query'>,
  Args extends ConvexQueryArgs<FunctionArgs<Query>> = FunctionArgs<Query>,
>(
  query: Query,
  args: MaybeRefOrGetter<Args>,
  options: ResolvedNuxtConvexQueryOptions,
  convexUrl: string | undefined,
): BuildConvexQueryResult<FunctionReturnType<Query>> {
  type RawT = FunctionReturnType<Query>
  const { auth, immediate, lazy, server } = options
  const authContext = createConvexQueryAuthContext()
  const started = ref(immediate)
  const currentArgs = computed(() => normalizeConvexReactiveArgs(toValue(args)) as Args)
  const skipped = computed(() => currentArgs.value === 'skip')
  const gate = computed(() =>
    started.value
      ? createQueryExecutionGate({
          authStatus: authContext.status.value,
          authMode: auth,
          identityKey: authContext.identityKey.value,
          skipped: skipped.value,
        })
      : ({ outcome: 'idle', cacheIdentity: 'anonymous' } as const),
  )
  const key = computed(() => {
    if (gate.value.outcome !== 'execute') {
      return `convex:${gate.value.outcome}:${getFunctionName(query)}`
    }
    return withAuthDimension(
      createConvexQueryKey(query, currentArgs.value as FunctionArgs<Query>),
      auth,
      gate.value.cacheIdentity,
    )
  })
  const errors = useState<Record<string, ConvexCallError | undefined>>(
    'convex:query-errors',
    () => ({}),
  )
  const event = useRequestEvent()
  const identity = useConvexIdentityState()
  const cachedToken = computed(() => identityToken(identity.value))
  const asyncData = useAsyncData<SsrQueryPayload<RawT> | null>(
    key,
    async () => {
      const decision = gate.value
      if (decision.outcome !== 'execute') {
        if (decision.outcome === 'error') {
          errors.value = {
            ...errors.value,
            [key.value]:
              authContext.error.value ??
              new ConvexCallError({
                kind: 'authentication',
                message: 'Authentication error',
              }),
          }
        }
        return null
      }
      if (!convexUrl) return null
      try {
        const token = fetchAuthToken({
          auth,
          cookieHeader: event?.headers.get('cookie') ?? '',
          cachedToken,
        })
        if (auth !== 'none' && decision.cacheIdentity !== 'anonymous' && !token) return null
        const value = await executeQueryHttp<RawT>(
          convexUrl,
          getFunctionName(query),
          currentArgs.value as FunctionArgs<Query>,
          token,
          event?.web?.request?.signal,
        )
        const { [key.value]: _removed, ...rest } = errors.value
        errors.value = rest
        return { value }
      } catch (error) {
        errors.value = {
          ...errors.value,
          [key.value]: normalizeConvexError(error),
        }
        return null
      }
    },
    {
      server,
      immediate,
      lazy,
      deep: false,
      default: () => null,
    },
  )
  const error = computed(() => errors.value[key.value])
  const pending = computed(() =>
    computeConvexQueryPending({
      isSkipped: gate.value.outcome === 'idle',
      hasData: asyncData.data.value !== null,
      hasSettled: asyncData.status.value === 'success' || asyncData.status.value === 'error',
      server,
      resolveImmediately: false,
      isServer: true,
      isClient: false,
      asyncDataPending: asyncData.pending.value,
      isAuthPending: gate.value.outcome === 'wait',
    }),
  )
  const data = computed<RawT | undefined>(() => {
    const payload = asyncData.data.value
    return payload === null ? undefined : payload.value
  })
  const status = computed<ConvexCallStatus>(() =>
    computeQueryStatus(
      gate.value.outcome === 'idle',
      error.value !== undefined,
      pending.value,
      data.value !== undefined,
    ),
  )
  return {
    resultData: Object.freeze({
      data,
      error,
      pending,
      status,
      isStale: computed(() => false),
      async execute() {
        if (!started.value) started.value = true
        await asyncData.execute().then(
          () => {},
          () => {},
        )
      },
      async refresh() {
        if (!started.value) started.value = true
        await asyncData.refresh().then(
          () => {},
          () => {},
        )
      },
    }),
    resolvePromise:
      lazy || !immediate || gate.value.outcome === 'idle' || !server
        ? Promise.resolve()
        : asyncData.then(
            () => {},
            () => {},
          ),
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

  return import.meta.client
    ? createClientConvexQueryState(query, args, resolvedOptions)
    : createServerConvexQueryState(query, args, resolvedOptions, getConvexRuntimeConfig().url)
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
