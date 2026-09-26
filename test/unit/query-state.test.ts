import { describe, expect, it } from 'vitest'

import {
  computePaginationStale,
  computePaginationStatus,
  type PaginationStatusState,
} from '../../packages/vue/src/internal/pagination-state'

const readyPaginatedState: PaginationStatusState = {
  disabled: false,
  refreshing: false,
  firstPageError: false,
  firstPageReady: true,
}

describe('query state helpers', () => {
  describe('computePaginationStatus', () => {
    it('returns idle when the gate does not run the list', () => {
      expect(computePaginationStatus({ ...readyPaginatedState, disabled: true })).toBe('idle')
    })

    it('prioritizes manual refresh loading before existing data state', () => {
      expect(computePaginationStatus({ ...readyPaginatedState, refreshing: true })).toBe('pending')
    })

    it('returns error only for a first-page or auth-gate error', () => {
      expect(computePaginationStatus({ ...readyPaginatedState, firstPageError: true })).toBe(
        'error',
      )
      expect(
        computePaginationStatus({
          ...readyPaginatedState,
          disabled: true,
          firstPageError: true,
        }),
      ).toBe('error')
    })

    it('reports first-page loading until the first page is ready', () => {
      expect(computePaginationStatus({ ...readyPaginatedState, firstPageReady: false })).toBe(
        'pending',
      )
    })

    it('describes the first page only, so later pages never leave success', () => {
      expect(computePaginationStatus(readyPaginatedState)).toBe('success')
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
