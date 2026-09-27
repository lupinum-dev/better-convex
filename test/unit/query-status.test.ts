import { describe, expect, it } from 'vitest'

import { deriveQueryStatus } from '../../packages/vue/src/internal/query-status'

describe('deriveQueryStatus (one owner for browser and SSR status)', () => {
  it('orders pending, then error, then data, then idle', () => {
    expect(deriveQueryStatus({ pending: true, error: true, hasData: true })).toBe('pending')
    expect(deriveQueryStatus({ pending: false, error: true, hasData: true })).toBe('error')
    expect(deriveQueryStatus({ pending: false, error: false, hasData: true })).toBe('success')
    expect(deriveQueryStatus({ pending: false, error: false, hasData: false })).toBe('idle')
  })

  it('never reports success without data', () => {
    for (const pending of [false, true]) {
      for (const error of [false, true]) {
        expect(deriveQueryStatus({ pending, error, hasData: false })).not.toBe('success')
      }
    }
  })
})
