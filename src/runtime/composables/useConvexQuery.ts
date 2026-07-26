import { useConvexQuery as useVueConvexQuery, type ConvexAuthMode } from 'better-convex-vue'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import {
  computed,
  effectScope,
  onScopeDispose,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
} from 'vue'

import { useAsyncData, useNuxtApp, useRequestEvent, useState } from '#imports'

import { identityToken } from '../auth/auth-identity'
import { ConvexCallError, normalizeConvexError } from '../errors'
import { readConvexRuntimeContext } from '../runtime-context'
import type { ConvexQueryRest } from '../utils/args-tuple'
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

export type { ConvexAuthMode, ConvexCallStatus }
export type ConvexQuerySkip = 'skip'
export type ConvexQueryArgs<Args> = Args | ConvexQuerySkip

export interface UseConvexQueryOptions<RawT, DataT = RawT> {
  server?: boolean
  subscribe?: boolean
  initialData?: RawT | (() => RawT | undefined)
  transform?: (input: RawT) => DataT
  keepPreviousData?: boolean
  auth?: ConvexAuthMode
}

export interface UseConvexQueryData<DataT> {
  data: ComputedRef<DataT | null>
  error: ComputedRef<ConvexCallError | null>
  refresh: () => Promise<void>
  clear: () => void
  pending: ComputedRef<boolean>
  status: ComputedRef<ConvexCallStatus>
  isStale: ComputedRef<boolean>
}

interface BuildConvexQueryResult<DataT> {
  resultData: UseConvexQueryData<DataT>
  resolvePromise: Promise<void>
}

interface SsrQueryPayload<T> {
  value: T
}

function waitForClientTerminal(status: ComputedRef<string>, timeoutMs: number): Promise<void> {
  if (status.value !== 'pending') return Promise.resolve()
  return new Promise<void>((resolve) => {
    const scope = effectScope(true)
    let timer: ReturnType<typeof setTimeout> | null = null
    const stop = scope.run(() =>
      watch(
        status,
        (value) => {
          if (value === 'pending') return
          if (timer) clearTimeout(timer)
          scope.stop()
          resolve()
        },
        { flush: 'sync' },
      ),
    )!
    if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        stop()
        scope.stop()
        resolve()
      }, timeoutMs)
    }
  })
}

export function createConvexQueryState<
  Query extends FunctionReference<'query'>,
  Args extends ConvexQueryArgs<FunctionArgs<Query>> = FunctionArgs<Query>,
  DataT = FunctionReturnType<Query>,
>(
  query: Query,
  args?: MaybeRefOrGetter<Args>,
  options?: UseConvexQueryOptions<FunctionReturnType<Query>, DataT>,
  resolveImmediately = false,
): BuildConvexQueryResult<DataT> {
  type RawT = FunctionReturnType<Query>
  const config = getConvexRuntimeConfig()
  const server = options?.server ?? config.defaults.server
  const subscribe = options?.subscribe ?? config.defaults.subscribe
  const auth = options?.auth ?? 'optional'

  if (import.meta.client) {
    const authContext = createConvexQueryAuthContext(useNuxtApp())
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
            createConvexQueryKey(query, hydratedArgs as FunctionArgs<Query>),
            auth,
            hydrationGate.cacheIdentity,
          )
        : `convex:${hydrationGate.outcome}:${getFunctionName(query)}`
    const nuxtApp = useNuxtApp()
    const runtime = readConvexRuntimeContext(nuxtApp)
    const hydrationIdentityMatches =
      hydrationGate.outcome === 'execute' &&
      matchesConvexHydrationIdentity(
        auth,
        hydrationGate.cacheIdentity,
        runtime?.attachment.identity.snapshot(),
      )
    const hasHydratedData =
      hydrationIdentityMatches && Object.hasOwn(nuxtApp.payload.data, hydrationKey)
    const hydratedPayload = nuxtApp.payload.data[hydrationKey] as
      | SsrQueryPayload<RawT>
      | null
      | undefined
    const hydrated = hydratedPayload?.value
    const hydratedErrors = useState<Record<string, ConvexCallError | null>>(
      'convex:query-errors',
      () => ({}),
    )
    const result = useVueConvexQuery<Query, DataT>(query, args, {
      auth,
      subscribe,
      initialData: hasHydratedData ? hydrated : options?.initialData,
      transform: options?.transform,
      keepPreviousData: options?.keepPreviousData,
    })
    const clearHydratedError = () => {
      if (!(hydrationKey in hydratedErrors.value)) return
      const { [hydrationKey]: _removed, ...rest } = hydratedErrors.value
      hydratedErrors.value = rest
    }
    const stopHydratedErrorReconciliation = watch(
      [result.error, result.pending],
      ([error, pending]) => {
        if (error || !pending) clearHydratedError()
      },
      { flush: 'sync' },
    )
    const error = computed(
      () =>
        result.error.value ??
        (hydrationIdentityMatches ? hydratedErrors.value[hydrationKey] : null) ??
        null,
    )
    const pending = computed(() => (error.value ? false : result.pending.value))
    const status = computed<ConvexCallStatus>(() =>
      error.value ? 'error' : (result.status.value as ConvexCallStatus),
    )
    const stopDevtools = watch(
      [status, result.data, error],
      ([currentStatus, data, currentError]) => {
        runtime?.getDevtoolsSink()?.upsertQuery({
          id: hydrationKey,
          name: getFunctionName(query),
          args: normalizeConvexReactiveArgs(toValue(args)),
          status: currentStatus,
          data,
          error: currentError?.message,
          options: { immediate: true, server, subscribe, auth },
        })
      },
      { immediate: true },
    )
    onScopeDispose(() => {
      stopHydratedErrorReconciliation()
      stopDevtools()
      runtime?.getDevtoolsSink()?.removeQuery(hydrationKey)
    })
    return {
      resultData: {
        ...result,
        error,
        pending,
        status,
        clear() {
          clearHydratedError()
          result.clear()
        },
      },
      resolvePromise:
        resolveImmediately || hasHydratedData || error.value
          ? Promise.resolve()
          : waitForClientTerminal(status, config.defaults.waitTimeoutMs),
    }
  }

  const authContext = createConvexQueryAuthContext(null)
  const currentArgs = computed(() => normalizeConvexReactiveArgs(toValue(args)) as Args)
  const skipped = computed(() => currentArgs.value === 'skip')
  const gate = computed(() =>
    createQueryExecutionGate({
      authStatus: authContext.status.value,
      authMode: auth,
      identityKey: authContext.identityKey.value,
      skipped: skipped.value,
      subscribe: false,
    }),
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
  const errors = useState<Record<string, ConvexCallError | null>>('convex:query-errors', () => ({}))
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
      const convexUrl = config.url
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
      lazy: resolveImmediately,
      deep: false,
      default: () => {
        const initial = options?.initialData
        const value =
          typeof initial === 'function' ? (initial as () => RawT | undefined)() : initial
        return value === undefined ? null : { value }
      },
    },
  )
  const error = computed(() => errors.value[key.value] ?? null)
  const pending = computed(() =>
    computeConvexQueryPending({
      isSkipped: gate.value.outcome === 'idle',
      hasData: asyncData.data.value !== null,
      hasSettled: asyncData.status.value === 'success' || asyncData.status.value === 'error',
      server,
      resolveImmediately,
      isServer: true,
      isClient: false,
      asyncDataPending: asyncData.pending.value,
      isAuthPending: gate.value.outcome === 'wait',
    }),
  )
  const data = computed<DataT | null>(() => {
    const payload = asyncData.data.value
    if (payload === null) return null
    const value = payload.value
    return options?.transform ? options.transform(value) : (value as unknown as DataT)
  })
  const status = computed<ConvexCallStatus>(() =>
    computeQueryStatus(
      gate.value.outcome === 'idle',
      error.value !== null,
      pending.value,
      data.value !== null,
    ),
  )
  return {
    resultData: {
      data,
      error,
      pending,
      status,
      isStale: computed(() => false),
      refresh: asyncData.refresh,
      clear: asyncData.clear,
    },
    resolvePromise:
      gate.value.outcome === 'idle' || !server ? Promise.resolve() : asyncData.then(() => {}),
  }
}

export async function useConvexQuery<
  Query extends FunctionReference<'query'>,
  Args extends ConvexQueryArgs<FunctionArgs<Query>> = FunctionArgs<Query>,
  DataT = FunctionReturnType<Query>,
>(
  query: Query,
  ...rest: ConvexQueryRest<
    FunctionArgs<Query>,
    MaybeRefOrGetter<ConvexQueryArgs<NoInfer<Args>>>,
    UseConvexQueryOptions<FunctionReturnType<Query>, DataT>
  >
): Promise<UseConvexQueryData<DataT>> {
  const [args, options] = rest
  const result = createConvexQueryState(query, args as MaybeRefOrGetter<Args> | undefined, options)
  await result.resolvePromise
  return result.resultData
}
