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

export interface PaginationPageState<T> {
  paginationOpts: PaginationPageOptions
  result: PaginationResult<T> | undefined
  error: ConvexCallError | undefined
  pending: boolean
  unsubscribe: (() => void) | null
}

export function createPendingPaginationPage<T>(
  paginationOpts: PaginationPageOptions,
): PaginationPageState<T> {
  return {
    paginationOpts,
    result: undefined,
    error: undefined,
    pending: true,
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
    pending: false,
  }
  return nextPages
}

export function commitPaginationPageError<T>(
  pages: PaginationPageState<T>[],
  pageIndex: number,
  error: unknown,
): PaginationPageState<T>[] {
  const page = pages[pageIndex]
  if (!page) return pages

  const nextPages = [...pages]
  nextPages[pageIndex] = {
    ...page,
    error: normalizeConvexError(error),
    pending: false,
  }
  return nextPages
}

export function getLastLoadedPaginationResult<T>(
  firstPage: PaginationResult<T> | null | undefined,
  additionalPages: PaginationPageState<T>[],
): PaginationResult<T> | undefined {
  const lastPage = additionalPages[additionalPages.length - 1]
  if (!lastPage) return firstPage ?? undefined
  if (lastPage.pending) return undefined
  return lastPage.result
}

export type PaginationStatus = 'idle' | 'pending' | 'success' | 'error'

export type PaginationFirstPageState = { state: 'loading' } | { state: 'ready'; isDone: boolean }

export type PaginationNextPageState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'exhausted' }

export interface PaginationStatusState {
  disabled: boolean
  refresh: 'idle' | 'pending'
  hasError: boolean
  firstPage: PaginationFirstPageState
  nextPage: PaginationNextPageState
}

export function computePaginationStatus(input: PaginationStatusState): PaginationStatus {
  if (input.hasError) return 'error'
  if (input.disabled) return 'idle'
  if (
    input.refresh === 'pending' ||
    input.firstPage.state === 'loading' ||
    input.nextPage.state === 'loading'
  )
    return 'pending'
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
