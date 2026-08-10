import { describe, expect, it } from 'vitest'

import {
  ServerConvexValidationError,
  credentialHasControlChars,
  validateServerConvexOptions,
} from '../../src/runtime/server/utils/server-convex-options'

describe('validateServerConvexOptions — cookie-based defaults', () => {
  it('defaults an omitted auth to a fixed optional', () => {
    expect(validateServerConvexOptions()).toEqual({ auth: 'optional' })
    expect(validateServerConvexOptions({})).toEqual({ auth: 'optional' })
  })

  it('preserves an explicit cookie-based auth mode', () => {
    expect(validateServerConvexOptions({ auth: 'required' })).toEqual({ auth: 'required' })
    expect(validateServerConvexOptions({ auth: 'optional' })).toEqual({ auth: 'optional' })
    expect(validateServerConvexOptions({ auth: 'none' })).toEqual({ auth: 'none' })
  })
})

describe('validateServerConvexOptions — explicit principal forces required', () => {
  it('forces an omitted auth to required when authToken is provided', () => {
    expect(validateServerConvexOptions({ authToken: 'jwt' })).toEqual({
      auth: 'required',
      authToken: 'jwt',
    })
  })

  it('forces an omitted auth to required when credential is provided', () => {
    expect(validateServerConvexOptions({ credential: { type: 'cookie', value: 'c=1' } })).toEqual({
      auth: 'required',
      credential: { type: 'cookie', value: 'c=1' },
    })
  })
})

describe('validateServerConvexOptions — rejected combinations', () => {
  it('rejects authToken and credential together (mutually exclusive)', () => {
    expect(() =>
      // @ts-expect-error the public union rejects two explicit principals
      validateServerConvexOptions({ authToken: 'jwt', credential: { type: 'cookie', value: 'c' } }),
    ).toThrow(ServerConvexValidationError)
  })

  it.each(['required', 'optional', 'none'] as const)(
    'rejects redundant or contradictory auth=%s with an explicit token',
    (auth) => {
      expect(() =>
        // @ts-expect-error an explicit token already implies required auth
        validateServerConvexOptions({ auth, authToken: 'jwt' }),
      ).toThrow(ServerConvexValidationError)
    },
  )

  it.each(['required', 'optional', 'none'] as const)(
    'rejects redundant or contradictory auth=%s with an explicit credential',
    (auth) => {
      expect(() =>
        validateServerConvexOptions({
          auth,
          // @ts-expect-error an explicit credential already implies required auth
          credential: { type: 'cookie', value: 'better-auth.session_token=b' },
        }),
      ).toThrow(ServerConvexValidationError)
    },
  )

  it('rejects invalid auth modes supplied by JavaScript or a cast', () => {
    expect(() =>
      // @ts-expect-error deliberately exercising the runtime boundary
      validateServerConvexOptions({ auth: 'sometimes' }),
    ).toThrow("auth must be one of 'required', 'optional', or 'none'")
  })

  it.each([null, [], 'required'])(
    'rejects non-object options supplied at runtime: %j',
    (options) => {
      expect(() =>
        // @ts-expect-error deliberately exercising the JavaScript/cast boundary
        validateServerConvexOptions(options),
      ).toThrow('serverConvex options must be an object')
    },
  )
})

describe('validateServerConvexOptions — empty and control-character values', () => {
  it('rejects an empty authToken', () => {
    expect(() => validateServerConvexOptions({ authToken: '' })).toThrow(
      ServerConvexValidationError,
    )
  })

  it('rejects an empty credential value', () => {
    expect(() =>
      validateServerConvexOptions({ credential: { type: 'cookie', value: '' } }),
    ).toThrow(ServerConvexValidationError)
  })

  it('rejects a control-character authToken (CRLF)', () => {
    expect(() =>
      validateServerConvexOptions({ authToken: `jwt${String.fromCharCode(13, 10)}x` }),
    ).toThrow(ServerConvexValidationError)
  })

  it('rejects a control-character credential value (bare LF)', () => {
    expect(() =>
      validateServerConvexOptions({
        credential: { type: 'cookie', value: `c=1${String.fromCharCode(10)}evil` },
      }),
    ).toThrow(ServerConvexValidationError)
  })

  it('rejects a malformed credential shape', () => {
    expect(() =>
      // @ts-expect-error deliberately invalid credential type
      validateServerConvexOptions({ credential: { type: 'basic', value: 'x' } }),
    ).toThrow(ServerConvexValidationError)
  })

  it('rejects a Better Auth session token presented as a bearer credential', () => {
    expect(() =>
      validateServerConvexOptions({
        // @ts-expect-error bearer credentials are deliberately absent from the public type
        credential: { type: 'bearer', value: 'session-token' },
      }),
    ).toThrow('credential must be a cookie credential')
  })
})

describe('credentialHasControlChars', () => {
  it('detects CR, LF, NUL, DEL, TAB and other control chars', () => {
    for (const code of [0, 9, 10, 13, 31, 127]) {
      expect(credentialHasControlChars(`a${String.fromCharCode(code)}b`)).toBe(true)
    }
  })
  it('returns false for a clean printable value', () => {
    expect(credentialHasControlChars('better-auth.session_token=abc123; Path=/')).toBe(false)
  })
})
