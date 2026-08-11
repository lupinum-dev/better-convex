import { describe, expect, it } from 'vitest'

import {
  purgeConvexIdentityPayloadKeys,
  readAuthMode,
  retainAnonymousConvexQueryErrors,
  withAuthDimension,
} from '../../src/runtime/utils/convex-cache'
import { createConvexQueryKey } from '../../src/runtime/utils/convex-shared'

// Library-owned key state consists of the identity-partitioned payload-key
// grammar and the namespace-scan sign-out purge.

const noArgs = {} as never

describe('identity-partitioned payload-key grammar (decision 7)', () => {
  it('appends a static none suffix for none mode (identity-independent)', () => {
    const base = createConvexQueryKey({ _path: 'notes.list' } as never, noArgs)
    expect(withAuthDimension(base, 'none', 'anonymous')).toBe(`${base}:auth:none`)
    // none is identity-blind: a signed-in identity does not change the key.
    expect(withAuthDimension(base, 'none', 'user:u1')).toBe(`${base}:auth:none`)
  })

  it('partitions required/optional keys by identity', () => {
    const base = createConvexQueryKey({ _path: 'notes.list' } as never, noArgs)
    expect(withAuthDimension(base, 'required', 'user:u1')).toBe(`${base}:auth:required:user:u1`)
    expect(withAuthDimension(base, 'optional', 'user:u2')).toBe(`${base}:auth:optional:user:u2`)
    expect(withAuthDimension(base, 'optional', 'anonymous')).toBe(`${base}:auth:optional:anonymous`)
  })

  it('uses the convex-paginated namespace for paginated base keys', () => {
    const base = createConvexQueryKey({ _path: 'notes.list' } as never, noArgs, 'convex-paginated')
    expect(base.startsWith('convex-paginated:')).toBe(true)
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

  it('retains only anonymous errors on every credential-generation change', () => {
    const retained = retainAnonymousConvexQueryErrors({
      'convex:notes:list:h:auth:required:user:alice': 'alice error',
      'convex:notes:list:h:auth:optional:user:alice': 'optional error',
      'convex:notes:public:h:auth:none': 'public error',
      'convex-paginated:feed:h:auth:none': 'public page error',
      unrelated: 'foreign error',
    })

    expect(retained).toEqual({
      'convex:notes:public:h:auth:none': 'public error',
      'convex-paginated:feed:h:auth:none': 'public page error',
    })
  })
})
