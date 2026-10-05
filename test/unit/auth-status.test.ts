import { describe, expect, it } from 'vitest'

import { ConvexCallError } from '../../src/runtime/errors'
import { deriveConvexAuthStatus } from '../../src/runtime/utils/auth-status'

const authErr = new ConvexCallError({ kind: 'authentication', message: 'boom' })

// `status` is a pure function of (settled, identityKey, error). `pending` is the
// orthogonal second dimension of `UseConvexAuthReturn` and is not an input.
describe('deriveConvexAuthStatus', () => {
  it.each([
    // Unsettled auth is loading, whatever key or error is already recorded.
    [false, null, null, 'loading'],
    [false, 'anonymous', null, 'loading'],
    [false, 'user:a', null, 'loading'],
    [false, null, authErr, 'loading'],
    [false, 'anonymous', authErr, 'loading'],
    [false, 'user:a', authErr, 'loading'],
    // A usable identity outranks a background error.
    [true, 'user:a', null, 'authenticated'],
    [true, 'user:a', authErr, 'authenticated'],
    // Without a usable identity, an error outranks anonymous.
    [true, 'anonymous', authErr, 'error'],
    [true, null, authErr, 'error'],
    [true, 'anonymous', null, 'anonymous'],
    [true, null, null, 'anonymous'],
  ] as const)('settled=%s identityKey=%s error=%s -> %s', (settled, identityKey, error, status) => {
    expect(deriveConvexAuthStatus({ settled, identityKey, error })).toBe(status)
  })
})
