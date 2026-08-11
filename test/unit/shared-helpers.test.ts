/**
 * Unit Tests for shared-helpers.ts
 *
 * Tests pure utility functions used across the module.
 * Fast, deterministic, no external dependencies.
 */

import { describe, it, expect } from 'vitest'

import { deepEqual, argsMatch, compareJsonValues } from '../../src/runtime/utils/shared-helpers'

// ============================================================================
// deepEqual Tests
// ============================================================================

describe('deepEqual', () => {
  describe('primitives', () => {
    it('returns true for identical strings', () => {
      expect(deepEqual('hello', 'hello')).toBe(true)
    })

    it('returns false for different strings', () => {
      expect(deepEqual('hello', 'world')).toBe(false)
    })

    it('returns true for identical numbers', () => {
      expect(deepEqual(42, 42)).toBe(true)
    })

    it('returns false for different numbers', () => {
      expect(deepEqual(42, 43)).toBe(false)
    })

    it('returns true for identical booleans', () => {
      expect(deepEqual(true, true)).toBe(true)
      expect(deepEqual(false, false)).toBe(true)
    })

    it('returns false for different booleans', () => {
      expect(deepEqual(true, false)).toBe(false)
    })

    it('returns true for same reference', () => {
      const obj = { a: 1 }
      expect(deepEqual(obj, obj)).toBe(true)
    })
  })

  describe('null and undefined', () => {
    it('returns true for null === null', () => {
      expect(deepEqual(null, null)).toBe(true)
    })

    it('returns true for undefined === undefined', () => {
      expect(deepEqual(undefined, undefined)).toBe(true)
    })

    it('returns false for null vs undefined', () => {
      expect(deepEqual(null, undefined)).toBe(false)
    })

    it('returns false for null vs value', () => {
      expect(deepEqual(null, 'hello')).toBe(false)
      expect(deepEqual('hello', null)).toBe(false)
    })
  })

  describe('arrays', () => {
    it('returns true for identical arrays', () => {
      expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    })

    it('returns false for different length arrays', () => {
      expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
    })

    it('returns false for arrays with different values', () => {
      expect(deepEqual([1, 2, 3], [1, 2, 4])).toBe(false)
    })

    it('returns true for nested arrays', () => {
      expect(
        deepEqual(
          [
            [1, 2],
            [3, 4],
          ],
          [
            [1, 2],
            [3, 4],
          ],
        ),
      ).toBe(true)
    })

    it('returns false for different nested arrays', () => {
      expect(
        deepEqual(
          [
            [1, 2],
            [3, 4],
          ],
          [
            [1, 2],
            [3, 5],
          ],
        ),
      ).toBe(false)
    })

    it('returns true for empty arrays', () => {
      expect(deepEqual([], [])).toBe(true)
    })
  })

  describe('objects', () => {
    it('returns true for identical objects', () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
    })

    it('returns false for objects with different values', () => {
      expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
    })

    it('returns false for objects with different keys', () => {
      expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false)
    })

    it('returns false for objects with different key count', () => {
      expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    })

    it('returns true for nested objects', () => {
      expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true)
    })

    it('returns false for different nested objects', () => {
      expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false)
    })

    it('returns true for empty objects', () => {
      expect(deepEqual({}, {})).toBe(true)
    })
  })

  describe('mixed types', () => {
    it('returns false for array vs object', () => {
      expect(deepEqual([1], { 0: 1 })).toBe(false)
    })

    it('returns false for number vs string', () => {
      expect(deepEqual(42, '42')).toBe(false)
    })

    it('handles complex nested structures', () => {
      const a = { users: [{ id: 1, name: 'Alice' }], count: 1 }
      const b = { users: [{ id: 1, name: 'Alice' }], count: 1 }
      expect(deepEqual(a, b)).toBe(true)
    })
  })
})

// ============================================================================
// argsMatch Tests
// ============================================================================

describe('argsMatch', () => {
  it('returns true for exact match', () => {
    expect(argsMatch({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
  })

  it('returns true for partial match (filter is subset)', () => {
    expect(argsMatch({ a: 1, b: 2, c: 3 }, { a: 1 })).toBe(true)
  })

  it('returns false when filter value differs', () => {
    expect(argsMatch({ a: 1 }, { a: 2 })).toBe(false)
  })

  it('returns false when filter key missing from query', () => {
    expect(argsMatch({ a: 1 }, { b: 1 })).toBe(false)
  })

  it('skips keys in skipKeys array', () => {
    expect(
      argsMatch(
        { a: 1, paginationOpts: { cursor: 'abc' } },
        { a: 1, paginationOpts: { cursor: 'xyz' } },
        ['paginationOpts'],
      ),
    ).toBe(true)
  })

  it('handles nested object matching', () => {
    expect(argsMatch({ user: { id: 1, name: 'Alice' } }, { user: { id: 1, name: 'Alice' } })).toBe(
      true,
    )
  })

  it('returns false for different nested objects', () => {
    expect(argsMatch({ user: { id: 1 } }, { user: { id: 2 } })).toBe(false)
  })

  it('returns true for empty filter', () => {
    expect(argsMatch({ a: 1, b: 2 }, {})).toBe(true)
  })
})

// ============================================================================
// compareJsonValues Tests
// ============================================================================

describe('compareJsonValues', () => {
  describe('numbers', () => {
    it('returns negative when a < b', () => {
      expect(compareJsonValues(1, 2)).toBeLessThan(0)
    })

    it('returns positive when a > b', () => {
      expect(compareJsonValues(2, 1)).toBeGreaterThan(0)
    })

    it('returns 0 when equal', () => {
      expect(compareJsonValues(5, 5)).toBe(0)
    })
  })

  describe('strings', () => {
    it('compares strings alphabetically', () => {
      expect(compareJsonValues('apple', 'banana')).toBeLessThan(0)
      expect(compareJsonValues('banana', 'apple')).toBeGreaterThan(0)
      expect(compareJsonValues('apple', 'apple')).toBe(0)
    })
  })

  describe('booleans', () => {
    it('treats false < true', () => {
      expect(compareJsonValues(false, true)).toBeLessThan(0)
      expect(compareJsonValues(true, false)).toBeGreaterThan(0)
    })

    it('returns 0 for equal booleans', () => {
      expect(compareJsonValues(true, true)).toBe(0)
      expect(compareJsonValues(false, false)).toBe(0)
    })
  })

  describe('null handling', () => {
    it('null equals null', () => {
      expect(compareJsonValues(null, null)).toBe(0)
    })

    it('null < any value', () => {
      expect(compareJsonValues(null, 1)).toBeLessThan(0)
      expect(compareJsonValues(null, 'a')).toBeLessThan(0)
    })

    it('any value > null', () => {
      expect(compareJsonValues(1, null)).toBeGreaterThan(0)
    })
  })

  describe('arrays (multi-key sort)', () => {
    it('compares element by element', () => {
      expect(compareJsonValues([1, 2], [1, 3])).toBeLessThan(0)
      expect(compareJsonValues([2, 1], [1, 1])).toBeGreaterThan(0)
    })

    it('returns 0 for equal arrays', () => {
      expect(compareJsonValues([1, 2, 3], [1, 2, 3])).toBe(0)
    })

    it('handles different length arrays', () => {
      expect(compareJsonValues([1], [1, 2])).toBeLessThan(0)
    })
  })

  describe('BigInt ($integer format)', () => {
    it('compares BigInt values correctly', () => {
      expect(compareJsonValues({ $integer: '100' }, { $integer: '200' })).toBeLessThan(0)

      expect(compareJsonValues({ $integer: '200' }, { $integer: '100' })).toBeGreaterThan(0)
    })

    it('handles large BigInt values', () => {
      expect(
        compareJsonValues({ $integer: '9007199254740992' }, { $integer: '9007199254740993' }),
      ).toBeLessThan(0)
    })
  })
})
