import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { deepUnref } from '../../packages/vue/src/internal/deep-unref'

describe('deepUnref', () => {
  it('unwraps refs inside nested plain objects and arrays', () => {
    const value = {
      id: ref('a'),
      nested: {
        count: ref(2),
      },
      list: [ref('x'), { ok: ref(true) }],
    }

    const result = deepUnref(value)
    expect(result).toEqual({
      id: 'a',
      nested: { count: 2 },
      list: ['x', { ok: true }],
    })
  })

  it('returns same object identity when no refs are present', () => {
    const input = { id: 'a', nested: { count: 1 }, list: [1, 2, 3] }
    const result = deepUnref(input)
    expect(result).toBe(input)
    expect(result.nested).toBe(input.nested)
    expect(result.list).toBe(input.list)
  })

  it('handles cyclic references without crashing', () => {
    const input: { name: string; self?: unknown } = { name: 'loop' }
    input.self = input

    const result = deepUnref(input)
    expect(result.name).toBe('loop')
    expect(result.self).toBe(result)
  })

  it('keeps non-plain objects opaque', () => {
    const date = new Date('2024-01-01T00:00:00Z')
    const map = new Map([['a', 1]])
    const input = { date, map }

    const result = deepUnref(input)
    expect(result.date).toBe(date)
    expect(result.map).toBe(map)
  })
})
