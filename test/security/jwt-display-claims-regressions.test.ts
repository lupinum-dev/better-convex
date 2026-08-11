import type { H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveServerAuthSnapshot } from '../../src/runtime/server/utils/auth-snapshot'
import {
  decodeJwtPayload,
  decodeUserFromJwt,
  isJwtUsable,
} from '../../src/runtime/utils/convex-shared'

function toBase64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}

function makeJwt(
  payload: unknown,
  header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT', kid: 'test-key' },
): string {
  return `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}.signature`
}

describe('JWT display-claim boundary', () => {
  it('keeps the signed subject as the one display identity key', () => {
    const payload = JSON.parse(
      '{"sub":"canonical-user","id":"claim-controlled-id","userId":"legacy-id","name":"Ada"}',
    ) as Record<string, unknown>

    expect(decodeUserFromJwt(makeJwt(payload))).toEqual({
      id: 'canonical-user',
      name: 'Ada',
    })
  })

  it('does not project attacker-controlled custom properties', () => {
    const payload = JSON.parse(`{
      "sub":"user-1",
      "__proto__":{"polluted":"top"},
      "constructor":{"polluted":"constructor"},
      "prototype":{"polluted":"prototype"},
      "profile":{
        "safe":"visible",
        "__proto__":{"polluted":"nested"},
        "constructor":{"polluted":"nested-constructor"},
        "nested":{"prototype":{"polluted":"deep"},"unicode":"Grüße 👋"}
      }
    }`) as Record<string, unknown>

    expect(decodeUserFromJwt(makeJwt(payload))).toEqual({ id: 'user-1' })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('omits all custom values without losing the identity', () => {
    const tooDeep = { level: { level: { level: { level: { value: 'hidden' } } } } }
    const token = makeJwt({
      sub: 'user-1',
      safe: 'visible',
      huge: 'x'.repeat(4_097),
      wide: Array.from({ length: 65 }, (_, index) => index),
      deep: tooDeep,
      boundedArray: Array.from({ length: 64 }, (_, index) => index),
    })

    expect(decodeUserFromJwt(token)).toEqual({ id: 'user-1' })
  })

  it('normalizes display fields by type instead of coercing attacker values', () => {
    const user = decodeUserFromJwt(
      makeJwt({
        sub: 'user-1',
        name: { toString: 'not executable' },
        email: 42,
        emailVerified: 'true',
        image: ['javascript:ignored'],
        createdAt: 123,
        updatedAt: false,
        locale: '日本語',
      }),
    )

    expect(user).toEqual({ id: 'user-1' })
  })

  it.each([null, [], 'user-1', 42, true])('rejects a non-object JWT payload (%j)', (payload) => {
    expect(decodeJwtPayload(makeJwt(payload))).toBeNull()
    expect(decodeUserFromJwt(makeJwt(payload))).toBeNull()
  })

  it.each([
    ['missing subject', { exp: 2_000_000_000 }],
    ['empty subject', { sub: '', exp: 2_000_000_000 }],
    ['numeric subject', { sub: 123, exp: 2_000_000_000 }],
    ['object subject', { sub: { id: 'nested' }, exp: 2_000_000_000 }],
  ])('rejects a %s for local display identity', (_case, payload) => {
    expect(decodeUserFromJwt(makeJwt(payload))).toBeNull()
  })

  it('rejects malformed encodings, invalid UTF-8, and oversized local tokens', () => {
    const invalidUtf8 = `${toBase64Url('{}')}.${toBase64Url(new Uint8Array([255]))}.signature`
    const oversized = `${toBase64Url('{}')}.${toBase64Url(JSON.stringify({ sub: 'u', pad: 'x'.repeat(65_536) }))}.signature`

    for (const token of [
      '',
      'one.two',
      'one.two.three.four',
      '!!!!.e30.signature',
      'e30.!!!!.signature',
      'e30.e30.!!!!',
      'e30..signature',
      'e30.e.signature',
      // `e31` decodes to the same bytes as canonical `e30` in permissive
      // decoders because its ignored padding bits are non-zero.
      'e30.e31.signature',
      invalidUtf8,
      oversized,
    ]) {
      expect(decodeJwtPayload(token)).toBeNull()
      expect(decodeUserFromJwt(token)).toBeNull()
    }
  })

  it('applies the same strict payload decoding in the browser path', () => {
    const token = makeJwt({ sub: 'browser-user', locale: '日本語 👋' })
    vi.stubGlobal('Buffer', undefined)
    try {
      expect(decodeUserFromJwt(token)).toEqual({ id: 'browser-user' })
      expect(decodeJwtPayload('e30.e31.signature')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('enforces expiry locally but leaves cryptographic claims to Convex', () => {
    const nowMs = 1_700_000_000_000
    const nowSeconds = nowMs / 1_000

    expect(isJwtUsable(makeJwt({ sub: 'u' }), nowMs)).toBe(false)
    expect(isJwtUsable(makeJwt({ sub: 'u', exp: nowSeconds - 1 }), nowMs)).toBe(false)
    expect(isJwtUsable(makeJwt({ sub: 'u', exp: nowSeconds + 30 }), nowMs)).toBe(false)
    expect(isJwtUsable(makeJwt({ sub: 'u', exp: nowSeconds + 31 }), nowMs)).toBe(true)
    expect(isJwtUsable(makeJwt({ sub: 'u', exp: Number.MAX_VALUE }), nowMs)).toBe(false)

    const cryptographicallyUntrusted = makeJwt(
      {
        sub: 'u',
        iss: 'https://wrong-issuer.example',
        aud: 'wrong-audience',
        iat: nowSeconds + 86_400,
        exp: nowSeconds + 86_500,
      },
      { alg: 'none', typ: 'JWT' },
    )

    // Local parsing is intentionally only a bounded display/lifecycle operation.
    // The candidate remains unusable for backend work until Convex verifies it.
    expect(decodeUserFromJwt(cryptographicallyUntrusted)).toEqual({ id: 'u' })
    expect(isJwtUsable(cryptographicallyUntrusted, nowMs)).toBe(true)
  })
})

describe('server JWT hydration boundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['malformed', () => 'not-a-jwt'],
    ['missing exp', () => makeJwt({ sub: 'user-1' })],
    ['expired', () => makeJwt({ sub: 'user-1', exp: Math.floor(Date.now() / 1_000) - 1 })],
    ['nearly expired', () => makeJwt({ sub: 'user-1', exp: Math.floor(Date.now() / 1_000) + 20 })],
    ['missing subject', () => makeJwt({ exp: Math.floor(Date.now() / 1_000) + 900 })],
    ['non-string subject', () => makeJwt({ sub: 123, exp: Math.floor(Date.now() / 1_000) + 900 })],
  ])('does not hydrate a %s token or start a session fallback', async (_case, tokenFactory) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ token: tokenFactory() }), { status: 200 }),
    )

    const snapshot = await resolveServerAuthSnapshot({
      event: { headers: new Headers() } as unknown as H3Event,
      siteUrl: 'https://demo.convex.site',
      cookieHeader: 'better-auth.session_token=session-secret',
      requestId: 'jwt-retention-test',
      trackWaterfall: true,
      trustedClientIpHeader: '',
    })

    expect(snapshot.token).toBeNull()
    expect(snapshot.user).toBeNull()
    expect(snapshot.authError).toBe('Authentication is temporarily unavailable')
    expect(snapshot.waterfall?.error).toBe('AUTH_TOKEN_EXCHANGE_FAILED')
    expect(globalThis.fetch).toHaveBeenCalledOnce()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://demo.convex.site/api/auth/convex/token',
      expect.any(Object),
    )
  })

  it('publishes cryptographic claims only as provisional display state', async () => {
    const token = makeJwt(
      {
        sub: 'user-1',
        iss: 'https://wrong-issuer.example',
        aud: 'wrong-audience',
        iat: Math.floor(Date.now() / 1_000) + 86_400,
        exp: Math.floor(Date.now() / 1_000) + 86_500,
      },
      { alg: 'none', typ: 'JWT' },
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ token }), { status: 200 }),
    )

    const snapshot = await resolveServerAuthSnapshot({
      event: { headers: new Headers() } as unknown as H3Event,
      siteUrl: 'https://demo.convex.site',
      cookieHeader: 'better-auth.session_token=session-secret',
      requestId: 'jwt-provisional-test',
      trackWaterfall: true,
      trustedClientIpHeader: '',
    })

    expect(snapshot).toMatchObject({ token, user: { id: 'user-1' }, authError: null })
    expect(globalThis.fetch).toHaveBeenCalledOnce()
  })
})
