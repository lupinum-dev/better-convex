import type { PaginationResult } from 'convex/server'
import { describe, expect, it, vi } from 'vitest'

import { ConvexCallError } from '../../packages/vue/src/errors'
import {
  commitPaginationPageError,
  commitPaginationPageResult,
  createPaginationGeneration,
  createPaginationOperationFence,
  createPendingPaginationPage,
  getLastLoadedPaginationResult,
  type PaginationPageState,
} from '../../packages/vue/src/internal/pagination-state'

function pageResult<T>(page: T[], isDone = false): PaginationResult<T> {
  return {
    page,
    isDone,
    continueCursor: isDone ? '' : 'next',
    splitCursor: null,
    pageStatus: isDone ? null : 'SplitRequired',
  }
}

describe('paginated query page state', () => {
  it('creates positive safe cache-busting generations', () => {
    const generations = Array.from({ length: 4 }, () => createPaginationGeneration())
    expect(generations.every((value) => Number.isSafeInteger(value) && value > 0)).toBe(true)
    expect(new Set(generations).size).toBe(generations.length)
  })

  it('rejects operations after args, generation, identity, invalidation, or disposal changes', () => {
    let argsHash = 'a'
    let boundaryKey = 'key:a'
    let generation = 1
    let identityGeneration = 1
    let disposed = false
    const fence = createPaginationOperationFence({
      getArgsHash: () => argsHash,
      getBoundaryKey: () => boundaryKey,
      getPaginationGeneration: () => generation,
      getIsolationTag: () => ({ identityKey: 'user:alice', identityGeneration }),
      isDisposed: () => disposed,
    })

    const argsOperation = fence.capture()
    argsHash = 'b'
    boundaryKey = 'key:b'
    expect(fence.isCurrent(argsOperation)).toBe(false)

    const generationOperation = fence.capture()
    generation += 1
    expect(fence.isCurrent(generationOperation)).toBe(false)

    const identityOperation = fence.capture()
    identityGeneration += 1
    expect(fence.isCurrent(identityOperation)).toBe(false)

    const invalidatedOperation = fence.capture()
    fence.invalidate()
    expect(fence.isCurrent(invalidatedOperation)).toBe(false)

    const disposedOperation = fence.capture()
    disposed = true
    expect(fence.isCurrent(disposedOperation)).toBe(false)
  })

  it('creates a pending page with no result or error', () => {
    const pending = createPendingPaginationPage({ numItems: 10, cursor: 'c1', id: 7 })

    expect(pending).toMatchObject({
      paginationOpts: { numItems: 10, cursor: 'c1', id: 7 },
      result: undefined,
      error: null,
      pending: true,
      unsubscribe: null,
    })
  })

  it('commits results immutably while preserving unsubscribe handles', () => {
    const unsubscribe = vi.fn()
    const pages: PaginationPageState<string>[] = [
      { ...createPendingPaginationPage({ numItems: 1, cursor: 'a', id: 1 }), unsubscribe },
    ]
    const result = pageResult(['a'])

    const nextPages = commitPaginationPageResult(pages, 0, result)

    expect(nextPages).not.toBe(pages)
    expect(nextPages[0]).toMatchObject({
      result,
      error: null,
      pending: false,
      unsubscribe,
    })
    expect(pages[0]?.pending).toBe(true)
  })

  it('commits errors immutably without dropping existing page results', () => {
    const result = pageResult(['a'])
    const pages = commitPaginationPageResult(
      [createPendingPaginationPage<string>({ numItems: 1, cursor: 'a', id: 1 })],
      0,
      result,
    )
    const error = new Error('boom')

    const nextPages = commitPaginationPageError(pages, 0, error)

    expect(nextPages).not.toBe(pages)
    expect(nextPages[0]?.result).toBe(result)
    // Page errors are normalized to ConvexCallError at the boundary ;
    // a plain Error stays opaque `unknown`; the raw error is not retained on the
    // public error object.
    expect(nextPages[0]?.error).toBeInstanceOf(ConvexCallError)
    expect(nextPages[0]?.error?.kind).toBe('unknown')
    expect(nextPages[0]?.error?.message).toBe('Unknown Convex error')
    expect('cause' in nextPages[0]!.error!).toBe(false)
    expect(nextPages[0]?.pending).toBe(false)
  })

  it('returns the first page until additional pages exist and ignores pending tails', () => {
    const firstPage = pageResult(['first'])
    const loadedPage = {
      ...createPendingPaginationPage<string>({ numItems: 1, cursor: 'b', id: 1 }),
      result: pageResult(['second']),
      pending: false,
    }
    const pendingPage = createPendingPaginationPage<string>({ numItems: 1, cursor: 'c', id: 1 })

    expect(getLastLoadedPaginationResult(firstPage, [])).toBe(firstPage)
    expect(getLastLoadedPaginationResult(firstPage, [loadedPage])).toBe(loadedPage.result)
    expect(getLastLoadedPaginationResult(firstPage, [loadedPage, pendingPage])).toBeUndefined()
  })
})
