import { describe, expect, it } from 'vitest'

import { decodeUserFromJwt, getJwtTimeUntilExpiryMs } from '../../src/runtime/utils/convex-shared'

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = toBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const body = toBase64Url(JSON.stringify(payload))
  return `${header}.${body}.signature`
}

describe('decodeUserFromJwt', () => {
  it('projects only the standard user fields into the browser auth user', () => {
    const token = makeJwt({
      sub: 'user_123',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      image: 'https://example.com/avatar.png',
      role: 'admin',
      organizationId: 'org_1',
      flags: ['beta'],
      profile: { theme: 'dark' },
      iat: 1234567890,
      exp: 1234567999,
    })

    expect(decodeUserFromJwt(token)).toEqual({
      id: 'user_123',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      image: 'https://example.com/avatar.png',
    })
  })
})

describe('getJwtTimeUntilExpiryMs', () => {
  it('returns null when exp is missing', () => {
    const token = makeJwt({ sub: 'user_123' })
    expect(getJwtTimeUntilExpiryMs(token, 1_000)).toBeNull()
  })

  it('returns remaining milliseconds until expiry', () => {
    const token = makeJwt({ sub: 'user_123', exp: 10 })
    expect(getJwtTimeUntilExpiryMs(token, 3_500)).toBe(6_500)
  })
})
