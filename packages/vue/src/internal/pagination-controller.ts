import type { FunctionReference, PaginationResult } from 'convex/server'
import { computed, shallowRef, watch, type ComputedRef, type Ref } from 'vue'

import { normalizeConvexError, type ConvexCallError } from '../errors'
import {
  createPaginationSplitController,
  type PaginationSplitTarget,
} from './pagination-split-controller'
import {
  assertLoadMoreNumItems,
  commitPaginationPageError,
  commitPaginationPageResult,
  computePaginationStale,
  computePaginationStatus,
  createPaginationGeneration,
  createPaginationOperationFence,
  createPendingPaginationPage,
  isInvalidCursorError,
  viewPaginationPages,
  withholdPaginationPage,
  type PaginationFirstPageState,
  type PaginationOperationContext,
  type PaginationPageOptions,
  type PaginationPageState,
  type PaginationStatus,
} from './pagination-state'
import type { QueryIsolationTag, QuerySubscriptionClient } from './query-controller'

export interface PaginationControllerInput<Item> {
  query: FunctionReference<'query'>
  initialNumItems: number
  getInitialCursor?(): string | null
  keepPreviousData: boolean
  getArgs(): Record<string, unknown> | 'skip'
  getArgsHash(): string
  getBoundaryKey(): string
  getIsolationTag(): QueryIsolationTag
  isIdle(): boolean
  isLive(): boolean
  getBoundaryFirstPage(): PaginationResult<Item> | null
  getBoundaryError(): ConvexCallError | undefined
  setBoundaryError(error: ConvexCallError | undefined, key: string): void
  getClient(): QuerySubscriptionClient | null
  fetchPage(options: PaginationPageOptions): Promise<PaginationResult<Item> | null>
}

export interface PaginationController<Item> {
  pages: Readonly<Ref<PaginationPageState<Item>[]>>
  data: ComputedRef<readonly Item[] | undefined>
  /** Whole-list status: any failed or loading page makes the list error or pending. */
  status: ComputedRef<PaginationStatus>
  pending: ComputedRef<boolean>
  isStale: ComputedRef<boolean>
  canLoadMore: ComputedRef<boolean>
  cursor: ComputedRef<string | null>
  pageStatus: ComputedRef<'SplitRecommended' | 'SplitRequired' | null>
  /** The boundary error, else the first failed later page; loaded items stay in `data`. */
  error: ComputedRef<ConvexCallError | undefined>
  start(): void
  firstPageSettled(): Promise<void>
  loadMore(numItems: number): void
  refresh(): Promise<void>
  reset(): void
  handleIdentityBoundary(input: {
    nextTag: QueryIsolationTag
    previousTag: QueryIsolationTag
    previousBoundaryKey: string
  }): void
  handleExecutionBoundary(input: {
    nextBoundaryKey: string
    previousBoundaryKey: string
    nextLive: boolean
    previousLive: boolean
  }): Promise<void>
  dispose(): void
}

function sameTag(a: QueryIsolationTag, b: QueryIsolationTag): boolean {
  return a.identityKey === b.identityKey && a.identityGeneration === b.identityGeneration
}

interface FirstPageSettlement {
  promise: Promise<void>
  resolve(): void
}

function deferredSettlement(): FirstPageSettlement {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

export function createPaginationController<Item>(
  input: PaginationControllerInput<Item>,
): PaginationController<Item> {
  const generation = shallowRef(createPaginationGeneration())
  const pages = shallowRef<PaginationPageState<Item>[]>([])
  const firstPageRealtime = shallowRef<PaginationResult<Item> | null>(null)
  const firstPageOptions = shallowRef<PaginationPageOptions | null>(null)
  const firstPageWithheld = shallowRef(false)
  const manualRefreshPending = shallowRef(false)
  const lastSettledResults = shallowRef<readonly Item[] | undefined>(undefined)
  let firstPageUnsubscribe: (() => void) | null = null
  let pendingFirstPageSettlement: FirstPageSettlement | null = null
  let stopSettledWatch: (() => void) | null = null
  let disposed = false

  const initialOptions = computed<PaginationPageOptions>(() => ({
    numItems: input.initialNumItems,
    cursor: input.getInitialCursor?.() ?? null,
    id: generation.value,
  }))

  const fence = createPaginationOperationFence({
    getArgsHash: input.getArgsHash,
    getBoundaryKey: input.getBoundaryKey,
    getPaginationGeneration: () => generation.value,
    getIsolationTag: input.getIsolationTag,
    isDisposed: () => disposed,
  })

  const splitController = createPaginationSplitController({
    query: input.query,
    initialNumItems: input.initialNumItems,
    pages,
    firstPageRealtime,
    firstPageOptions,
    firstPageWithheld,
    initialOptions,
    isDisposed: () => disposed,
    isLive: input.isLive,
    getClient: input.getClient,
    getArgs: input.getArgs,
    setBoundaryError: input.setBoundaryError,
    captureOperation: fence.capture,
    isOperationCurrent: fence.isCurrent,
    settleFirstPageIfTerminal,
    replaceFirstPageSubscription(unsubscribe) {
      firstPageUnsubscribe?.()
      firstPageUnsubscribe = unsubscribe
    },
    acceptFirstPageResult,
    acceptPageResult,
    rejectPage,
  })

  const visiblePage = (result: PaginationResult<Item> | null | undefined) =>
    result?.pageStatus === 'SplitRequired' ? null : (result ?? null)

  const firstPage = () =>
    firstPageWithheld.value
      ? null
      : (visiblePage(firstPageRealtime.value) ?? visiblePage(input.getBoundaryFirstPage()))

  const findPageIndex = (options: PaginationPageOptions) =>
    pages.value.findIndex((candidate) => candidate.paginationOpts === options)

  function settleFirstPageIfTerminal(): void {
    if (
      !pendingFirstPageSettlement ||
      (!disposed &&
        !input.isIdle() &&
        firstPage() === null &&
        input.getBoundaryError() === undefined)
    )
      return
    pendingFirstPageSettlement.resolve()
    pendingFirstPageSettlement = null
  }

  function firstPageSettled(): Promise<void> {
    if (
      disposed ||
      input.isIdle() ||
      firstPage() !== null ||
      input.getBoundaryError() !== undefined
    )
      return Promise.resolve()
    pendingFirstPageSettlement ??= deferredSettlement()
    return pendingFirstPageSettlement.promise
  }

  async function fetchForOperation(
    options: PaginationPageOptions,
    operation: PaginationOperationContext,
  ): Promise<PaginationResult<Item> | null> {
    const result = await input.fetchPage(options)
    return result && fence.isCurrent(operation) ? result : null
  }

  function retirePagesFrom(index: number): void {
    for (const page of pages.value.slice(index)) page.unsubscribe?.()
    pages.value = pages.value.slice(0, index)
  }

  function acceptFirstPageResult(
    result: PaginationResult<Item>,
    operation: PaginationOperationContext,
  ): void {
    if (result.pageStatus === 'SplitRequired') {
      firstPageWithheld.value = true
      firstPageRealtime.value = null
      splitController.begin('first', result)
      return
    }
    const previous = firstPage()
    if (previous && previous.continueCursor !== result.continueCursor && pages.value.length > 0)
      retirePagesFrom(0)
    firstPageWithheld.value = false
    firstPageRealtime.value = result
    input.setBoundaryError(undefined, operation.boundaryKey)
    splitController.begin('first', result)
    settleFirstPageIfTerminal()
  }

  function acceptPageResult(
    pageOptions: PaginationPageOptions,
    result: PaginationResult<Item>,
  ): void {
    const index = findPageIndex(pageOptions)
    if (index < 0) return
    if (result.pageStatus === 'SplitRequired') {
      pages.value = withholdPaginationPage(pages.value, index)
      splitController.begin(pageOptions, result)
      return
    }
    const previous = pages.value[index]?.result
    const nextPages = commitPaginationPageResult(pages.value, index, result)
    if (
      previous &&
      previous.continueCursor !== result.continueCursor &&
      nextPages.length > index + 1
    ) {
      for (const laterPage of nextPages.slice(index + 1)) laterPage.unsubscribe?.()
      pages.value = nextPages.slice(0, index + 1)
    } else {
      pages.value = nextPages
    }
    splitController.begin(pageOptions, result)
  }

  // Replaying the caller's own initial cursor would fail the same way forever.
  const isUnboundedInitialPage = (options: PaginationPageOptions) =>
    options.endCursor == null && options.cursor === initialOptions.value.cursor

  function rejectPage(
    target: PaginationSplitTarget,
    error: unknown,
    source?: PaginationPageOptions,
  ): void {
    if (target !== 'first' && findPageIndex(target) < 0) return
    if (source && !isUnboundedInitialPage(source) && isInvalidCursorError(error)) {
      restartAfterInvalidCursor()
      return
    }
    if (target === 'first') {
      input.setBoundaryError(normalizeConvexError(error), input.getBoundaryKey())
      settleFirstPageIfTerminal()
      return
    }
    pages.value = commitPaginationPageError(pages.value, findPageIndex(target), error)
  }

  function subscribeFirstPage(options = initialOptions.value): void {
    if (disposed || firstPageUnsubscribe || !input.isLive()) return
    const client = input.getClient()
    const args = input.getArgs()
    if (!client || args === 'skip') return
    const operation = fence.capture()
    firstPageOptions.value = options
    const isCurrent = () => fence.isCurrent(operation) && firstPageOptions.value === options
    firstPageUnsubscribe = client.onUpdate(
      input.query,
      { ...args, paginationOpts: options },
      (raw) => {
        if (isCurrent()) acceptFirstPageResult(raw as PaginationResult<Item>, operation)
      },
      (error) => {
        if (isCurrent()) rejectPage('first', error, options)
      },
    )
  }

  function subscribePage(pageIndex: number): void {
    if (disposed || !input.isLive()) return
    const page = pages.value[pageIndex]
    const client = input.getClient()
    const args = input.getArgs()
    if (!page || !client || args === 'skip') return
    const operation = fence.capture()
    const pageOptions = page.paginationOpts
    page.unsubscribe?.()
    page.unsubscribe = client.onUpdate(
      input.query,
      { ...args, paginationOpts: pageOptions },
      (raw) => {
        if (fence.isCurrent(operation)) acceptPageResult(pageOptions, raw as PaginationResult<Item>)
      },
      (error) => {
        if (fence.isCurrent(operation)) rejectPage(pageOptions, error, pageOptions)
      },
    )
  }

  function teardownSubscriptions(): void {
    firstPageUnsubscribe?.()
    firstPageUnsubscribe = null
    firstPageOptions.value = null
    splitController.teardown()
    for (const page of pages.value) {
      page.unsubscribe?.()
      page.unsubscribe = null
    }
  }

  const view = computed(() => viewPaginationPages(firstPage(), pages.value))

  const status = computed<PaginationStatus>(() => {
    const currentFirstPage = firstPage()
    const { complete, last, loadingMore, error: pageError } = view.value
    const firstPageState: PaginationFirstPageState = currentFirstPage
      ? { state: 'ready', isDone: currentFirstPage.isDone }
      : { state: 'loading' }
    return computePaginationStatus({
      disabled: input.isIdle(),
      refresh: manualRefreshPending.value ? 'pending' : 'idle',
      hasError: input.getBoundaryError() !== undefined || pageError !== undefined,
      firstPage: firstPageState,
      nextPage: loadingMore
        ? { state: 'loading' }
        : complete && last?.isDone
          ? { state: 'exhausted' }
          : { state: 'idle' },
    })
  })

  const currentData = computed<readonly Item[] | undefined>(() =>
    input.isIdle() ? undefined : view.value.items,
  )

  const isStale = computed(() =>
    computePaginationStale({
      keepPreviousData: input.keepPreviousData,
      status: status.value,
      hasCurrentData: currentData.value !== undefined,
      hasLastSettledData: lastSettledResults.value !== undefined,
    }),
  )
  const data = computed<readonly Item[] | undefined>(() =>
    isStale.value ? lastSettledResults.value : currentData.value,
  )
  const pending = computed(() => status.value === 'pending')
  // A settled list may load more while its auth gate still waits: the page is
  // held and subscribed with the rest of the list once it goes live.
  const canLoadMore = computed(
    () => status.value === 'success' && view.value.last?.isDone === false,
  )
  const cursor = computed(() => view.value.last?.continueCursor ?? initialOptions.value.cursor)
  const pageStatus = computed(() => view.value.last?.pageStatus ?? null)
  const error = computed<ConvexCallError | undefined>(
    () => input.getBoundaryError() ?? view.value.error,
  )

  function start(): void {
    if (disposed || stopSettledWatch) return
    stopSettledWatch = watch(
      [status, currentData],
      ([nextStatus, nextData]) => {
        if (input.isIdle() || nextStatus !== 'success' || nextData === undefined) return
        lastSettledResults.value = nextData
      },
      { immediate: true, flush: 'sync' },
    )
    if (input.isLive()) subscribeFirstPage()
  }

  /** Bounds the last loaded page; a list that is not live yet subscribes it when it goes live. */
  function boundLastLoadedPage(endCursor: string | null): void {
    const lastIndex = pages.value.length - 1
    if (lastIndex < 0) {
      const options = firstPageOptions.value ?? initialOptions.value
      if (options.endCursor === endCursor) return
      firstPageUnsubscribe?.()
      firstPageUnsubscribe = null
      const bounded = { ...options, endCursor }
      if (input.isLive()) subscribeFirstPage(bounded)
      else firstPageOptions.value = bounded
      return
    }

    const page = pages.value[lastIndex]
    if (!page || page.paginationOpts.endCursor === endCursor) return
    page.unsubscribe?.()
    const boundedPage = {
      ...page,
      paginationOpts: { ...page.paginationOpts, endCursor },
      unsubscribe: null,
    }
    pages.value = [...pages.value.slice(0, lastIndex), boundedPage]
    subscribePage(lastIndex)
  }

  function loadMore(numItems: number): void {
    assertLoadMoreNumItems(numItems)
    // Only subscriptions load later pages. Before the list is live the page
    // stays pending; `resubscribeLoadedPages` subscribes it with the others.
    if (disposed || !canLoadMore.value || input.getArgs() === 'skip') return
    const continueCursor = view.value.last!.continueCursor
    boundLastLoadedPage(continueCursor)
    pages.value = [
      ...pages.value,
      createPendingPaginationPage<Item>({ numItems, cursor: continueCursor, id: generation.value }),
    ]
    subscribePage(pages.value.length - 1)
  }

  async function refresh(): Promise<void> {
    if (disposed || input.isIdle() || manualRefreshPending.value) return
    manualRefreshPending.value = true
    input.setBoundaryError(undefined, input.getBoundaryKey())
    const loadedPages = [...pages.value]
    const operation = fence.capture()
    // A failed later page keeps the loaded list and reports on that page only.
    let failedTarget: PaginationSplitTarget = 'first'
    let failedSource = firstPageOptions.value ?? initialOptions.value
    try {
      const firstResult = await fetchForOperation(failedSource, operation)
      if (!firstResult) return
      const refreshed: PaginationPageState<Item>[] = []
      const results: PaginationResult<Item>[] = []
      let previous = firstResult
      for (const page of loadedPages) {
        if (previous.isDone || previous.pageStatus === 'SplitRequired') break
        const cursor = previous.continueCursor
        const paginationOpts =
          cursor === page.paginationOpts.cursor
            ? page.paginationOpts
            : { ...page.paginationOpts, cursor }
        failedTarget = page.paginationOpts
        failedSource = paginationOpts
        const result = await fetchForOperation(paginationOpts, operation)
        if (!result) return
        refreshed.push({
          ...page,
          paginationOpts,
          result: visiblePage(result) ?? undefined,
          error: undefined,
        })
        results.push(result)
        previous = result
      }
      if (!fence.isCurrent(operation) || pages.value.length !== loadedPages.length) return
      for (const retiredPage of loadedPages.slice(refreshed.length)) retiredPage.unsubscribe?.()
      firstPageWithheld.value = firstResult.pageStatus === 'SplitRequired'
      firstPageRealtime.value = visiblePage(firstResult)
      pages.value = refreshed
      if (input.isLive()) {
        for (let index = 0; index < refreshed.length; index += 1) {
          if (loadedPages[index]?.paginationOpts !== refreshed[index]?.paginationOpts) {
            subscribePage(index)
          }
        }
      }
      input.setBoundaryError(undefined, operation.boundaryKey)
      splitController.begin('first', firstResult)
      refreshed.forEach((page, index) =>
        splitController.begin(page.paginationOpts, results[index]!),
      )
    } catch (cause) {
      if (fence.isCurrent(operation)) rejectPage(failedTarget, cause, failedSource)
    } finally {
      if (fence.isCurrent(operation)) manualRefreshPending.value = false
    }
  }

  function restartBoundary(options: {
    clearSettledData: boolean
    errorKey: string
    renewGeneration: boolean
    subscribe: boolean
  }): void {
    fence.invalidate()
    teardownSubscriptions()
    if (options.renewGeneration) generation.value = createPaginationGeneration()
    manualRefreshPending.value = false
    firstPageRealtime.value = null
    firstPageWithheld.value = false
    pages.value = []
    if (options.clearSettledData) lastSettledResults.value = undefined
    input.setBoundaryError(undefined, options.errorKey)
    if (options.subscribe) subscribeFirstPage()
    else settleFirstPageIfTerminal()
  }

  /** Convex resets pagination on an invalid cursor; settled data stays available as stale. */
  function restartAfterInvalidCursor(): void {
    restartBoundary({
      clearSettledData: false,
      errorKey: input.getBoundaryKey(),
      renewGeneration: true,
      subscribe: input.isLive(),
    })
  }

  /** Every retained page must be live again, not only the first one. */
  function resubscribeLoadedPages(): void {
    const options = firstPageOptions.value ?? initialOptions.value
    fence.invalidate()
    teardownSubscriptions()
    manualRefreshPending.value = false
    subscribeFirstPage(options)
    for (let index = 0; index < pages.value.length; index += 1) subscribePage(index)
  }

  function reset(): void {
    if (disposed) return
    restartBoundary({
      clearSettledData: true,
      errorKey: input.getBoundaryKey(),
      renewGeneration: true,
      subscribe: input.isLive(),
    })
  }

  function handleIdentityBoundary(boundary: {
    nextTag: QueryIsolationTag
    previousTag: QueryIsolationTag
    previousBoundaryKey: string
  }): void {
    if (sameTag(boundary.nextTag, boundary.previousTag)) return
    restartBoundary({
      clearSettledData: true,
      errorKey: boundary.previousBoundaryKey,
      renewGeneration: true,
      subscribe: input.isLive(),
    })
  }

  async function handleExecutionBoundary(boundary: {
    nextBoundaryKey: string
    previousBoundaryKey: string
    nextLive: boolean
    previousLive: boolean
  }): Promise<void> {
    if (
      boundary.nextBoundaryKey === boundary.previousBoundaryKey &&
      boundary.nextLive === boundary.previousLive
    )
      return
    if (
      boundary.nextBoundaryKey === boundary.previousBoundaryKey &&
      boundary.nextLive &&
      !boundary.previousLive
    ) {
      resubscribeLoadedPages()
      return
    }
    const idle = input.isIdle()
    restartBoundary({
      clearSettledData: idle,
      errorKey: boundary.previousBoundaryKey,
      renewGeneration: !idle,
      subscribe: !idle && boundary.nextLive,
    })
    if (boundary.nextBoundaryKey !== boundary.previousBoundaryKey) {
      input.setBoundaryError(undefined, boundary.nextBoundaryKey)
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    fence.invalidate()
    teardownSubscriptions()
    stopSettledWatch?.()
    stopSettledWatch = null
    settleFirstPageIfTerminal()
  }

  return {
    pages,
    data,
    status,
    pending,
    isStale,
    canLoadMore,
    cursor,
    pageStatus,
    error,
    start,
    firstPageSettled,
    loadMore,
    refresh,
    reset,
    handleIdentityBoundary,
    handleExecutionBoundary,
    dispose,
  }
}
