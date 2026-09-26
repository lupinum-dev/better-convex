import type { PaginationResult } from 'convex/server'
import { ConvexError } from 'convex/values'
import { describe, expect, it, vi } from 'vitest'

import { ConvexCallError } from '../../packages/vue/src/errors'
import {
  commitPaginationPageError,
  commitPaginationPageResult,
  createPaginationGeneration,
  createPaginationOperationFence,
  createPendingPaginationPage,
  isInvalidCursorError,
  needsPaginationSplit,
  viewPaginationPages,
  withholdPaginationPage,
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
      error: undefined,
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
      error: undefined,
      unsubscribe,
    })
    expect(pages[0]?.result).toBeUndefined()
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
  })

  it('views contiguous pages and stops at the first page without a result', () => {
    const firstPage = pageResult(['first'])
    const loaded = (items: string[], isDone = false): PaginationPageState<string> => ({
      ...createPendingPaginationPage<string>({ numItems: 1, cursor: 'b', id: 1 }),
      result: pageResult(items, isDone),
    })
    const pendingPage = createPendingPaginationPage<string>({ numItems: 1, cursor: 'c', id: 1 })

    expect(viewPaginationPages(null, [loaded(['second'])])).toMatchObject({
      items: undefined,
      complete: false,
      loadingMore: false,
    })
    expect(viewPaginationPages(firstPage, [])).toMatchObject({
      items: ['first'],
      last: firstPage,
      complete: true,
    })
    const tail = loaded(['third'], true)
    expect(viewPaginationPages(firstPage, [loaded(['second']), tail])).toMatchObject({
      items: ['first', 'second', 'third'],
      last: tail.result,
      complete: true,
    })
    expect(viewPaginationPages(firstPage, [pendingPage, loaded(['third'])])).toMatchObject({
      items: ['first'],
      last: firstPage,
      complete: false,
      loadingMore: true,
      error: undefined,
    })
  })

  it('keeps a failed page result visible and reports the first failure', () => {
    const firstPage = pageResult(['first'])
    const failedWithResult = commitPaginationPageError(
      [
        {
          ...createPendingPaginationPage<string>({ numItems: 1, cursor: 'b', id: 1 }),
          result: pageResult(['second']),
        },
      ],
      0,
      new Error('stale'),
    )[0]!
    const failedWithoutResult = commitPaginationPageError(
      [createPendingPaginationPage<string>({ numItems: 1, cursor: 'c', id: 1 })],
      0,
      new Error('missing'),
    )[0]!

    const view = viewPaginationPages(firstPage, [failedWithResult, failedWithoutResult])
    expect(view.items).toEqual(['first', 'second'])
    expect(view.complete).toBe(false)
    expect(view.loadingMore).toBe(false)
    expect(view.error).toBe(failedWithResult.error)
  })

  it('withholds a page immutably without dropping its subscription', () => {
    const unsubscribe = vi.fn()
    const pages = commitPaginationPageResult(
      [
        {
          ...createPendingPaginationPage<string>({ numItems: 1, cursor: 'a', id: 1 }),
          unsubscribe,
        },
      ],
      0,
      pageResult(['a']),
    )

    const nextPages = withholdPaginationPage(pages, 0)

    expect(nextPages).not.toBe(pages)
    expect(nextPages[0]).toMatchObject({ result: undefined, error: undefined, unsubscribe })
    expect(pages[0]?.result?.page).toEqual(['a'])
  })

  it('applies the Convex split rule, including twice the initial page size', () => {
    const result = (length: number, extra: Partial<PaginationResult<string>>) => ({
      page: Array.from({ length }, (_, index) => `item-${index}`),
      isDone: false,
      continueCursor: 'end',
      ...extra,
    })

    expect(needsPaginationSplit(result(4, { splitCursor: 'mid' }), 2)).toBe(false)
    expect(needsPaginationSplit(result(5, { splitCursor: 'mid' }), 2)).toBe(true)
    expect(needsPaginationSplit(result(5, {}), 2)).toBe(false)
    expect(needsPaginationSplit(result(5, { splitCursor: '' }), 2)).toBe(false)
    expect(
      needsPaginationSplit(result(1, { splitCursor: 'mid', pageStatus: 'SplitRecommended' }), 2),
    ).toBe(true)
    expect(
      needsPaginationSplit(result(1, { splitCursor: null, pageStatus: 'SplitRequired' }), 2),
    ).toBe(false)
  })

  it('recognizes the invalid-cursor failures Convex resets on', () => {
    expect(isInvalidCursorError(new Error('Uncaught Error: InvalidCursor: stale'))).toBe(true)
    expect(
      isInvalidCursorError(
        new ConvexError({ isConvexSystemError: true, paginationError: 'InvalidCursor' }),
      ),
    ).toBe(true)
    expect(isInvalidCursorError(new ConvexError({ code: 'FORBIDDEN' }))).toBe(false)
    expect(isInvalidCursorError(new Error('permission denied'))).toBe(false)
    expect(isInvalidCursorError('InvalidCursor')).toBe(false)
  })
})
