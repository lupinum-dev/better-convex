import { hash } from 'ohash'
import { describe, expect, it } from 'vitest'

import {
  createConvexPayloadKey,
  paginatedPayloadHash,
  purgeConvexIdentityPayloadKeys,
  readAuthMode,
  withAuthDimension,
} from '../../src/runtime/utils/convex-cache'

// Library-owned key state consists of the identity-partitioned payload-key
// grammar and the namespace-scan sign-out purge.

const argsHash = hash({})

describe('identity-partitioned payload-key grammar', () => {
  it('appends a static none suffix for none mode (identity-independent)', () => {
    const base = `convex:notes:list:${argsHash}`
    expect(createConvexPayloadKey('convex', 'notes:list', argsHash, 'none', 'anonymous')).toBe(
      `${base}:auth:none`,
    )
    // none is identity-blind: a signed-in identity does not change the key.
    expect(withAuthDimension(base, 'none', 'user:u1')).toBe(`${base}:auth:none`)
  })

  it('partitions required/optional keys by identity', () => {
    const key = (auth: 'required' | 'optional', identity: 'anonymous' | `user:${string}`) =>
      createConvexPayloadKey('convex', 'notes:list', argsHash, auth, identity)
    const base = `convex:notes:list:${argsHash}`
    // Same base and mode, partitioned only by identity: user B never reads user A's key.
    expect(key('required', 'user:u1')).toBe(`${base}:auth:required:user:u1`)
    expect(key('required', 'user:u2')).toBe(`${base}:auth:required:user:u2`)
    expect(key('optional', 'user:u2')).toBe(`${base}:auth:optional:user:u2`)
    expect(key('optional', 'anonymous')).toBe(`${base}:auth:optional:anonymous`)
  })

  it('uses the convex-paginated namespace and one colon-free hash for the first-page window', () => {
    const pageHash = paginatedPayloadHash(argsHash, 10, null)
    expect(pageHash).not.toContain(':')
    expect(pageHash).not.toBe(paginatedPayloadHash(argsHash, 10, 'cursor'))
    expect(pageHash).not.toBe(paginatedPayloadHash(argsHash, 20, null))
    const key = createConvexPayloadKey(
      'convex-paginated',
      'notes:list',
      pageHash,
      'none',
      'anonymous',
    )
    expect(key).toBe(`convex-paginated:notes:list:${pageHash}:auth:none`)
  })

  it('reads the auth dimension of a function in a module named auth', () => {
    const key = createConvexPayloadKey(
      'convex',
      'auth:currentUser',
      argsHash,
      'required',
      'user:u1',
    )
    expect(readAuthMode(key)).toBe('required')
    expect(
      readAuthMode(
        createConvexPayloadKey('convex', 'auth:none', argsHash, 'optional', 'anonymous'),
      ),
    ).toBe('optional')
    expect(
      readAuthMode(
        createConvexPayloadKey('convex', 'auth:required', argsHash, 'none', 'anonymous'),
      ),
    ).toBe('none')
  })

  it('reads the auth mode segment back out', () => {
    expect(readAuthMode('convex:notes:list:h:auth:none')).toBe('none')
    expect(readAuthMode('convex:notes:list:h:auth:required:user:u1')).toBe('required')
    expect(readAuthMode('convex-paginated:notes:list:h:auth:optional:anonymous')).toBe('optional')
    expect(readAuthMode('convex:idle:notes')).toBeNull()
    expect(readAuthMode('unrelated-key')).toBeNull()
  })
})

describe('sign-out identity purge (namespace scan, no registry)', () => {
  it('drops required/optional keys, retains none keys, ignores foreign keys', () => {
    const nuxtApp = {
      payload: {
        data: {
          'convex:notes:list:h:auth:required:user:u1': 1,
          'convex:notes:list:h:auth:optional:anonymous': 2,
          'convex:notes:public:h:auth:none': 3,
          'convex-paginated:feed:h:auth:optional:user:u1': 4,
          'convex-paginated:feed:h:auth:none': 5,
          'some.other.key': 6,
        } as Record<string, unknown>,
      },
    }

    const purged = purgeConvexIdentityPayloadKeys(nuxtApp)

    expect(purged.sort()).toEqual(
      [
        'convex:notes:list:h:auth:required:user:u1',
        'convex:notes:list:h:auth:optional:anonymous',
        'convex-paginated:feed:h:auth:optional:user:u1',
      ].sort(),
    )
    expect(Object.keys(nuxtApp.payload.data).sort()).toEqual(
      [
        'convex:notes:public:h:auth:none',
        'convex-paginated:feed:h:auth:none',
        'some.other.key',
      ].sort(),
    )
  })

  it('purges protected keys of a function in a module named auth', () => {
    const protectedKey = createConvexPayloadKey(
      'convex',
      'auth:currentUser',
      argsHash,
      'required',
      'user:u1',
    )
    const publicKey = createConvexPayloadKey('convex', 'auth:status', argsHash, 'none', 'anonymous')
    const nuxtApp = {
      payload: { data: { [protectedKey]: { value: 'alice' }, [publicKey]: { value: 'up' } } },
    }

    expect(purgeConvexIdentityPayloadKeys(nuxtApp)).toEqual([protectedKey])
    expect(Object.keys(nuxtApp.payload.data)).toEqual([publicKey])
  })
})
