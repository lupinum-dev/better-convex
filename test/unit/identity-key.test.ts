import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  isAuthenticatedIdentityKey,
  type ConvexIdentityKey as VueConvexIdentityKey,
} from '../../packages/vue/src/internal/identity-key'
import { getConvexIdentityKey, type ConvexIdentityKey } from '../../src/runtime/utils/identity-key'
import type { ConvexUser } from '../../src/runtime/utils/types'

describe('ConvexIdentityKey', () => {
  it('is exactly the Vue runtime identity partition', () => {
    expectTypeOf<ConvexIdentityKey>().toEqualTypeOf<VueConvexIdentityKey>()
  })
})

describe('getConvexIdentityKey (single stable extraction function)', () => {
  it('derives the key from user.id only: anonymous for null, user:<id> per user', () => {
    // The extractor takes no token argument, so same-user token rotation cannot change the key.
    expect(getConvexIdentityKey(null)).toBe('anonymous')
    expect(getConvexIdentityKey({ id: 'A' } as ConvexUser)).toBe('user:A')
    expect(getConvexIdentityKey({ id: 'B' } as ConvexUser)).toBe('user:B')
  })

  it('throws for a present user with a non-string or empty id (never manufactures user:undefined)', () => {
    expect(() => getConvexIdentityKey({} as ConvexUser)).toThrow(TypeError)
    expect(() => getConvexIdentityKey({ id: '' } as ConvexUser)).toThrow(TypeError)
    expect(() => getConvexIdentityKey({ id: undefined } as unknown as ConvexUser)).toThrow(
      TypeError,
    )
    expect(() => getConvexIdentityKey({ id: 123 } as unknown as ConvexUser)).toThrow(TypeError)
  })
})

describe('isAuthenticatedIdentityKey', () => {
  it('is true only for a concrete user:<id> key', () => {
    expect(isAuthenticatedIdentityKey('user:u1')).toBe(true)
    expect(isAuthenticatedIdentityKey('anonymous')).toBe(false)
    expect(isAuthenticatedIdentityKey(null)).toBe(false)
  })
})
