import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'
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
import type { ClientCallStatus } from './internal/call-state'
import {
  createConvexArgsState,
  isConvexArgsSkipped,
  type ConvexArgsState,
} from './internal/query-args'
import { createQueryController } from './internal/query-controller'
import { decideQueryExecution, queryIsolationTag } from './internal/query-execution'
import { deriveQueryStatus } from './internal/query-status'
import { createSettlementWaiters } from './internal/settlement'
import { useBetterConvexRuntime } from './runtime-context'

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

/** A server-rendered value the browser lifecycle starts from instead of `pending`. */
export interface ConvexQueryHydrationSeed<Data> {
  readonly value: Data
}

export interface UseConvexQueryInternalInput<Query extends FunctionReference<'query'>> {
  readonly query: Query
  /** Normalized arguments and hash, shared with the adapter's payload key. */
  readonly args: ConvexArgsState<FunctionArgs<Query>>
  readonly options?: UseConvexQueryOptions
  readonly hydrationSeed?: ConvexQueryHydrationSeed<FunctionReturnType<Query>>
}

export function useConvexQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  ...parameters: UseConvexQueryParameters<Query>
): UseConvexQueryState<FunctionReturnType<Query>> {
  const [providedArgs, options] = parameters
  const args = (parameters.length === 0 ? {} : providedArgs) as MaybeRefOrGetter<
    ConvexQueryArgs<FunctionArgs<Query>>
  >
  return useConvexQueryInternal({ query, args: createConvexArgsState(args), options })
}

/**
 * The one browser query lifecycle. The public composable and the Nuxt adapter
 * both enter here; only the adapter supplies a hydration seed.
 */
export function useConvexQueryInternal<Query extends FunctionReference<'query'>>(
  input: UseConvexQueryInternalInput<Query>,
): UseConvexQueryState<FunctionReturnType<Query>> {
  if (!getCurrentScope()) {
    throw new Error('[better-convex-vue] useConvexQuery must run inside a Vue effect scope')
  }
  type Raw = FunctionReturnType<Query>
  const { query, args, options, hydrationSeed } = input
  const runtime = useBetterConvexRuntime()
  const auth = options?.auth ?? 'optional'
  const noQueryValue = Symbol('no-query-value')
  const raw = shallowRef<Raw | typeof noQueryValue>(
    hydrationSeed === undefined ? noQueryValue : hydrationSeed.value,
  )
  const boundaryError = shallowRef<ConvexCallError | undefined>(undefined)
  const loading = shallowRef(false)
  const started = shallowRef(options?.immediate !== false)
  const identity = runtime.identity.snapshot
  const functionName = getFunctionName(query)
  const settlement = createSettlementWaiters()

  const gate = computed(() => {
    if (!started.value) return 'idle' as const
    return decideQueryExecution({
      auth,
      skipped: isConvexArgsSkipped(args.args.value),
      identity: identity.value,
    })
  })
  const tag = computed(() => queryIsolationTag(auth, identity.value))
  const boundaryKey = computed(
    () => `${functionName}:${auth}:${tag.value.identityKey}:${args.hash.value}`,
  )

  const controller = createQueryController<Raw>({
    query,
    keepPreviousData: options?.keepPreviousData ?? false,
    getArgs: () => {
      const current = args.args.value
      return isConvexArgsSkipped(current) ? 'skip' : (current as Record<string, unknown>)
    },
    getArgsHash: () => args.hash.value,
    getBoundaryKey: () => boundaryKey.value,
    getIsolationTag: () => tag.value,
    getClient: () => (gate.value === 'execute' ? runtime.browser.clientFor(auth) : null),
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

  // Auth settlement changes the identity snapshot, which re-runs this through
  // the `gate` watcher; a waiting query needs no separate readiness callback.
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

    switch (gate.value) {
      case 'error':
        boundaryError.value = identity.value.error ?? undefined
        loading.value = false
        return
      case 'wait':
        loading.value = true
        return
      case 'idle':
        loading.value = false
        boundaryError.value = undefined
        return
      case 'execute':
        boundaryError.value = undefined
        controller.setupSubscription()
        loading.value = controller.isAwaitingFirstValue() && !controller.hasSettledForCurrentArgs()
    }
  }

  const start = () => {
    if (started.value) return
    started.value = true
    reconcile()
  }

  async function refresh(): Promise<void> {
    start()
    const currentArgs = args.args.value
    if (gate.value !== 'execute' || isConvexArgsSkipped(currentArgs)) return
    const sequence = ++refreshSequence
    const operation = controller.beginOperation()
    const isCurrentRefresh = () =>
      sequence === refreshSequence && controller.isOperationCurrent(operation)
    loading.value = true
    boundaryError.value = undefined
    try {
      const value = await runtime.browser
        .clientFor(auth)
        .query(query, currentArgs as FunctionArgs<Query>)
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
    start()
    if (gate.value === 'idle' || gate.value === 'error') return
    // A live query that already has its first value is settled; a waiting one
    // resolves only after auth settles and the resulting lifecycle does.
    if (gate.value === 'execute' && !controller.isAwaitingFirstValue()) return
    await settlement.until(() => !loading.value)
  }

  const stop = watch([args.hash, gate, () => identity.value.identityGeneration], reconcile, {
    immediate: true,
    flush: 'sync',
  })
  onScopeDispose(() => {
    stop()
    loading.value = false
    controller.dispose()
    settlement.dispose()
  })

  const data = computed(() => controller.data())
  const error = computed(() => boundaryError.value)
  const pending = computed(() => loading.value)
  const status = computed(() =>
    deriveQueryStatus({
      pending: loading.value,
      error: boundaryError.value !== undefined,
      hasData: controller.hasData(),
    }),
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
