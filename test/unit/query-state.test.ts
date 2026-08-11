import { describe, expect, it } from 'vitest'

import {
  computePaginationStale,
  computePaginationStatus,
  type PaginationStatusState,
} from '../../packages/vue/src/internal/pagination-state'
import { computeConvexQueryPending } from '../../src/runtime/utils/query-state'

const readyPaginatedState: PaginationStatusState = {
  disabled: false,
  refresh: 'idle',
  hasError: false,
  firstPage: { state: 'ready', isDone: false },
  nextPage: { state: 'idle' },
}

describe('query state helpers', () => {
  describe('computeConvexQueryPending', () => {
    it('is never pending when skipped', () => {
      expect(
        computeConvexQueryPending({
          isSkipped: true,
          hasData: false,
          hasSettled: false,
          server: false,
          resolveImmediately: true,
          isServer: true,
          isClient: false,
          asyncDataPending: true,
        }),
      ).toBe(false)
    })

    it('stays pending on the server when server fetching is disabled', () => {
      expect(
        computeConvexQueryPending({
          isSkipped: false,
          hasData: false,
          hasSettled: false,
          server: false,
          resolveImmediately: false,
          isServer: true,
          isClient: false,
          asyncDataPending: false,
        }),
      ).toBe(true)
    })

    it('stays pending for immediate client consumers until data settles', () => {
      expect(
        computeConvexQueryPending({
          isSkipped: false,
          hasData: false,
          hasSettled: false,
          server: true,
          resolveImmediately: true,
          isServer: false,
          isClient: true,
          asyncDataPending: false,
        }),
      ).toBe(true)
    })

    it('falls back to Nuxt async data pending after data exists', () => {
      expect(
        computeConvexQueryPending({
          isSkipped: false,
          hasData: true,
          hasSettled: true,
          server: true,
          resolveImmediately: true,
          isServer: false,
          isClient: true,
          asyncDataPending: false,
        }),
      ).toBe(false)
    })
  })

  describe('computePaginationStatus', () => {
    it('returns idle when skipped', () => {
      expect(computePaginationStatus({ ...readyPaginatedState, disabled: true })).toBe('idle')
    })

    it('prioritizes manual refresh loading before existing data state', () => {
      expect(
        computePaginationStatus({
          ...readyPaginatedState,
          refresh: 'pending',
        }),
      ).toBe('pending')
    })

    it('returns error for any query error', () => {
      expect(computePaginationStatus({ ...readyPaginatedState, hasError: true })).toBe('error')
      expect(
        computePaginationStatus({
          ...readyPaginatedState,
          disabled: true,
          hasError: true,
        }),
      ).toBe('error')
    })

    it('reports first-page loading until the first page is ready', () => {
      expect(
        computePaginationStatus({
          ...readyPaginatedState,
          firstPage: { state: 'loading' },
        }),
      ).toBe('pending')
    })

    it('collapses ready and exhausted pages into success while work stays pending', () => {
      expect(computePaginationStatus(readyPaginatedState)).toBe('success')
      expect(
        computePaginationStatus({ ...readyPaginatedState, nextPage: { state: 'loading' } }),
      ).toBe('pending')
      expect(
        computePaginationStatus({ ...readyPaginatedState, nextPage: { state: 'exhausted' } }),
      ).toBe('success')
      expect(
        computePaginationStatus({
          ...readyPaginatedState,
          firstPage: { state: 'ready', isDone: true },
        }),
      ).toBe('success')
    })

    it('keeps a first-page-only exhausted result out of loading-more', () => {
      expect(
        computePaginationStatus({
          ...readyPaginatedState,
          firstPage: { state: 'ready', isDone: true },
          nextPage: { state: 'loading' },
        }),
      ).toBe('pending')
    })
  })

  describe('computePaginationStale', () => {
    it('is stale only when previous rows are shown during first-page reload', () => {
      expect(
        computePaginationStale({
          keepPreviousData: true,
          status: 'pending',
          hasCurrentData: false,
          hasLastSettledData: true,
        }),
      ).toBe(true)

      expect(
        computePaginationStale({
          keepPreviousData: true,
          status: 'success',
          hasCurrentData: false,
          hasLastSettledData: true,
        }),
      ).toBe(false)
    })
  })
})
