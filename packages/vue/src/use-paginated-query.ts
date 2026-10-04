import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  PaginationOptions,
  PaginationResult,
} from 'convex/server'
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

import { normalizeConvexError, type ConvexCallError } from './errors'
import { createPaginationController } from './internal/pagination-controller'
import { assertLoadMoreNumItems } from './internal/pagination-state'
import {
  createConvexArgsState,
  isConvexArgsSkipped,
  type ConvexArgsInput,
  type ConvexArgsState,
} from './internal/query-args'
import { decideQueryGate, queryIsolationTag } from './internal/query-execution'
import { useBetterConvexRuntime } from './runtime-context'
import type { ConvexAuthMode, ConvexCallStatus, ConvexQueryBlockedBy } from './use-query'

export type PaginatedQueryReference = FunctionReference<
  'query',
  'public',
  { paginationOpts: PaginationOptions },
  PaginationResult<unknown>
>

type EmptyConvexArgs = Record<string, never>
type StrictEmptyConvexArgs = Record<PropertyKey, never>
type TightenEmptyConvexArgs<Args> = Args extends unknown
  ? Args extends EmptyConvexArgs
    ? StrictEmptyConvexArgs
    : Args
  : never

export type PaginatedQueryArgs<Query extends PaginatedQueryReference> = TightenEmptyConvexArgs<
  Omit<FunctionArgs<Query>, 'paginationOpts'>
>

export type PaginatedQueryItem<Query extends PaginatedQueryReference> =
  FunctionReturnType<Query>['page'][number]

export interface UseConvexPaginatedQueryOptions {
  readonly initialNumItems: number
  readonly initialCursor?: string | null
  /** Defaults to the plugin's `defaultQueryAuth` (`'optional'` unless configured). */
  readonly auth?: ConvexAuthMode
  readonly keepPreviousData?: boolean
  readonly immediate?: boolean
}

export interface UseConvexPaginatedQueryState<Item> {
  /** Every loaded item, in order. A failed later page keeps the items before it. */
  readonly data: ComputedRef<readonly Item[] | undefined>
  /** The first page's status, exactly like `useConvexQuery`: loading more stays `success`. */
  readonly status: ComputedRef<ConvexCallStatus>
  /** The first page is loading. */
  readonly pending: ComputedRef<boolean>
  /**
   * The first-page failure, else the first failed later page. `status` stays
   * `success` for a failed later page. `error.functionName` names the query.
   */
  readonly error: ComputedRef<ConvexCallError | undefined>
  readonly isStale: ComputedRef<boolean>
  /** Why the list is not running; see `UseConvexQueryState.blockedBy`. */
  readonly blockedBy: ComputedRef<ConvexQueryBlockedBy>
  /**
   * The first page is `success`, the last loaded page is not the end, and no
   * later page is loading. A failed later page may be requested again.
   */
  readonly canLoadMore: ComputedRef<boolean>
  /** A later page is loading. */
  readonly isLoadingMore: ComputedRef<boolean>
  /** The last loaded page is the end of the list. */
  readonly isExhausted: ComputedRef<boolean>
  /**
   * Request `numItems` more items. The promise settles once that page is
   * loaded, failed, superseded, restarted, or disposed, and it never rejects, so
   * templates may ignore it. Without `canLoadMore` the call does nothing.
   * Throws synchronously when `numItems` is not a positive safe integer.
   */
  loadMore(numItems: number): Promise<void>
  execute(): Promise<void>
  /** Restart the list, optionally from `cursor`, dropping every loaded page. */
  restart(cursor?: string | null): void
}

/** Adapter-owned SSR state for the browser pagination lifecycle. */
export interface ConvexPaginationBridge<Item> {
  /** A server-rendered first page the browser lifecycle starts from. */
  readonly initialPage?: PaginationResult<Item>
}

export interface UseConvexPaginatedQueryInternalInput<Query extends PaginatedQueryReference> {
  readonly query: Query
  /** Normalized arguments and hash, shared with the adapter's payload key. */
  readonly args: ConvexArgsState<PaginatedQueryArgs<Query>>
  readonly options: UseConvexPaginatedQueryOptions
  readonly bridge?: ConvexPaginationBridge<PaginatedQueryItem<Query>>
}

export interface ConvexPaginatedQueryInternal<Item> {
  readonly state: UseConvexPaginatedQueryState<Item>
  /** Settles once the current first page is terminal, without starting a deferred query. */
  firstPageSettled(): Promise<void>
}

function assertPaginatedQueryInput(options: UseConvexPaginatedQueryOptions): void {
  if (!getCurrentScope()) {
    throw new Error(
      '[better-convex-vue] useConvexPaginatedQuery must run inside a Vue effect scope',
    )
  }
  if (!Number.isSafeInteger(options.initialNumItems) || options.initialNumItems < 1) {
    throw new Error('[better-convex-vue] initialNumItems must be a positive safe integer')
  }
  if (
    options.initialCursor !== undefined &&
    options.initialCursor !== null &&
    typeof options.initialCursor !== 'string'
  ) {
    throw new Error('[better-convex-vue] initialCursor must be a string or null')
  }
}

export function useConvexPaginatedQuery<Query extends PaginatedQueryReference>(
  query: Query,
  args: MaybeRefOrGetter<ConvexArgsInput<PaginatedQueryArgs<Query>> | 'skip'>,
  options: UseConvexPaginatedQueryOptions,
): UseConvexPaginatedQueryState<PaginatedQueryItem<Query>> {
  const argsState = createConvexArgsState(
    args as MaybeRefOrGetter<PaginatedQueryArgs<Query> | 'skip'>,
  )
  return useConvexPaginatedQueryInternal({ query, args: argsState, options }).state
}

/**
 * The one browser pagination lifecycle. The public composable and the Nuxt
 * adapter both enter here; only the adapter supplies an SSR bridge.
 */
export function useConvexPaginatedQueryInternal<Query extends PaginatedQueryReference>(
  input: UseConvexPaginatedQueryInternalInput<Query>,
): ConvexPaginatedQueryInternal<PaginatedQueryItem<Query>> {
  const { query, args, options, bridge } = input
  assertPaginatedQueryInput(options)

  type Item = PaginatedQueryItem<Query>
  const runtime = useBetterConvexRuntime()
  const auth = options.auth ?? runtime.defaultQueryAuth
  const initialNumItems = options.initialNumItems
  const initialCursor = shallowRef(options.initialCursor ?? null)
  const started = shallowRef(options.immediate !== false)
  const identity = runtime.identity.snapshot
  const currentArgs = args.args
  const argsHash = args.hash
  const functionName = getFunctionName(query)
  const boundaryFirstPage = shallowRef<PaginationResult<Item> | null>(bridge?.initialPage ?? null)
  const boundaryError = shallowRef<ConvexCallError | undefined>(undefined)
  // The shared identity error, named for this query like every other failure.
  const gateError = computed(() => {
    const error = identity.value.error
    return error ? normalizeConvexError(error, { functionName }) : undefined
  })

  const decision = computed(() =>
    decideQueryGate({
      auth,
      started: started.value,
      skipped: isConvexArgsSkipped(currentArgs.value),
      identity: identity.value,
    }),
  )
  // Primitive projections, so identity notifications that rebuild the
  // decision do not re-run the reconcile watcher below.
  const gate = computed(() => decision.value.outcome)
  const blockedBy = computed(() => decision.value.blockedBy)
  const idle = computed(() => gate.value === 'idle' || gate.value === 'error')
  const live = computed(() => gate.value === 'execute')
  const tag = computed(() => queryIsolationTag(auth, identity.value))
  const boundaryKey = computed(
    () =>
      `${functionName}:${auth}:${tag.value.identityKey}:${argsHash.value}:${initialNumItems}:${initialCursor.value ?? ''}`,
  )

  const controller = createPaginationController<Item>({
    query,
    initialNumItems,
    getInitialCursor: () => initialCursor.value,
    keepPreviousData: options.keepPreviousData ?? false,
    getArgs: () =>
      isConvexArgsSkipped(currentArgs.value)
        ? 'skip'
        : (currentArgs.value as Record<string, unknown>),
    getArgsHash: () => argsHash.value,
    getBoundaryKey: () => boundaryKey.value,
    getIsolationTag: () => tag.value,
    isIdle: () => idle.value,
    isLive: () => live.value,
    getBoundaryFirstPage: () => boundaryFirstPage.value,
    retireBoundaryFirstPage: () => {
      boundaryFirstPage.value = null
    },
    getBoundaryError: () =>
      auth === 'none' ? boundaryError.value : (gateError.value ?? boundaryError.value),
    setBoundaryError: (error) => {
      boundaryError.value = error
    },
    getClient: () => (gate.value === 'execute' ? runtime.browser.clientFor(auth) : null),
  })
  controller.start()

  let previousTag = tag.value
  let previousBoundaryKey = boundaryKey.value
  let previousLive = live.value
  let initialized = false
  const reconcile = () => {
    const nextTag = tag.value
    const nextBoundaryKey = boundaryKey.value
    if (!initialized) {
      initialized = true
      previousTag = nextTag
      previousBoundaryKey = nextBoundaryKey
      previousLive = live.value
      return
    }
    const priorTag = previousTag
    const priorBoundaryKey = previousBoundaryKey
    const priorLive = previousLive
    previousTag = nextTag
    previousBoundaryKey = nextBoundaryKey
    previousLive = live.value
    if (
      nextTag.identityGeneration !== priorTag.identityGeneration ||
      nextTag.identityKey !== priorTag.identityKey
    ) {
      boundaryFirstPage.value = null
      controller.handleIdentityBoundary({
        nextTag,
        previousTag: priorTag,
        previousBoundaryKey: priorBoundaryKey,
      })
    } else {
      if (nextBoundaryKey !== priorBoundaryKey || idle.value) boundaryFirstPage.value = null
      void controller.handleExecutionBoundary({
        nextBoundaryKey,
        previousBoundaryKey: priorBoundaryKey,
        nextLive: live.value,
        previousLive: priorLive,
      })
    }
  }
  // Getter sources only: a shallow ref source would force-trigger reconcile on
  // every identity notification, and an unchanged idle (deferred) reconcile
  // drops the hydrated first page.
  const stop = watch(
    [argsHash, gate, live, () => initialCursor.value, () => identity.value.identityGeneration],
    reconcile,
    { immediate: true, flush: 'sync' },
  )

  // A deferred lifecycle can already show a server-rendered first page that
  // offers more items. Hold one loadMore until starting makes it runnable.
  const heldLoadMore = shallowRef<{ numItems: number; settle: () => void } | undefined>(undefined)

  function releaseHeldLoadMore(): void {
    const held = heldLoadMore.value
    heldLoadMore.value = undefined
    held?.settle()
  }

  function start(): void {
    if (started.value) return
    started.value = true
    const held = heldLoadMore.value
    if (!held) return
    // Request first, then release: `isLoadingMore` never flickers off between.
    const settled = controller.loadMore(held.numItems)
    heldLoadMore.value = undefined
    void settled.then(held.settle)
  }

  function loadMore(numItems: number): Promise<void> {
    if (started.value) return controller.loadMore(numItems)
    assertLoadMoreNumItems(numItems)
    const seed = boundaryFirstPage.value
    if (!seed || seed.isDone || heldLoadMore.value) return Promise.resolve()
    return new Promise<void>((settle) => {
      heldLoadMore.value = { numItems, settle }
    })
  }

  async function execute(): Promise<void> {
    start()
    await controller.firstPageSettled()
  }

  function restart(cursor: string | null = null): void {
    if (typeof cursor !== 'string' && cursor !== null) {
      throw new Error('[better-convex-vue] restart cursor must be a string or null')
    }
    releaseHeldLoadMore()
    if (initialCursor.value === cursor) controller.reset()
    else initialCursor.value = cursor
  }
  onScopeDispose(() => {
    stop()
    releaseHeldLoadMore()
    controller.dispose()
  })

  return {
    state: {
      data: controller.data,
      status: controller.status,
      pending: controller.pending,
      error: controller.error,
      isStale: controller.isStale,
      blockedBy,
      canLoadMore: computed(() => heldLoadMore.value === undefined && controller.canLoadMore.value),
      isLoadingMore: computed(
        () => heldLoadMore.value !== undefined || controller.isLoadingMore.value,
      ),
      isExhausted: controller.isExhausted,
      loadMore,
      execute,
      restart,
    },
    firstPageSettled: controller.firstPageSettled,
  }
}
