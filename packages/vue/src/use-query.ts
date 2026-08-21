import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { hash } from 'ohash'
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
} from 'vue'

import type { ConvexCallError } from './errors'
import type { ClientCallStatus } from './internal/call-state'
import { normalizeConvexArgs, isConvexArgsSkipped } from './internal/query-args'
import { createQueryController, type QueryIsolationTag } from './internal/query-controller'
import { decideQueryExecution } from './internal/query-execution'
import { useBetterConvexRuntime, type BetterConvexVueRuntime } from './runtime-context'

export type ConvexAuthMode = 'required' | 'optional' | 'none'
export type ConvexQuerySkip = 'skip'
export type ConvexQueryArgs<Args> = Args | ConvexQuerySkip
export type ConvexCallStatus = ClientCallStatus

export interface UseConvexQueryOptions {
  readonly auth?: ConvexAuthMode
  readonly keepPreviousData?: boolean
  readonly immediate?: boolean
}

export interface UseConvexQueryState<Data> {
  readonly data: ComputedRef<Data | undefined>
  readonly status: ComputedRef<ConvexCallStatus>
  readonly pending: ComputedRef<boolean>
  readonly error: ComputedRef<ConvexCallError | undefined>
  readonly isStale: ComputedRef<boolean>
  execute(): Promise<void>
  refresh(): Promise<void>
}

type EmptyConvexArgs = Record<string, never>
type StrictEmptyConvexArgs = Record<PropertyKey, never>
type TightenEmptyConvexArgs<Args> = Args extends unknown
  ? Args extends EmptyConvexArgs
    ? StrictEmptyConvexArgs
    : Args
  : never
type QueryArgsParameter<Query extends FunctionReference<'query'>> = MaybeRefOrGetter<
  ConvexQueryArgs<TightenEmptyConvexArgs<FunctionArgs<Query>>>
>

export type UseConvexQueryParameters<
  Query extends FunctionReference<'query'>,
  Options extends UseConvexQueryOptions = UseConvexQueryOptions,
> = [FunctionArgs<Query>] extends [EmptyConvexArgs]
  ? [] | [args: QueryArgsParameter<Query>, options?: Options]
  : [args: QueryArgsParameter<Query>, options?: Options]

interface QueryHydrationSeed<Data> {
  readonly value: Data
}

type InternalQueryParameters<Query extends FunctionReference<'query'>> = [
  args?: MaybeRefOrGetter<ConvexQueryArgs<FunctionArgs<Query>>>,
  options?: UseConvexQueryOptions,
  hydrationSeed?: QueryHydrationSeed<FunctionReturnType<Query>>,
  runtimeOverride?: BetterConvexVueRuntime,
]

export function useConvexQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  ...parameters: UseConvexQueryParameters<Query>
): UseConvexQueryState<FunctionReturnType<Query>> {
  if (!getCurrentScope()) {
    throw new Error('[better-convex-vue] useConvexQuery must run inside a Vue effect scope')
  }
  type Raw = FunctionReturnType<Query>
  // Nuxt passes an SSR seed in a fourth runtime-only slot. It is intentionally
  // absent from the public declaration: hydration is adapter machinery, not a
  // second public source of query data.
  const [providedArgs, options, hydrationSeed, runtimeOverride] =
    parameters as InternalQueryParameters<Query>
  const args = (parameters.length === 0 ? {} : providedArgs) as MaybeRefOrGetter<
    ConvexQueryArgs<FunctionArgs<Query>>
  >
  const runtime = runtimeOverride ?? useBetterConvexRuntime()
  const auth = options?.auth ?? 'optional'
  const currentArgs = computed(() => normalizeConvexArgs(args))
  const argsHash = computed(() => hash(currentArgs.value))
  const noQueryValue = Symbol('no-query-value')
  const initialValue = hydrationSeed === undefined ? noQueryValue : (hydrationSeed.value as Raw)
  const raw = shallowRef<Raw | typeof noQueryValue>(initialValue)
  const boundaryError = shallowRef<ConvexCallError | undefined>(undefined)
  const loading = ref(false)
  const started = ref(options?.immediate !== false)
  const identity = runtime.identity.snapshot
  const functionName = getFunctionName(query)

  const gate = computed(() => {
    if (!started.value) return 'idle' as const
    return decideQueryExecution({
      auth,
      skipped: isConvexArgsSkipped(currentArgs.value),
      identity: identity.value,
    })
  })
  const tag = computed<QueryIsolationTag>(() => ({
    identityKey: auth === 'none' ? 'anonymous' : (identity.value.identityKey ?? 'anonymous'),
    identityGeneration: auth === 'none' ? 0 : identity.value.identityGeneration,
  }))
  const boundaryKey = computed(
    () => `${functionName}:${auth}:${tag.value.identityKey}:${argsHash.value}`,
  )

  const controller = createQueryController<Raw>({
    query,
    keepPreviousData: options?.keepPreviousData ?? false,
    getArgs: () =>
      isConvexArgsSkipped(currentArgs.value)
        ? 'skip'
        : (currentArgs.value as Record<string, unknown>),
    getArgsHash: () => argsHash.value,
    getBoundaryKey: () => boundaryKey.value,
    getIsolationTag: () => tag.value,
    getClient: () =>
      gate.value === 'execute'
        ? (runtime.browser.clientFor(auth) as typeof runtime.browser.handle)
        : null,
    boundary: {
      hasData: () => raw.value !== noQueryValue,
      readData: () => {
        if (raw.value === noQueryValue) {
          throw new Error('[better-convex-vue] attempted to read an unsettled query value')
        }
        return raw.value
      },
      writeData: (value) => {
        raw.value = value
      },
      setError: (error) => {
        boundaryError.value = error
      },
      clearData: () => {
        raw.value = noQueryValue
      },
    },
    events: {
      onUpdate: () => {
        loading.value = false
      },
      onError: () => {
        loading.value = false
      },
    },
  })

  if (hydrationSeed !== undefined) controller.markSettled()

  let previousTag = tag.value
  let previousBoundaryKey = boundaryKey.value
  let previousLive = false
  let refreshSequence = 0

  const reconcile = () => {
    const nextTag = tag.value
    const nextBoundaryKey = boundaryKey.value
    const nextLive = gate.value === 'execute'
    const nextIdle = gate.value === 'idle' || gate.value === 'error'
    if (
      nextTag.identityGeneration !== previousTag.identityGeneration ||
      nextTag.identityKey !== previousTag.identityKey
    ) {
      controller.handleIdentityBoundary({ nextTag, previousTag })
    } else {
      controller.handleExecutionBoundary({
        nextBoundaryKey,
        previousBoundaryKey,
        nextLive,
        previousLive,
        nextIdle,
      })
    }
    previousTag = nextTag
    previousBoundaryKey = nextBoundaryKey
    previousLive = nextLive

    if (gate.value === 'error') {
      boundaryError.value = identity.value.error ?? undefined
      loading.value = false
      return
    }
    if (gate.value === 'wait') {
      loading.value = true
      void runtime.browser.ready().then(reconcile)
      return
    }
    if (gate.value === 'idle') {
      loading.value = false
      boundaryError.value = undefined
      return
    }
    boundaryError.value = undefined
    controller.setupSubscription()
    loading.value = controller.isAwaitingFirstValue() && !controller.hasSettledForCurrentArgs()
  }

  async function refresh(): Promise<void> {
    if (!started.value) {
      started.value = true
      reconcile()
    }
    if (gate.value !== 'execute' || isConvexArgsSkipped(currentArgs.value)) return
    const sequence = ++refreshSequence
    const operation = controller.beginOperation()
    const isCurrentRefresh = () =>
      sequence === refreshSequence && controller.isOperationCurrent(operation)
    loading.value = true
    boundaryError.value = undefined
    try {
      const value = (await runtime.browser
        .clientFor(auth)
        .query(query, currentArgs.value as FunctionArgs<Query>)) as Raw
      if (!isCurrentRefresh()) return
      raw.value = value
      controller.markSettled(operation)
    } catch (error) {
      if (!isCurrentRefresh()) return
      const normalized = controller.setOperationError(error, operation)
      if (!normalized) return
      boundaryError.value = normalized
    } finally {
      if (isCurrentRefresh()) loading.value = false
    }
  }

  async function execute(): Promise<void> {
    if (!started.value) {
      started.value = true
      reconcile()
    }
    if (gate.value !== 'execute' || !controller.isAwaitingFirstValue()) return
    await new Promise<void>((resolve) => {
      let stopWaiting = () => {}
      stopWaiting = watch(
        [loading, boundaryError],
        ([isLoading]) => {
          if (isLoading) return
          stopWaiting()
          resolve()
        },
        { immediate: true, flush: 'sync' },
      )
    })
  }

  const stop = watch([argsHash, gate, () => identity.value.identityGeneration], reconcile, {
    immediate: true,
    flush: 'sync',
  })
  onScopeDispose(() => {
    stop()
    loading.value = false
    controller.dispose()
  })

  const data = computed(() => controller.data())
  const error = computed(() => boundaryError.value)
  const pending = computed(() => loading.value)
  const status = computed<ClientCallStatus>(() =>
    loading.value
      ? 'pending'
      : boundaryError.value
        ? 'error'
        : controller.hasData()
          ? 'success'
          : 'idle',
  )
  const isStale = computed(() =>
    controller.isStale({
      idle: gate.value !== 'execute',
      pending: loading.value,
      errored: boundaryError.value !== undefined,
    }),
  )

  return Object.freeze({
    data,
    error,
    pending,
    status,
    isStale,
    execute,
    refresh,
  })
}
