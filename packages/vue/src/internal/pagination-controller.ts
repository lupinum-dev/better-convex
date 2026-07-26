import type { FunctionReference } from 'convex/server'
import { computed, shallowRef, watch, type ComputedRef, type Ref } from 'vue'

import { normalizeConvexError, type ConvexCallError } from '../errors'
import {
  commitPaginationPageError,
  commitPaginationPageResult,
  computePaginationStale,
  computePaginationStatus,
  createPaginationGeneration,
  createPaginationOperationFence,
  createPendingPaginationPage,
  getLastLoadedPaginationResult,
  type PaginationFirstPageState,
  type PaginationNextPageState,
  type PaginationOperationContext,
  type PaginationPageOptions,
  type PaginationPageState,
  type PaginationStatus,
  type BetterPaginationResult,
} from './pagination-state'
import type { QueryIsolationTag, QuerySubscriptionClient } from './query-controller'

export interface PaginationControllerInput<Item, TransformedItem> {
  query: FunctionReference<'query'>
  initialNumItems: number
  subscribe: boolean
  keepPreviousData: boolean
  transform?: (items: Item[]) => TransformedItem[]
  initialData?: Item[] | (() => Item[])
  getArgs(): Record<string, unknown> | 'skip'
  getArgsHash(): string
  getBoundaryKey(): string
  getIsolationTag(): QueryIsolationTag
  isIdle(): boolean
  isLive(): boolean
  isBoundaryPending(): boolean
  getBoundaryFirstPage(): BetterPaginationResult<Item> | null
  getBoundaryError(): ConvexCallError | null
  setBoundaryError(error: ConvexCallError | null, key: string): void
  getClient(): QuerySubscriptionClient | null
  fetchPage(options: PaginationPageOptions): Promise<BetterPaginationResult<Item> | null>
  refreshBoundary(): Promise<void>
}

export interface PaginationController<Item, TransformedItem> {
  generation: Readonly<Ref<number>>
  initialOptions: ComputedRef<PaginationPageOptions>
  pages: Readonly<Ref<PaginationPageState<Item>[]>>
  results: ComputedRef<TransformedItem[]>
  status: ComputedRef<PaginationStatus>
  isLoading: ComputedRef<boolean>
  isStale: ComputedRef<boolean>
  hasNextPage: ComputedRef<boolean>
  error: ComputedRef<ConvexCallError | null>
  start(): void
  captureOperation(): PaginationOperationContext
  isOperationCurrent(operation: PaginationOperationContext): boolean
  fetchForOperation(
    options: PaginationPageOptions,
    operation: PaginationOperationContext,
  ): Promise<BetterPaginationResult<Item> | null>
  subscribeFirstPage(): void
  loadMore(numItems: number): void
  refresh(): Promise<void>
  reset(): Promise<void>
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

export function createPaginationController<Item, TransformedItem = Item>(
  input: PaginationControllerInput<Item, TransformedItem>,
): PaginationController<Item, TransformedItem> {
  const generation = shallowRef(createPaginationGeneration())
  const pages = shallowRef<PaginationPageState<Item>[]>([])
  const firstPageRealtime = shallowRef<BetterPaginationResult<Item> | null>(null)
  const manualRefreshPending = shallowRef(false)
  const lastSettledResults = shallowRef<TransformedItem[]>([])
  const lastSettledArgsHash = shallowRef<string | null>(null)
  let firstPageUnsubscribe: (() => void) | null = null
  let stopSettledWatch: (() => void) | null = null
  let disposed = false

  const initialOptions = computed<PaginationPageOptions>(() => ({
    numItems: input.initialNumItems,
    cursor: null,
    id: generation.value,
  }))

  const fence = createPaginationOperationFence({
    getArgsHash: input.getArgsHash,
    getBoundaryKey: input.getBoundaryKey,
    getPaginationGeneration: () => generation.value,
    getIsolationTag: input.getIsolationTag,
    isDisposed: () => disposed,
  })

  const firstPage = () => firstPageRealtime.value ?? input.getBoundaryFirstPage()

  async function fetchForOperation(
    options: PaginationPageOptions,
    operation: PaginationOperationContext,
  ): Promise<BetterPaginationResult<Item> | null> {
    const result = await input.fetchPage(options)
    return result && fence.isCurrent(operation) ? result : null
  }

  function retirePagesFrom(index: number): void {
    for (const page of pages.value.slice(index)) page.unsubscribe?.()
    pages.value = pages.value.slice(0, index)
  }

  function subscribeFirstPage(): void {
    if (disposed || firstPageUnsubscribe || !input.subscribe || !input.isLive()) return
    const client = input.getClient()
    const args = input.getArgs()
    if (!client || args === 'skip') return
    const operation = fence.capture()
    firstPageUnsubscribe = client.onUpdate(
      input.query,
      { ...args, paginationOpts: initialOptions.value },
      (raw) => {
        if (!fence.isCurrent(operation)) return
        const result = raw as BetterPaginationResult<Item>
        const previous = firstPage()
        if (previous && previous.continueCursor !== result.continueCursor && pages.value.length > 0)
          retirePagesFrom(0)
        firstPageRealtime.value = result
        input.setBoundaryError(null, operation.boundaryKey)
      },
      (error) => {
        if (!fence.isCurrent(operation)) return
        input.setBoundaryError(normalizeConvexError(error), operation.boundaryKey)
      },
    )
  }

  function subscribePage(pageIndex: number): void {
    if (disposed || !input.subscribe || !input.isLive()) return
    const page = pages.value[pageIndex]
    const client = input.getClient()
    const args = input.getArgs()
    if (!page || !client || args === 'skip') return
    const operation = fence.capture()
    const pageOptions = page.paginationOpts
    page.unsubscribe?.()
    const unsubscribe = client.onUpdate(
      input.query,
      { ...args, paginationOpts: page.paginationOpts },
      (raw) => {
        if (!fence.isCurrent(operation)) return
        const index = pages.value.findIndex((candidate) => candidate.paginationOpts === pageOptions)
        if (index < 0) return
        const result = raw as BetterPaginationResult<Item>
        const previous = pages.value[index]?.result
        const nextPages = commitPaginationPageResult(pages.value, index, result)
        if (
          previous &&
          previous.continueCursor !== result.continueCursor &&
          nextPages.length > index + 1
        ) {
          for (const laterPage of nextPages.slice(index + 1)) laterPage.unsubscribe?.()
          pages.value = nextPages.slice(0, index + 1)
          return
        }
        pages.value = nextPages
      },
      (error) => {
        if (!fence.isCurrent(operation)) return
        const index = pages.value.findIndex((candidate) => candidate.paginationOpts === pageOptions)
        if (index < 0) return
        pages.value = commitPaginationPageError(pages.value, index, error)
      },
    )
    page.unsubscribe = unsubscribe
  }

  function teardownSubscriptions(): void {
    firstPageUnsubscribe?.()
    firstPageUnsubscribe = null
    for (const page of pages.value) {
      page.unsubscribe?.()
      page.unsubscribe = null
    }
  }

  const isPreviousDataForCurrentArgs = () =>
    input.keepPreviousData &&
    firstPageRealtime.value === null &&
    lastSettledArgsHash.value !== null &&
    input.getArgsHash() !== lastSettledArgsHash.value &&
    input.isBoundaryPending()

  const status = computed<PaginationStatus>(() => {
    const currentFirstPage = isPreviousDataForCurrentArgs() ? null : firstPage()
    const lastPage = pages.value.at(-1)
    const firstPageState: PaginationFirstPageState = currentFirstPage
      ? { state: 'ready', isDone: currentFirstPage.isDone }
      : { state: 'loading' }
    const nextPageState: PaginationNextPageState = lastPage?.pending
      ? { state: 'loading' }
      : lastPage?.result?.isDone
        ? { state: 'exhausted' }
        : { state: 'idle' }
    return computePaginationStatus({
      disabled: input.isIdle(),
      refresh: manualRefreshPending.value ? 'pending' : 'idle',
      hasError:
        input.getBoundaryError() !== null || pages.value.some((page) => page.error !== null),
      firstPage: firstPageState,
      nextPage: nextPageState,
    })
  })

  const transformedResults = computed<TransformedItem[]>(() => {
    if (input.isIdle() || isPreviousDataForCurrentArgs()) return transform([])
    const items: Item[] = []
    const currentFirstPage = firstPage()
    if (currentFirstPage) items.push(...currentFirstPage.page)
    for (const page of pages.value) if (page.result) items.push(...page.result.page)
    if (items.length > 0) return transform(items)
    const initial =
      typeof input.initialData === 'function' ? input.initialData() : input.initialData
    return status.value === 'loading-first-page' && initial ? transform(initial) : transform([])
  })

  function transform(items: Item[]): TransformedItem[] {
    return input.transform ? input.transform(items) : (items as unknown as TransformedItem[])
  }

  const isStale = computed(() =>
    computePaginationStale({
      keepPreviousData: input.keepPreviousData,
      status: status.value,
      transformedResultCount: transformedResults.value.length,
      lastSettledResultCount: lastSettledResults.value.length,
    }),
  )
  const results = computed(() =>
    isStale.value ? lastSettledResults.value : transformedResults.value,
  )
  const isLoading = computed(
    () => status.value === 'loading-first-page' || status.value === 'loading-more',
  )
  const hasNextPage = computed(() => status.value === 'ready')
  const error = computed<ConvexCallError | null>(() => {
    const boundaryError = input.getBoundaryError()
    if (boundaryError) return boundaryError
    return pages.value.find((page) => page.error)?.error ?? null
  })

  function start(): void {
    if (disposed || stopSettledWatch) return
    stopSettledWatch = watch(
      [status, transformedResults],
      ([nextStatus, nextResults]) => {
        if (input.isIdle() || nextStatus === 'loading-first-page') return
        lastSettledResults.value = nextResults
        lastSettledArgsHash.value = input.getArgsHash()
      },
      { immediate: true },
    )
  }

  function loadMore(numItems: number): void {
    if (disposed || input.isIdle() || manualRefreshPending.value) return
    if (pages.value.at(-1)?.pending) return
    const lastResult = getLastLoadedPaginationResult(firstPage(), pages.value)
    if (!lastResult || lastResult.isDone) return
    const page = createPendingPaginationPage<Item>({
      numItems,
      cursor: lastResult.continueCursor,
      id: generation.value,
    })
    pages.value = [...pages.value, page]
    const index = pages.value.length - 1
    const operation = fence.capture()
    if (input.isLive() && input.getClient()) {
      subscribePage(index)
      return
    }
    void fetchForOperation(page.paginationOpts, operation)
      .then((result) => {
        if (!result || !fence.isCurrent(operation) || pages.value[index] !== page) return
        pages.value = commitPaginationPageResult(pages.value, index, result)
      })
      .catch((cause) => {
        if (!fence.isCurrent(operation) || pages.value[index] !== page) return
        pages.value = commitPaginationPageError(pages.value, index, cause)
      })
  }

  async function refresh(): Promise<void> {
    if (disposed || input.isIdle() || manualRefreshPending.value) return
    manualRefreshPending.value = true
    input.setBoundaryError(null, input.getBoundaryKey())
    const loadedPages = [...pages.value]
    const operation = fence.capture()
    try {
      const firstResult = await fetchForOperation(initialOptions.value, operation)
      if (!firstResult) return
      const refreshed: PaginationPageState<Item>[] = []
      let previous = firstResult
      for (let index = 0; index < loadedPages.length; index += 1) {
        if (previous.isDone) break
        const page = loadedPages[index]
        if (!page) continue
        const result = await fetchForOperation(
          {
            numItems: page.paginationOpts.numItems,
            cursor: previous.continueCursor,
            id: page.paginationOpts.id,
          },
          operation,
        )
        if (!result) return
        const cursor = previous.continueCursor
        refreshed.push({
          ...page,
          paginationOpts:
            cursor === page.paginationOpts.cursor
              ? page.paginationOpts
              : { ...page.paginationOpts, cursor },
          result,
          error: null,
          pending: false,
        })
        previous = result
      }
      if (!fence.isCurrent(operation) || pages.value.length !== loadedPages.length) return
      for (const retiredPage of loadedPages.slice(refreshed.length)) retiredPage.unsubscribe?.()
      firstPageRealtime.value = firstResult
      pages.value = refreshed
      if (input.isLive()) {
        for (let index = 0; index < refreshed.length; index += 1) {
          if (
            loadedPages[index]?.paginationOpts.cursor !== refreshed[index]?.paginationOpts.cursor
          ) {
            subscribePage(index)
          }
        }
      }
      input.setBoundaryError(null, operation.boundaryKey)
    } catch (cause) {
      if (fence.isCurrent(operation)) {
        input.setBoundaryError(normalizeConvexError(cause), operation.boundaryKey)
      }
    } finally {
      if (fence.isCurrent(operation)) manualRefreshPending.value = false
    }
  }

  async function reset(): Promise<void> {
    if (disposed) return
    fence.invalidate()
    manualRefreshPending.value = true
    teardownSubscriptions()
    firstPageRealtime.value = null
    generation.value = createPaginationGeneration()
    pages.value = []
    input.setBoundaryError(null, input.getBoundaryKey())
    try {
      await input.refreshBoundary()
    } finally {
      manualRefreshPending.value = false
    }
    if (!disposed && input.isLive()) subscribeFirstPage()
  }

  function handleIdentityBoundary(boundary: {
    nextTag: QueryIsolationTag
    previousTag: QueryIsolationTag
    previousBoundaryKey: string
  }): void {
    if (sameTag(boundary.nextTag, boundary.previousTag)) return
    fence.invalidate()
    teardownSubscriptions()
    generation.value = createPaginationGeneration()
    manualRefreshPending.value = false
    firstPageRealtime.value = null
    pages.value = []
    input.setBoundaryError(null, boundary.previousBoundaryKey)
    lastSettledResults.value = []
    lastSettledArgsHash.value = null
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
      fence.invalidate()
      manualRefreshPending.value = false
      subscribeFirstPage()
      return
    }
    fence.invalidate()
    manualRefreshPending.value = false
    input.setBoundaryError(null, boundary.previousBoundaryKey)
    teardownSubscriptions()
    firstPageRealtime.value = null
    if (input.isIdle()) {
      pages.value = []
      input.setBoundaryError(null, input.getBoundaryKey())
      return
    }
    generation.value = createPaginationGeneration()
    pages.value = []
    input.setBoundaryError(null, input.getBoundaryKey())
    if (boundary.nextLive) subscribeFirstPage()
    await input.refreshBoundary()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    fence.invalidate()
    teardownSubscriptions()
    stopSettledWatch?.()
    stopSettledWatch = null
  }

  return {
    generation,
    initialOptions,
    pages,
    results,
    status,
    isLoading,
    isStale,
    hasNextPage,
    error,
    start,
    captureOperation: fence.capture,
    isOperationCurrent: fence.isCurrent,
    fetchForOperation,
    subscribeFirstPage,
    loadMore,
    refresh,
    reset,
    handleIdentityBoundary,
    handleExecutionBoundary,
    dispose,
  }
}
