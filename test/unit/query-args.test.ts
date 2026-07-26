import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import {
  isConvexArgsSkipped,
  normalizeConvexArgs,
} from '../../packages/vue/src/internal/query-args'

describe('query args normalization', () => {
  it('preserves the explicit reactive skip sentinel', () => {
    expect(normalizeConvexArgs(ref('skip'))).toBe('skip')

    expect(isConvexArgsSkipped('skip')).toBe(true)
    expect(isConvexArgsSkipped(null)).toBe(false)
    expect(isConvexArgsSkipped(undefined)).toBe(false)
    expect(isConvexArgsSkipped({})).toBe(false)
  })

  it('rejects direct, ref, and getter nullish arguments', () => {
    const invalidArgs = [null, undefined, ref(null), ref(undefined), () => null, () => undefined]

    for (const args of invalidArgs) {
      expect(() => normalizeConvexArgs(args as never)).toThrow(
        '[better-convex-vue] query arguments cannot be null or undefined; pass {} or the literal "skip"',
      )
    }
  })

  it('deeply unwraps nested refs', () => {
    const nested = {
      status: ref('active'),
      filter: {
        owner: ref('me'),
      },
    }

    expect(normalizeConvexArgs(nested)).toEqual({
      status: 'active',
      filter: {
        owner: 'me',
      },
    })
  })
})
