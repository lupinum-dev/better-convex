import { describe, expect, it } from 'vitest'

import { isIncompletePaginationPage } from '../../src/runtime/utils/ssr-pagination-state'

describe('SSR pagination status', () => {
  it('withholds only pages that Convex marks potentially incomplete', () => {
    expect(isIncompletePaginationPage({ pageStatus: 'SplitRequired' })).toBe(true)
    expect(isIncompletePaginationPage({ pageStatus: 'SplitRecommended' })).toBe(false)
    expect(isIncompletePaginationPage({ pageStatus: null })).toBe(false)
    expect(isIncompletePaginationPage({})).toBe(false)
  })
})
