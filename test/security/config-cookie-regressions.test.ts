import {
  getCookies as getPinnedCookies,
  getSessionCookie as getPinnedSessionCookie,
  parseCookies as parsePinnedCookies,
} from 'better-auth/cookies'
import { describe, expect, it } from 'vitest'

import {
  BETTER_AUTH_SECURE_SESSION_COOKIE_NAME,
  BETTER_AUTH_SESSION_COOKIE_NAME,
  filterBetterAuthCookies,
  getBetterAuthSessionToken,
  hasBetterAuthCookie,
  hasSetCookieDomainAttribute,
  isBetterAuthCookieName,
  isBetterAuthSetCookie,
} from '../../src/runtime/utils/shared-helpers'
import { normalizeConvexSiteUrl } from '../../src/runtime/utils/site-url'

describe('configuration and cookie security regressions', () => {
  it('accepts only a bare HTTPS site origin except loopback development', () => {
    expect(normalizeConvexSiteUrl('https://demo.convex.site')).toBe('https://demo.convex.site')
    expect(normalizeConvexSiteUrl('http://127.0.0.1:3211')).toBe('http://127.0.0.1:3211')
    expect(() => normalizeConvexSiteUrl('http://internal.example')).toThrow()
    expect(() => normalizeConvexSiteUrl('https://demo.convex.site/private')).toThrow()
    expect(() => normalizeConvexSiteUrl('https://user:pass@demo.convex.site')).toThrow()
  })

  it.each([
    ['https://demo.convex.site/', 'https://demo.convex.site'],
    ['https://demo.convex.site:444/', 'https://demo.convex.site:444'],
    ['https://xn--bcher-kva.example/', 'https://xn--bcher-kva.example'],
    ['http://localhost:3211/', 'http://localhost:3211'],
    ['http://127.0.0.1:3211/', 'http://127.0.0.1:3211'],
    ['http://[::1]:3211/', 'http://[::1]:3211'],
  ])('accepts a canonical configured origin %s', (input, expected) => {
    expect(normalizeConvexSiteUrl(input)).toBe(expected)
  })

  it.each([
    'http://example.test',
    'http://localhost.',
    'http://preview.localhost:3211/',
    'http://127.1:3211/',
    'http://2130706433:3211/',
    'http://[0:0:0:0:0:0:0:1]:3211/',
    'http://127.0.0.1.example.test',
    'http://[::ffff:127.0.0.1]',
    'https://example.test/path',
    'https://example.test/?query=1',
    'https://example.test/#fragment',
    'https://user@example.test',
    'https://DEMO.convex.site:443/',
    'https://demo.convex.site./',
    'https://bücher.example/',
    'ftp://example.test',
  ])('rejects a non-origin or non-loopback HTTP destination: %s', (input) => {
    expect(() => normalizeConvexSiteUrl(input)).toThrow()
  })

  it('treats an explicitly empty secure session cookie as authoritative', () => {
    expect(
      getBetterAuthSessionToken(
        '__Secure-better-auth.session_token=; better-auth.session_token=stale',
      ),
    ).toBe('')
  })

  it('pins Better Auth default session cookie names and host-only attributes', () => {
    const https = getPinnedCookies({ baseURL: 'https://app.example.test' })
    expect(https.sessionToken).toMatchObject({
      name: '__Secure-better-auth.session_token',
      attributes: {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: true,
      },
    })
    expect(https.sessionToken.attributes).not.toHaveProperty('domain')

    const loopback = getPinnedCookies({ baseURL: 'http://localhost:3000' })
    expect(loopback.sessionToken).toMatchObject({
      name: 'better-auth.session_token',
      attributes: { httpOnly: true, path: '/', sameSite: 'lax', secure: false },
    })
    expect(loopback.sessionToken.attributes).not.toHaveProperty('domain')
  })

  it.each([
    ['better-auth.session_token=regular', 'regular'],
    ['__Secure-better-auth.session_token=secure', 'secure'],
    ['better-auth.session_token=stale; __Secure-better-auth.session_token=current', 'current'],
    ['__Secure-better-auth.session_token=current; better-auth.session_token=stale', 'current'],
  ])('matches supported Better Auth session-cookie selection for %s', (cookie, expected) => {
    expect(getBetterAuthSessionToken(cookie)).toBe(expected)
    expect(getPinnedSessionCookie(new Headers({ cookie }))).toBe(expected)
  })

  it('matches pinned duplicate/path ordering while preserving duplicate wire pairs', () => {
    // Browsers send longer-path cookies before shorter-path cookies. The
    // supported Better Auth tuple uses the last duplicate, so custom cookie
    // paths are unsupported.
    const cookie =
      'better-auth.session_token=longer-path; better-auth.session_token=root-path; better-auth.state=first; better-auth.state=second'
    expect(getBetterAuthSessionToken(cookie)).toBe('root-path')
    expect(getPinnedSessionCookie(new Headers({ cookie }))).toBe('root-path')
    expect(filterBetterAuthCookies(cookie)).toBe(cookie)
  })

  it('forwards the default Better Auth plugin/state/MFA namespace and nothing else', () => {
    const supported = [
      'better-auth.session_token=session',
      '__Secure-better-auth.session_data.0=session-data-chunk',
      'better-auth.oauth_state=oauth-state',
      'better-auth.state=state',
      'better-auth.pk_code_verifier=verifier',
      'better-auth.oauth_popup=nonce',
      'better-auth.two_factor=challenge',
      'better-auth.trust_device=trusted-device',
      'better-auth.dont_remember=true',
      'better-auth.convex_jwt=jwt',
      'better-auth.better-auth-passkey=webauthn-challenge',
    ]
    const header = [
      'private_application=secret',
      ...supported,
      'oidc_login_prompt=unsupported-unprefixed-plugin-cookie',
      'oidc_consent_prompt=unsupported-unprefixed-plugin-cookie',
    ].join('; ')

    expect(filterBetterAuthCookies(header)).toBe(supported.join('; '))
  })

  it('detects supported credentials even when a cookie pair is malformed', () => {
    expect(hasBetterAuthCookie('unrelated=value; better-auth.session_token')).toBe(true)
    expect(hasBetterAuthCookie('__Secure-better-auth.session_token=invalid')).toBe(true)
    expect(hasBetterAuthCookie('better-auth.two_factor=pending')).toBe(true)
    expect(hasBetterAuthCookie('unrelated=value')).toBe(false)
  })

  it.each([
    'custom.session_token',
    '__Secure-custom.session_token',
    '__Host-better-auth.session_token',
    'better-auth-session_token',
    'better-auth.',
    '__Secure-better-auth.',
    'session_token',
    'oidc_login_prompt',
  ])('keeps unsupported cookie name %s outside the auth boundary', (name) => {
    expect(isBetterAuthCookieName(name)).toBe(false)
    expect(getBetterAuthSessionToken(`${name}=value`)).toBeNull()
    expect(filterBetterAuthCookies(`${name}=value`)).toBeNull()
  })

  it('matches pinned parsing for encoded, quoted, malformed, and separator values', () => {
    expect(getBetterAuthSessionToken('better-auth.session_token=%CF%80%3Bvalue')).toBe('π;value')
    expect(getBetterAuthSessionToken('better-auth.session_token="quoted"')).toBe('quoted')
    expect(getBetterAuthSessionToken('better-auth.session_token=abc=def')).toBe('abc=def')
    expect(getBetterAuthSessionToken('better-auth.session_token=%ZZ')).toBe('%ZZ')
    expect(getBetterAuthSessionToken('better-auth.session_token=first; ignored; other=value')).toBe(
      'first',
    )
    expect(getBetterAuthSessionToken('better-auth.session_token=raw-π')).toBeNull()
    expect(getBetterAuthSessionToken('better-auth.session_token=control\u0000value')).toBeNull()
    expect(filterBetterAuthCookies('better-auth.session_token=line\nbreak')).toBeNull()
  })

  it('keeps parsing and filtering property-aligned with the supported Better Auth tuple', () => {
    let state = 99_353_829
    const random = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const names = [
      BETTER_AUTH_SESSION_COOKIE_NAME,
      BETTER_AUTH_SECURE_SESSION_COOKIE_NAME,
      'better-auth.state',
      'private_cookie',
      'bad name',
      '__proto__',
      'constructor',
    ]
    const values = [
      'opaque',
      '',
      '%2Fencoded',
      '%ZZ',
      'abc=def',
      'comma,value',
      '"quoted"',
      'raw-π',
      'control\u0000value',
    ]
    const whitespace = ['', ' ', '\t']

    for (let sample = 0; sample < 1_000; sample += 1) {
      const count = (random() % 8) + 1
      const chunks: string[] = []
      for (let index = 0; index < count; index += 1) {
        const name = names[random() % names.length] ?? 'private_cookie'
        const value = values[random() % values.length] ?? ''
        const before = whitespace[random() % whitespace.length] ?? ''
        const after = whitespace[random() % whitespace.length] ?? ''
        chunks.push(`${before}${name}${after}=${before}${value}${after}`)
      }
      const header = chunks.join(';')
      const pinned = parsePinnedCookies(header)
      const expected = pinned.has(BETTER_AUTH_SECURE_SESSION_COOKIE_NAME)
        ? (pinned.get(BETTER_AUTH_SECURE_SESSION_COOKIE_NAME) ?? null)
        : (pinned.get(BETTER_AUTH_SESSION_COOKIE_NAME) ?? null)

      const expectedForwarded = chunks.filter((chunk) => {
        const [name] = parsePinnedCookies(chunk).keys()
        if (!name) return false
        const unprefixed = name.startsWith('__Secure-') ? name.slice('__Secure-'.length) : name
        return unprefixed.startsWith('better-auth.') && unprefixed.length > 'better-auth.'.length
      })

      expect(getBetterAuthSessionToken(header), header).toBe(expected)
      expect(filterBetterAuthCookies(header), header).toBe(
        expectedForwarded.length > 0
          ? expectedForwarded.map((chunk) => chunk.trim()).join('; ')
          : null,
      )
    }
  })

  it('filters an oversized mixed header without forwarding application cookies', () => {
    const privateCookies = Array.from(
      { length: 4_000 },
      (_, index) => `application_${index}=${'x'.repeat(16)}`,
    )
    const header = [...privateCookies, 'better-auth.session_token=SESSION_SENTINEL'].join('; ')
    expect(header.length).toBeGreaterThan(64 * 1024)
    expect(filterBetterAuthCookies(header)).toBe('better-auth.session_token=SESSION_SENTINEL')
  })

  it('recognizes only supported Set-Cookie names and detects Domain attributes', () => {
    expect(
      isBetterAuthSetCookie(
        'better-auth.session_data.0=value; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/; HttpOnly',
      ),
    ).toBe(true)
    expect(isBetterAuthSetCookie('__Secure-better-auth.two_factor=value; Secure; Path=/')).toBe(
      true,
    )
    expect(isBetterAuthSetCookie('application_session=value; Path=/')).toBe(false)
    expect(isBetterAuthSetCookie('custom.session_token=value; Path=/')).toBe(false)

    expect(
      hasSetCookieDomainAttribute(
        'better-auth.session_token=value; Path=/; dOmAiN=.example.test; Secure',
      ),
    ).toBe(true)
    expect(
      hasSetCookieDomainAttribute(
        'better-auth.session_token=value; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/; Secure',
      ),
    ).toBe(false)
  })
})
