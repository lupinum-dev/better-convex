import type { FunctionReference, PaginationResult } from 'convex/server'
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
} from './pagination-state'
import type { QueryIsolationTag, QuerySubscriptionClient } from './query-controller'

export interface PaginationControllerInput<Item> {
  query: FunctionReference<'query'>
  initialNumItems: number
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
  generation: Readonly<Ref<number>>
  initialOptions: ComputedRef<PaginationPageOptions>
  pages: Readonly<Ref<PaginationPageState<Item>[]>>
  data: ComputedRef<readonly Item[] | undefined>
  status: ComputedRef<PaginationStatus>
  pending: ComputedRef<boolean>
  isStale: ComputedRef<boolean>
  canLoadMore: ComputedRef<boolean>
  error: ComputedRef<ConvexCallError | undefined>
  start(): void
  captureOperation(): PaginationOperationContext
  isOperationCurrent(operation: PaginationOperationContext): boolean
  fetchForOperation(
    options: PaginationPageOptions,
    operation: PaginationOperationContext,
  ): Promise<PaginationResult<Item> | null>
  firstPageSettled(): Promise<void>
  loadMore(numItems: number): void
  refresh(): Promise<void>
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
    { page: PaginationPageState<Item>; received: PaginationResult<Item> | null },
    { page: PaginationPageState<Item>; received: PaginationResult<Item> | null },
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

  const visiblePage = (result: PaginationResult<Item> | null | undefined) =>
    result?.pageStatus === 'SplitRequired' ? null : (result ?? null)

  const firstPage = () =>
    firstPageWithheld.value
      ? null
      : (visiblePage(firstPageRealtime.value) ?? visiblePage(input.getBoundaryFirstPage()))

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

  function isSplitResult(result: PaginationResult<Item>): result is PaginationResult<Item> & {
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
      error: undefined,
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

    input.setBoundaryError(undefined, split.operation.boundaryKey)
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
        const result = raw as PaginationResult<Item>
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
    result: PaginationResult<Item>,
  ): void {
    if (disposed) return
    if (!input.isLive()) {
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
            { ...page, result: undefined, error: undefined, pending: true },
            ...pages.value.slice(index + 1),
          ]
        }
      }
    }

    subscribeSplitPart(split, 0)
    subscribeSplitPart(split, 1)
  }

  function acceptFirstPageResult(
    result: PaginationResult<Item>,
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
    input.setBoundaryError(undefined, operation.boundaryKey)
    if (result.pageStatus === 'SplitRecommended') beginPageSplit('first', result)
    settleFirstPageIfTerminal()
  }

  function acceptPageResult(
    pageOptions: PaginationPageOptions,
    result: PaginationResult<Item>,
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
    input.setBoundaryError(undefined, input.getBoundaryKey())
    if (result.pageStatus === 'SplitRecommended') beginPageSplit(pageOptions, result)
  }

  function subscribeFirstPage(options = initialOptions.value): void {
    if (disposed || firstPageUnsubscribe || !input.isLive()) return
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
        acceptFirstPageResult(raw as PaginationResult<Item>, operation)
      },
      (error) => {
        if (!fence.isCurrent(operation)) return
        input.setBoundaryError(normalizeConvexError(error), operation.boundaryKey)
        settleFirstPageIfTerminal()
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
    const unsubscribe = client.onUpdate(
      input.query,
      { ...args, paginationOpts: page.paginationOpts },
      (raw) => {
        if (!fence.isCurrent(operation)) return
        acceptPageResult(pageOptions, raw as PaginationResult<Item>)
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

  const status = computed<PaginationStatus>(() => {
    const currentFirstPage = firstPage()
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
        input.getBoundaryError() !== undefined ||
        pages.value.some((page) => page.error !== undefined),
      firstPage: firstPageState,
      nextPage: nextPageState,
    })
  })

  const currentData = computed<readonly Item[] | undefined>(() => {
    if (input.isIdle()) return undefined
    const items: Item[] = []
    const currentFirstPage = firstPage()
    if (currentFirstPage) items.push(...currentFirstPage.page)
    for (const page of pages.value) if (page.result) items.push(...page.result.page)
    if (currentFirstPage || pages.value.some((page) => page.result !== undefined)) return items
    return undefined
  })

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
  const canLoadMore = computed(() => {
    if (status.value !== 'success') return false
    return getLastLoadedPaginationResult(firstPage(), pages.value)?.isDone === false
  })
  const error = computed<ConvexCallError | undefined>(() => {
    const boundaryError = input.getBoundaryError()
    if (boundaryError) return boundaryError
    return pages.value.find((page) => page.error)?.error
  })

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

  function boundLastLoadedPage(endCursor: string | null): void {
    if (!input.isLive()) return
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
    if (!Number.isSafeInteger(numItems) || numItems < 1) {
      throw new Error('[better-convex-vue] loadMore numItems must be a positive safe integer')
    }
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
            { ...page, result: undefined, error: undefined, pending: false },
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
    input.setBoundaryError(undefined, input.getBoundaryKey())
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
        result: PaginationResult<Item>
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
          error: undefined,
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
      input.setBoundaryError(undefined, operation.boundaryKey)
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
    input.setBoundaryError(undefined, boundary.previousBoundaryKey)
    lastSettledResults.value = undefined
    if (input.isLive()) subscribeFirstPage()
    else settleFirstPageIfTerminal()
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
    input.setBoundaryError(undefined, boundary.previousBoundaryKey)
    teardownSubscriptions()
    firstPageRealtime.value = null
    firstPageWithheld.value = false
    if (input.isIdle()) {
      pages.value = []
      lastSettledResults.value = undefined
      input.setBoundaryError(undefined, input.getBoundaryKey())
      settleFirstPageIfTerminal()
      return
    }
    generation.value = createPaginationGeneration()
    pages.value = []
    input.setBoundaryError(undefined, input.getBoundaryKey())
    if (boundary.nextLive) subscribeFirstPage()
    else settleFirstPageIfTerminal()
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
    data,
    status,
    pending,
    isStale,
    canLoadMore,
    error,
    start,
    captureOperation: fence.capture,
    isOperationCurrent: fence.isCurrent,
    fetchForOperation,
    firstPageSettled,
    loadMore,
    refresh,
    handleIdentityBoundary,
    handleExecutionBoundary,
    dispose,
  }
}
