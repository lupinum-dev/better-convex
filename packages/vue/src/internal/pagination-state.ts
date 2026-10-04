import type { PaginationResult } from 'convex/server'

import { normalizeConvexError, type ConvexCallError } from '../errors'
import type { QueryIsolationTag } from './query-controller'

/** Cache-busting generation; random avoids SSR-global sequential state. */
export function createPaginationGeneration(): number {
  return Math.floor(Math.random() * (Number.MAX_SAFE_INTEGER - 1)) + 1
}

export interface PaginationOperationContext extends QueryIsolationTag {
  argsHash: string
  boundaryKey: string
  paginationGeneration: number
  operationId: number
}

export function createPaginationOperationFence(input: {
  getArgsHash(): string
  getBoundaryKey(): string
  getPaginationGeneration(): number
  getIsolationTag(): QueryIsolationTag
  isDisposed(): boolean
}) {
  let operationRevision = 0

  const capture = (): PaginationOperationContext => ({
    ...input.getIsolationTag(),
    argsHash: input.getArgsHash(),
    boundaryKey: input.getBoundaryKey(),
    paginationGeneration: input.getPaginationGeneration(),
    operationId: operationRevision,
  })

  const invalidate = () => {
    operationRevision += 1
  }

  const isCurrent = (operation: PaginationOperationContext): boolean => {
    const tag = input.getIsolationTag()
    return (
      !input.isDisposed() &&
      operation.operationId === operationRevision &&
      operation.argsHash === input.getArgsHash() &&
      operation.boundaryKey === input.getBoundaryKey() &&
      operation.paginationGeneration === input.getPaginationGeneration() &&
      operation.identityKey === tag.identityKey &&
      operation.identityGeneration === tag.identityGeneration
    )
  }

  return { capture, invalidate, isCurrent }
}

export interface PaginationPageOptions {
  numItems: number
  cursor: string | null
  id: number
  endCursor?: string | null
}

/** A page is loading while it has neither a result nor an error. */
export interface PaginationPageState<T> {
  paginationOpts: PaginationPageOptions
  result: PaginationResult<T> | undefined
  error: ConvexCallError | undefined
  unsubscribe: (() => void) | null
}

export function createPendingPaginationPage<T>(
  paginationOpts: PaginationPageOptions,
): PaginationPageState<T> {
  return {
    paginationOpts,
    result: undefined,
    error: undefined,
    unsubscribe: null,
  }
}

export function commitPaginationPageResult<T>(
  pages: PaginationPageState<T>[],
  pageIndex: number,
  result: PaginationResult<T>,
): PaginationPageState<T>[] {
  const page = pages[pageIndex]
  if (!page) return pages

  const nextPages = [...pages]
  nextPages[pageIndex] = {
    ...page,
    result,
    error: undefined,
  }
  return nextPages
}

export function commitPaginationPageError<T>(
  pages: PaginationPageState<T>[],
  pageIndex: number,
  error: unknown,
  context?: { readonly functionName?: string },
): PaginationPageState<T>[] {
  const page = pages[pageIndex]
  if (!page) return pages

  const nextPages = [...pages]
  nextPages[pageIndex] = {
    ...page,
    error: normalizeConvexError(error, context),
  }
  return nextPages
}

export function assertLoadMoreNumItems(numItems: number): void {
  if (!Number.isSafeInteger(numItems) || numItems < 1) {
    throw new Error('[better-convex-vue] loadMore numItems must be a positive safe integer')
  }
}

/** Hides a page's items until bounded replacement pages settle (`SplitRequired`). */
export function withholdPaginationPage<T>(
  pages: PaginationPageState<T>[],
  pageIndex: number,
): PaginationPageState<T>[] {
  const page = pages[pageIndex]
  if (!page) return pages

  const nextPages = [...pages]
  nextPages[pageIndex] = { ...page, result: undefined, error: undefined }
  return nextPages
}

export interface PaginationPagesView<T> {
  /** Items up to the first page without a result; `undefined` until the first page is visible. */
  items: T[] | undefined
  /** The last result included in `items`. */
  last: PaginationResult<T> | undefined
  /** Every page contributed a result, so `last` is the end of the loaded list. */
  complete: boolean
  /** Concatenation stopped at a later page that is still loading or withheld. */
  loadingMore: boolean
  /** The first failure among the later pages that were reached; earlier items stay visible. */
  error: ConvexCallError | undefined
}

/**
 * Mirrors Convex `usePaginatedQuery`: concatenation stops at the first page
 * without a result, so a withheld middle page never leaves a hole in the list.
 * A failed page keeps its last result visible and reports the error separately.
 */
export function viewPaginationPages<T>(
  firstPage: PaginationResult<T> | null,
  pages: readonly PaginationPageState<T>[],
): PaginationPagesView<T> {
  if (!firstPage) {
    return {
      items: undefined,
      last: undefined,
      complete: false,
      loadingMore: false,
      error: undefined,
    }
  }
  const items = [...firstPage.page]
  let last = firstPage
  let error: ConvexCallError | undefined
  for (const page of pages) {
    error ??= page.error
    if (!page.result) {
      return { items, last, complete: false, loadingMore: page.error === undefined, error }
    }
    items.push(...page.result.page)
    last = page.result
  }
  return { items, last, complete: true, loadingMore: false, error }
}

/** Convex's split rule, including its client-side cap of twice the initial page size. */
export function needsPaginationSplit<T>(
  result: PaginationResult<T>,
  initialNumItems: number,
): result is PaginationResult<T> & { splitCursor: string } {
  return (
    typeof result.splitCursor === 'string' &&
    result.splitCursor !== '' &&
    (result.pageStatus === 'SplitRecommended' ||
      result.pageStatus === 'SplitRequired' ||
      result.page.length > initialNumItems * 2)
  )
}

/**
 * Recognizes the cursor failures Convex `usePaginatedQuery` answers by
 * resetting pagination. This only steers control flow; the public error is
 * still classified by `normalizeConvexError`.
 */
export function isInvalidCursorError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.message.includes('InvalidCursor')) return true
  const data: unknown = (error as { data?: unknown }).data
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).isConvexSystemError === true &&
    (data as Record<string, unknown>).paginationError === 'InvalidCursor'
  )
}

export type PaginationStatus = 'idle' | 'pending' | 'success' | 'error'

/** First-page facts; later pages report through `isLoadingMore` and `error` instead. */
export interface PaginationStatusState {
  /** The gate does not run the list (skipped, deferred, or blocked by auth). */
  disabled: boolean
  /** The first page or the auth gate failed. A failed later page is not a list error. */
  firstPageError: boolean
  firstPageReady: boolean
}

/**
 * The list status describes only the first page, the way a query's status
 * describes its one value: loading or failing a later page leaves it `success`.
 */
export function computePaginationStatus(input: PaginationStatusState): PaginationStatus {
  if (input.firstPageError) return 'error'
  if (input.disabled) return 'idle'
  if (!input.firstPageReady) return 'pending'
  return 'success'
}

export interface PaginationStaleInput {
  keepPreviousData: boolean
  status: PaginationStatus
  hasCurrentData: boolean
  hasLastSettledData: boolean
}

export function computePaginationStale(input: PaginationStaleInput): boolean {
  return (
    input.keepPreviousData &&
    input.status === 'pending' &&
    !input.hasCurrentData &&
    input.hasLastSettledData
  )
}
