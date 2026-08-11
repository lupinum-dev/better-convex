import {
  useConvexQuery as useVueConvexQuery,
  type ConvexAuthMode,
  type UseConvexQueryOptions,
  type UseConvexQueryParameters,
  type UseConvexQueryState,
} from 'better-convex-vue'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import {
  computed,
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

export type { ConvexAuthMode, ConvexCallStatus }
export type ConvexQuerySkip = 'skip'
export type ConvexQueryArgs<Args> = Args | ConvexQuerySkip

export interface UseNuxtConvexQueryOptions extends UseConvexQueryOptions {
  /** Disable the SSR fetch for a genuinely browser-only query. */
  readonly server?: boolean
}

export type { UseConvexQueryOptions, UseConvexQueryParameters, UseConvexQueryState }

export type NuxtConvexQuery<Data> = UseConvexQueryState<Data> & Promise<UseConvexQueryState<Data>>

interface BuildConvexQueryResult<DataT> {
  resultData: UseConvexQueryState<DataT>
  resolvePromise: Promise<void>
}

interface SsrQueryPayload<T> {
  value: T
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

function asNuxtConvexQuery<Data>(
  state: UseConvexQueryState<Data>,
  initialSettlement: Promise<void>,
): NuxtConvexQuery<Data> {
  const awaitedState = Object.freeze({ ...state }) as UseConvexQueryState<Data>
  const promise = initialSettlement.then(
    () => awaitedState,
    () => awaitedState,
  )

  void Object.assign(promise, state)
  void Object.defineProperties(promise, {
    then: { enumerable: true, value: promise.then.bind(promise) },
    catch: { enumerable: true, value: promise.catch.bind(promise) },
    finally: { enumerable: true, value: promise.finally.bind(promise) },
  })
  return promise as NuxtConvexQuery<Data>
}

export function createConvexQueryState<
  Query extends FunctionReference<'query'>,
  Args extends ConvexQueryArgs<FunctionArgs<Query>> = FunctionArgs<Query>,
>(
  query: Query,
  args: MaybeRefOrGetter<Args>,
  options?: UseNuxtConvexQueryOptions,
): BuildConvexQueryResult<FunctionReturnType<Query>> {
  type RawT = FunctionReturnType<Query>
  const config = getConvexRuntimeConfig()
  const server = options?.server ?? true
  const auth = options?.auth ?? 'optional'

  if (import.meta.client) {
    const authContext = createConvexQueryAuthContext()
    const currentBoundary = computed(() => {
      const currentArgs = normalizeConvexReactiveArgs(toValue(args)) as Args
      const gate = createQueryExecutionGate({
        authStatus: authContext.status.value,
        authMode: auth,
        identityKey: authContext.identityKey.value,
        skipped: currentArgs === 'skip',
      })
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
    const result = Reflect.apply(useVueConvexQuery, undefined, [
      query,
      args,
      { auth, keepPreviousData: options?.keepPreviousData },
      hasHydratedData ? { value: hydratedPayload.value } : undefined,
    ]) as UseConvexQueryState<RawT>
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
    const stopDevtools = watch(
      [status, result.data, error],
      ([currentStatus, data, currentError]) => {
        runtime?.getDevtoolsSink()?.upsertQuery({
          id: hydrationKey,
          name: getFunctionName(query),
          args: currentBoundary.value.args,
          status: currentStatus,
          data,
          error: currentError?.message,
          options: { immediate: true, server, subscribe: true, auth },
        })
      },
      { immediate: true },
    )
    onScopeDispose(() => {
      stopHydrationBoundaryRetirement()
      stopHydratedErrorReconciliation()
      stopDevtools()
      runtime?.getDevtoolsSink()?.removeQuery(hydrationKey)
    })
    return {
      resultData: Object.freeze({
        ...result,
        error,
        pending,
        status,
      }),
      resolvePromise:
        !server || hasHydratedData || error.value || status.value !== 'pending'
          ? Promise.resolve()
          : waitForClientTerminal(status),
    }
  }

  const authContext = createConvexQueryAuthContext()
  const currentArgs = computed(() => normalizeConvexReactiveArgs(toValue(args)) as Args)
  const skipped = computed(() => currentArgs.value === 'skip')
  const gate = computed(() =>
    createQueryExecutionGate({
      authStatus: authContext.status.value,
      authMode: auth,
      identityKey: authContext.identityKey.value,
      skipped: skipped.value,
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
      async refresh() {
        await asyncData.refresh().then(
          () => {},
          () => {},
        )
      },
    }),
    resolvePromise:
      gate.value.outcome === 'idle' || !server
        ? Promise.resolve()
        : asyncData.then(
            () => {},
            () => {},
          ),
  }
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
  return asNuxtConvexQuery(result.resultData, result.resolvePromise)
}
