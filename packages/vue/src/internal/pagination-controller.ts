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
  firstPageSettled(): Promise<void>
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

interface PendingPageSplit<Item> {
  target: 'first' | PaginationPageOptions
  operation: PaginationOperationContext
  required: boolean
  parts: [
    { page: PaginationPageState<Item>; received: BetterPaginationResult<Item> | null },
    { page: PaginationPageState<Item>; received: BetterPaginationResult<Item> | null },
  ]
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

export function createPaginationController<Item, TransformedItem = Item>(
  input: PaginationControllerInput<Item, TransformedItem>,
): PaginationController<Item, TransformedItem> {
  const generation = shallowRef(createPaginationGeneration())
  const pages = shallowRef<PaginationPageState<Item>[]>([])
  const firstPageRealtime = shallowRef<BetterPaginationResult<Item> | null>(null)
  const firstPageOptions = shallowRef<PaginationPageOptions | null>(null)
  const firstPageWithheld = shallowRef(false)
  const manualRefreshPending = shallowRef(false)
  const lastSettledResults = shallowRef<TransformedItem[]>([])
  const lastSettledArgsHash = shallowRef<string | null>(null)
  let firstPageUnsubscribe: (() => void) | null = null
  let pendingFirstPageSettlement: FirstPageSettlement | null = null
  let stopSettledWatch: (() => void) | null = null
  const pendingSplits: PendingPageSplit<Item>[] = []
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

  const visiblePage = (result: BetterPaginationResult<Item> | null | undefined) =>
    result?.pageStatus === 'SplitRequired' ? null : (result ?? null)

  const firstPage = () =>
    firstPageWithheld.value
      ? null
      : (visiblePage(firstPageRealtime.value) ?? visiblePage(input.getBoundaryFirstPage()))

  function settleFirstPageIfTerminal(): void {
    if (
      !pendingFirstPageSettlement ||
      (!disposed && !input.isIdle() && firstPage() === null && input.getBoundaryError() === null)
    )
      return
    pendingFirstPageSettlement.resolve()
    pendingFirstPageSettlement = null
  }

  function firstPageSettled(): Promise<void> {
    if (disposed || input.isIdle() || firstPage() !== null || input.getBoundaryError() !== null)
      return Promise.resolve()
    pendingFirstPageSettlement ??= deferredSettlement()
    return pendingFirstPageSettlement.promise
  }

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

  function isSplitResult(
    result: BetterPaginationResult<Item>,
  ): result is BetterPaginationResult<Item> & {
    splitCursor: string
    pageStatus: 'SplitRecommended' | 'SplitRequired'
  } {
    return (
      typeof result.splitCursor === 'string' &&
      (result.pageStatus === 'SplitRecommended' || result.pageStatus === 'SplitRequired')
    )
  }

  function removePendingSplit(split: PendingPageSplit<Item>): void {
    const index = pendingSplits.indexOf(split)
    if (index >= 0) pendingSplits.splice(index, 1)
  }

  function failPendingSplit(split: PendingPageSplit<Item>, error: unknown): void {
    if (!fence.isCurrent(split.operation)) return
    for (const part of split.parts) part.page.unsubscribe?.()
    removePendingSplit(split)
    input.setBoundaryError(normalizeConvexError(error), split.operation.boundaryKey)
    if (split.target === 'first') settleFirstPageIfTerminal()
  }

  function finishPendingSplit(split: PendingPageSplit<Item>): void {
    if (!fence.isCurrent(split.operation) || split.parts.some((part) => part.received === null))
      return

    removePendingSplit(split)
    const promoted = split.parts.map(({ page, received }) => ({
      ...page,
      result: visiblePage(received!) ?? undefined,
      error: null,
      pending: received!.pageStatus === 'SplitRequired',
    })) as [PaginationPageState<Item>, PaginationPageState<Item>]

    if (split.target === 'first') {
      firstPageUnsubscribe?.()
      firstPageOptions.value = promoted[0].paginationOpts
      firstPageUnsubscribe = promoted[0].unsubscribe
      firstPageRealtime.value = promoted[0].result ?? null
      firstPageWithheld.value = promoted[0].pending
      pages.value = [promoted[1], ...pages.value]
    } else {
      const index = pages.value.findIndex((candidate) => candidate.paginationOpts === split.target)
      if (index < 0) {
        for (const page of promoted) page.unsubscribe?.()
        return
      }
      pages.value[index]?.unsubscribe?.()
      pages.value = [...pages.value.slice(0, index), ...promoted, ...pages.value.slice(index + 1)]
    }

    input.setBoundaryError(null, split.operation.boundaryKey)
    const firstResult = split.parts[0].received!
    const secondResult = split.parts[1].received!
    const promotedFirstTarget = split.target === 'first' ? 'first' : promoted[0].paginationOpts
    if (firstResult.pageStatus === 'SplitRecommended' || firstResult.pageStatus === 'SplitRequired')
      beginPageSplit(promotedFirstTarget, firstResult)
    if (
      secondResult.pageStatus === 'SplitRecommended' ||
      secondResult.pageStatus === 'SplitRequired'
    )
      beginPageSplit(promoted[1].paginationOpts, secondResult)
    if (split.target === 'first') settleFirstPageIfTerminal()
  }

  function subscribeSplitPart(split: PendingPageSplit<Item>, partIndex: 0 | 1): void {
    const client = input.getClient()
    const args = input.getArgs()
    if (!client || args === 'skip') return
    const part = split.parts[partIndex]
    const unsubscribe = client.onUpdate(
      input.query,
      { ...args, paginationOpts: part.page.paginationOpts },
      (raw) => {
        if (!fence.isCurrent(split.operation)) return
        const result = raw as BetterPaginationResult<Item>
        if (pendingSplits.includes(split)) {
          part.received = result
          finishPendingSplit(split)
          return
        }
        if (
          split.target === 'first' &&
          partIndex === 0 &&
          firstPageOptions.value === part.page.paginationOpts
        ) {
          acceptFirstPageResult(result, split.operation)
          return
        }
        acceptPageResult(part.page.paginationOpts, result)
      },
      (error) => {
        if (!fence.isCurrent(split.operation)) return
        if (pendingSplits.includes(split)) {
          failPendingSplit(split, error)
          return
        }
        if (
          split.target === 'first' &&
          partIndex === 0 &&
          firstPageOptions.value === part.page.paginationOpts
        ) {
          input.setBoundaryError(normalizeConvexError(error), split.operation.boundaryKey)
          return
        }
        const index = pages.value.findIndex(
          (candidate) => candidate.paginationOpts === part.page.paginationOpts,
        )
        if (index >= 0) pages.value = commitPaginationPageError(pages.value, index, error)
      },
    )
    part.page.unsubscribe = unsubscribe
  }

  function beginPageSplit(
    target: 'first' | PaginationPageOptions,
    result: BetterPaginationResult<Item>,
  ): void {
    if (disposed) return
    if (!input.subscribe || !input.isLive()) {
      if (result.pageStatus === 'SplitRequired') {
        input.setBoundaryError(
          normalizeConvexError(
            new Error(
              '[better-convex-vue] SplitRequired pagination result needs a live bounded split',
            ),
          ),
          input.getBoundaryKey(),
        )
        if (target === 'first') settleFirstPageIfTerminal()
      }
      return
    }
    if (pendingSplits.some((split) => split.target === target)) return
    if (!isSplitResult(result)) {
      if (result.pageStatus === 'SplitRequired') {
        input.setBoundaryError(
          normalizeConvexError(
            new Error('[better-convex-vue] SplitRequired pagination result has no split cursor'),
          ),
          input.getBoundaryKey(),
        )
        if (target === 'first') settleFirstPageIfTerminal()
      }
      return
    }

    const targetOptions =
      target === 'first'
        ? (firstPageOptions.value ?? initialOptions.value)
        : pages.value.find((page) => page.paginationOpts === target)?.paginationOpts
    if (!targetOptions) return

    const firstOptions: PaginationPageOptions = {
      ...targetOptions,
      endCursor: result.splitCursor,
    }
    const secondOptions: PaginationPageOptions = {
      ...targetOptions,
      cursor: result.splitCursor,
      endCursor: result.continueCursor,
    }
    const split: PendingPageSplit<Item> = {
      target,
      operation: fence.capture(),
      required: result.pageStatus === 'SplitRequired',
      parts: [
        { page: createPendingPaginationPage(firstOptions), received: null },
        { page: createPendingPaginationPage(secondOptions), received: null },
      ],
    }
    pendingSplits.push(split)

    if (split.required) {
      if (target === 'first') {
        firstPageWithheld.value = true
        firstPageRealtime.value = null
      } else {
        const index = pages.value.findIndex((page) => page.paginationOpts === target)
        if (index >= 0) {
          const page = pages.value[index]!
          pages.value = [
            ...pages.value.slice(0, index),
            { ...page, result: undefined, error: null, pending: true },
            ...pages.value.slice(index + 1),
          ]
        }
      }
    }

    subscribeSplitPart(split, 0)
    subscribeSplitPart(split, 1)
  }

  function acceptFirstPageResult(
    result: BetterPaginationResult<Item>,
    operation: PaginationOperationContext,
  ): void {
    if (result.pageStatus === 'SplitRequired') {
      beginPageSplit('first', result)
      return
    }
    const previous = firstPage()
    if (previous && previous.continueCursor !== result.continueCursor && pages.value.length > 0)
      retirePagesFrom(0)
    firstPageWithheld.value = false
    firstPageRealtime.value = result
    input.setBoundaryError(null, operation.boundaryKey)
    if (result.pageStatus === 'SplitRecommended') beginPageSplit('first', result)
    settleFirstPageIfTerminal()
  }

  function acceptPageResult(
    pageOptions: PaginationPageOptions,
    result: BetterPaginationResult<Item>,
  ): void {
    const index = pages.value.findIndex((candidate) => candidate.paginationOpts === pageOptions)
    if (index < 0) return
    if (result.pageStatus === 'SplitRequired') {
      beginPageSplit(pageOptions, result)
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
    input.setBoundaryError(null, input.getBoundaryKey())
    if (result.pageStatus === 'SplitRecommended') beginPageSplit(pageOptions, result)
  }

  function subscribeFirstPage(options = initialOptions.value): void {
    if (disposed || firstPageUnsubscribe || !input.subscribe || !input.isLive()) return
    const client = input.getClient()
    const args = input.getArgs()
    if (!client || args === 'skip') return
    const operation = fence.capture()
    firstPageOptions.value = options
    firstPageUnsubscribe = client.onUpdate(
      input.query,
      { ...args, paginationOpts: options },
      (raw) => {
        if (!fence.isCurrent(operation)) return
        acceptFirstPageResult(raw as BetterPaginationResult<Item>, operation)
      },
      (error) => {
        if (!fence.isCurrent(operation)) return
        input.setBoundaryError(normalizeConvexError(error), operation.boundaryKey)
        settleFirstPageIfTerminal()
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
        acceptPageResult(pageOptions, raw as BetterPaginationResult<Item>)
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
    firstPageOptions.value = null
    for (const split of pendingSplits.splice(0)) {
      for (const part of split.parts) part.page.unsubscribe?.()
    }
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
    if (input.isLive()) subscribeFirstPage()
  }

  function boundLastLoadedPage(endCursor: string | null): void {
    if (!input.isLive() || !input.subscribe) return
    const lastIndex = pages.value.length - 1
    if (lastIndex < 0) {
      const options = firstPageOptions.value ?? initialOptions.value
      if (options.endCursor === endCursor) return
      firstPageUnsubscribe?.()
      firstPageUnsubscribe = null
      subscribeFirstPage({ ...options, endCursor })
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
    if (disposed || input.isIdle() || manualRefreshPending.value) return
    if (pages.value.at(-1)?.pending) return
    const lastResult = getLastLoadedPaginationResult(firstPage(), pages.value)
    if (!lastResult || lastResult.isDone) return
    boundLastLoadedPage(lastResult.continueCursor)
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
        if (result.pageStatus === 'SplitRequired') {
          pages.value = [
            ...pages.value.slice(0, index),
            { ...page, result: undefined, error: null, pending: false },
            ...pages.value.slice(index + 1),
          ]
          beginPageSplit(page.paginationOpts, result)
          return
        }
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
      const firstResult = await fetchForOperation(
        firstPageOptions.value ?? initialOptions.value,
        operation,
      )
      if (!firstResult) return
      const refreshed: PaginationPageState<Item>[] = []
      const splitResults: Array<{
        options: PaginationPageOptions
        result: BetterPaginationResult<Item>
      }> = []
      let previous = firstResult
      for (let index = 0; index < loadedPages.length; index += 1) {
        if (previous.isDone || previous.pageStatus === 'SplitRequired') break
        const page = loadedPages[index]
        if (!page) continue
        const result = await fetchForOperation(
          {
            ...page.paginationOpts,
            cursor: previous.continueCursor,
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
          result: visiblePage(result) ?? undefined,
          error: null,
          pending: result.pageStatus === 'SplitRequired',
        })
        if (result.pageStatus === 'SplitRecommended' || result.pageStatus === 'SplitRequired') {
          splitResults.push({
            options: refreshed.at(-1)!.paginationOpts,
            result,
          })
        }
        previous = result
      }
      if (!fence.isCurrent(operation) || pages.value.length !== loadedPages.length) return
      for (const retiredPage of loadedPages.slice(refreshed.length)) retiredPage.unsubscribe?.()
      firstPageWithheld.value = firstResult.pageStatus === 'SplitRequired'
      firstPageRealtime.value = visiblePage(firstResult)
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
      if (
        firstResult.pageStatus === 'SplitRecommended' ||
        firstResult.pageStatus === 'SplitRequired'
      )
        beginPageSplit('first', firstResult)
      for (const split of splitResults) beginPageSplit(split.options, split.result)
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
    firstPageWithheld.value = false
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
    firstPageWithheld.value = false
    pages.value = []
    input.setBoundaryError(null, boundary.previousBoundaryKey)
    lastSettledResults.value = []
    lastSettledArgsHash.value = null
    if (input.isLive()) subscribeFirstPage()
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
    firstPageWithheld.value = false
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
    settleFirstPageIfTerminal()
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
    firstPageSettled,
    loadMore,
    refresh,
    reset,
    handleIdentityBoundary,
    handleExecutionBoundary,
    dispose,
  }
}
