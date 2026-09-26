import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  isAuthenticatedIdentityKey,
  type ConvexIdentityKey as VueConvexIdentityKey,
} from '../../packages/vue/src/internal/identity-key'
import { withAuthDimension } from '../../src/runtime/utils/convex-cache'
import { getConvexIdentityKey, type ConvexIdentityKey } from '../../src/runtime/utils/identity-key'
import type { ConvexUser } from '../../src/runtime/utils/types'

function user(id: string): ConvexUser {
  return { id } as ConvexUser
}

describe('ConvexIdentityKey', () => {
  it('is exactly the Vue runtime identity partition', () => {
    expectTypeOf<ConvexIdentityKey>().toEqualTypeOf<VueConvexIdentityKey>()
  })
})

describe('getConvexIdentityKey (single stable extraction function)', () => {
  it('returns "anonymous" for null', () => {
    expect(getConvexIdentityKey(null)).toBe('anonymous')
  })

  it('returns `user:${id}` for a settled user, independent of token', () => {
    expect(getConvexIdentityKey(user('u1'))).toBe('user:u1')
  })

  it('same user, new token: the key is unchanged (identity is derived from user.id only)', () => {
    // The extractor takes no token argument at all — same-user token rotation
    // structurally cannot change the key. Two independent calls for the same
    // user (standing in for two successive tokens) produce the same key.
    const before = getConvexIdentityKey(user('stable-user'))
    const after = getConvexIdentityKey(user('stable-user'))
    expect(before).toBe(after)
    expect(before).toBe('user:stable-user')
  })

  it('different user produces a different key', () => {
    expect(getConvexIdentityKey(user('A'))).not.toBe(getConvexIdentityKey(user('B')))
    expect(getConvexIdentityKey(user('A'))).toBe('user:A')
    expect(getConvexIdentityKey(user('B'))).toBe('user:B')
  })

  it('throws for a present user with a non-string or empty id (never manufactures user:undefined)', () => {
    expect(() => getConvexIdentityKey({} as ConvexUser)).toThrow(TypeError)
    expect(() => getConvexIdentityKey({ id: '' } as ConvexUser)).toThrow(TypeError)
    expect(() => getConvexIdentityKey({ id: undefined } as unknown as ConvexUser)).toThrow(
      TypeError,
    )
    expect(() => getConvexIdentityKey({ id: 123 } as unknown as ConvexUser)).toThrow(TypeError)
  })

  it('never produces the literal string "user:undefined"', () => {
    let key: string | undefined
    try {
      key = getConvexIdentityKey({} as ConvexUser)
    } catch {
      key = undefined
    }
    expect(key).not.toBe('user:undefined')
  })
})

describe('isAuthenticatedIdentityKey', () => {
  it('is true only for a concrete user:<id> key', () => {
    expect(isAuthenticatedIdentityKey('user:u1')).toBe(true)
    expect(isAuthenticatedIdentityKey('anonymous')).toBe(false)
    expect(isAuthenticatedIdentityKey(null)).toBe(false)
  })
})

describe('withAuthDimension payload-key grammar', () => {
  it('"none" is a static, identity-independent suffix', () => {
    expect(withAuthDimension('convex:tasks:list:abc', 'none', 'anonymous')).toBe(
      'convex:tasks:list:abc:auth:none',
    )
    expect(withAuthDimension('convex:tasks:list:abc', 'none', 'user:u1' as ConvexIdentityKey)).toBe(
      'convex:tasks:list:abc:auth:none',
    )
  })

  it('"required"/"optional" partition by mode AND the concrete identity key', () => {
    expect(withAuthDimension('convex:tasks:list:abc', 'required', 'user:u1')).toBe(
      'convex:tasks:list:abc:auth:required:user:u1',
    )
    expect(withAuthDimension('convex:tasks:list:abc', 'optional', 'anonymous')).toBe(
      'convex:tasks:list:abc:auth:optional:anonymous',
    )
  })

  it('same user, new token: the payload key is unchanged because it is keyed by user.id, not token', () => {
    const keyBefore = withAuthDimension(
      'convex:tasks:list:abc',
      'required',
      getConvexIdentityKey(user('u1')),
    )
    const keyAfter = withAuthDimension(
      'convex:tasks:list:abc',
      'required',
      getConvexIdentityKey(user('u1')),
    )
    expect(keyBefore).toBe(keyAfter)
  })

  it('different user produces a different payload key for the same base/mode', () => {
    const keyA = withAuthDimension('convex:tasks:list:abc', 'optional', 'user:A' as const)
    const keyB = withAuthDimension('convex:tasks:list:abc', 'optional', 'user:B' as const)
    expect(keyA).not.toBe(keyB)
  })

  it('user B can never construct or read user A\'s "required"/"optional" key', () => {
    const aKey = withAuthDimension('convex:notes:mine:xyz', 'required', 'user:A' as const)
    const bKey = withAuthDimension('convex:notes:mine:xyz', 'required', 'user:B' as const)
    expect(aKey).not.toBe(bKey)
    // The same base key + mode, partitioned only by identity, is the entire
    // isolation mechanism — there is no registry or count to consult.
    expect(aKey.startsWith('convex:notes:mine:xyz:auth:required:')).toBe(true)
    expect(bKey.startsWith('convex:notes:mine:xyz:auth:required:')).toBe(true)
  })

  it('same shapes apply under the convex-paginated namespace (base key is namespace-agnostic)', () => {
    const regular = withAuthDimension('convex:notes:list:abc', 'optional', 'user:u1')
    const paginated = withAuthDimension('convex-paginated:notes:list:abc', 'optional', 'user:u1')
    expect(regular).toBe('convex:notes:list:abc:auth:optional:user:u1')
    expect(paginated).toBe('convex-paginated:notes:list:abc:auth:optional:user:u1')
  })
})
