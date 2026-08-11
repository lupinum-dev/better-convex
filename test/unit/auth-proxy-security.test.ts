import { describe, expect, it } from 'vitest'

import {
  OAUTH_TOKEN_CORS_MAX_BODY_BYTES,
  hasPublicAuthCorsCredentials,
  isAllowedPublicOAuthTokenCorsPost,
  isAllowedPublicOAuthTokenCorsPreflight,
  isCrossOriginAuthRequest,
  isSameOrigin,
} from '../../src/runtime/server/api/auth/security'

const INIT_PATH = '/sign-in/social'

describe('auth proxy origin boundary', () => {
  it('accepts only one exact serialized origin', () => {
    expect(isSameOrigin('https://app.example.com', 'https://app.example.com')).toBe(true)
    expect(isSameOrigin('http://app.example.com', 'https://app.example.com')).toBe(false)
    expect(isSameOrigin('https://app.example.com:444', 'https://app.example.com')).toBe(false)
    expect(isSameOrigin('https://app.example.com:443', 'https://app.example.com')).toBe(false)
    expect(isSameOrigin('https://APP.example.com', 'https://app.example.com')).toBe(false)
    expect(isSameOrigin('https://app.example.com.', 'https://app.example.com')).toBe(false)
    expect(isSameOrigin('https://app.example.com/path', 'https://app.example.com')).toBe(false)
    expect(isSameOrigin('not-an-origin', 'https://app.example.com')).toBe(false)
  })

  it('allows headerless server clients and ignores callback Referer metadata on GET', () => {
    expect(
      isCrossOriginAuthRequest(new Headers(), 'POST', 'https://app.example.com', INIT_PATH),
    ).toBe(false)
    expect(
      isCrossOriginAuthRequest(
        new Headers({
          referer: 'https://provider.example/callback',
          'sec-fetch-site': 'cross-site',
        }),
        'GET',
        'https://app.example.com',
        '/callback/github',
      ),
    ).toBe(false)
  })

  it.each(['https://evil.example', 'null', '', 'not-an-origin'])(
    'rejects a present non-matching Origin: %s',
    (origin) => {
      expect(
        isCrossOriginAuthRequest(
          new Headers({ origin }),
          'GET',
          'https://app.example.com',
          INIT_PATH,
        ),
      ).toBe(true)
    },
  )

  it.each(['cross-site', 'same-site', 'same-origin, cross-site', 'CROSS-SITE'])(
    'rejects explicit non-same-origin POST Fetch Metadata: %s',
    (site) => {
      expect(
        isCrossOriginAuthRequest(
          new Headers({ origin: 'https://app.example.com', 'sec-fetch-site': site }),
          'POST',
          'https://app.example.com',
          INIT_PATH,
        ),
      ).toBe(true)
    },
  )

  it('uses Referer only as a POST fallback when Origin is absent', () => {
    expect(
      isCrossOriginAuthRequest(
        new Headers({
          origin: 'https://app.example.com',
          referer: 'https://evil.example/path',
        }),
        'POST',
        'https://app.example.com',
        INIT_PATH,
      ),
    ).toBe(false)
    expect(
      isCrossOriginAuthRequest(
        new Headers({ referer: 'https://app.example.com:443/path?query=1' }),
        'POST',
        'https://app.example.com',
        INIT_PATH,
      ),
    ).toBe(false)
    expect(
      isCrossOriginAuthRequest(
        new Headers({ referer: 'https://evil.example/path' }),
        'POST',
        'https://app.example.com',
        INIT_PATH,
      ),
    ).toBe(true)
    expect(
      isCrossOriginAuthRequest(
        new Headers({ referer: 'https://user@app.example.com/path' }),
        'POST',
        'https://app.example.com',
        INIT_PATH,
      ),
    ).toBe(true)
    expect(
      isCrossOriginAuthRequest(
        new Headers({ referer: 'not-a-url' }),
        'POST',
        'https://app.example.com',
        INIT_PATH,
      ),
    ).toBe(true)
  })

  it('exempts only one well-formed core OAuth POST callback segment', () => {
    const providerPost = new Headers({
      origin: 'https://appleid.apple.com',
      referer: 'https://appleid.apple.com/',
      'sec-fetch-site': 'cross-site',
    })
    expect(
      isCrossOriginAuthRequest(providerPost, 'POST', 'https://app.example.com', '/callback/apple'),
    ).toBe(false)

    for (const path of [
      '/callback/',
      '/callback/apple/extra',
      '/callback/%2Fupstream-owned',
      '/callback/%5Cupstream-owned',
      '/callback/%2e%2e',
      '/callback/%00apple',
      '/callback/%',
      '/oauth2/callback/apple',
      '/plugin/callback/apple',
    ]) {
      expect(
        isCrossOriginAuthRequest(providerPost, 'POST', 'https://app.example.com', path),
        path,
      ).toBe(true)
    }
    expect(
      isCrossOriginAuthRequest(providerPost, 'GET', 'https://app.example.com', '/callback/apple'),
    ).toBe(true)
  })
})

describe('public OAuth token browser transport boundary', () => {
  const publicOrigin = 'https://app.example.com'
  const clientOrigin = 'http://127.0.0.1:6274'
  const postHeaders = () =>
    new Headers({
      'content-length': '128',
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      origin: clientOrigin,
      'sec-fetch-site': 'cross-site',
    })

  it('recognizes every explicit credential header case-insensitively', () => {
    expect(hasPublicAuthCorsCredentials(new Headers())).toBe(false)
    for (const [name, value] of [
      ['Authorization', ''],
      ['COOKIE', 'better-auth.session_token=secret'],
      ['DPoP', 'proof'],
      ['Proxy-Authorization', 'Basic secret'],
    ] as const) {
      expect(hasPublicAuthCorsCredentials(new Headers({ [name]: value })), name).toBe(true)
    }
  })

  it('admits only one credential-free, bounded cross-origin form POST', () => {
    expect(
      isAllowedPublicOAuthTokenCorsPost(
        postHeaders(),
        'POST',
        publicOrigin,
        '/oauth2/token',
        false,
      ),
    ).toBe(true)

    for (const [name, mutate] of [
      ['cookie', (headers: Headers) => headers.set('cookie', 'better-auth.session_token=secret')],
      ['authorization', (headers: Headers) => headers.set('authorization', 'Basic secret')],
      ['DPoP', (headers: Headers) => headers.set('dpop', 'proof')],
      ['proxy authorization', (headers: Headers) => headers.set('proxy-authorization', 'Basic x')],
      ['JSON', (headers: Headers) => headers.set('content-type', 'application/json')],
      [
        'oversize body',
        (headers: Headers) =>
          headers.set('content-length', String(OAUTH_TOKEN_CORS_MAX_BODY_BYTES + 1)),
      ],
      ['invalid length', (headers: Headers) => headers.set('content-length', '+1')],
      [
        'preflight marker',
        (headers: Headers) => headers.set('access-control-request-method', 'POST'),
      ],
    ] as const) {
      const headers = postHeaders()
      mutate(headers)
      expect(
        isAllowedPublicOAuthTokenCorsPost(headers, 'POST', publicOrigin, '/oauth2/token', false),
        name,
      ).toBe(false)
    }
  })

  it('rejects every method, path, query, same-origin, or malformed-Origin expansion', () => {
    for (const [method, path, query] of [
      ['GET', '/oauth2/token', false],
      ['PUT', '/oauth2/token', false],
      ['POST', '/oauth2/token/', false],
      ['POST', '/oauth2/revoke', false],
      ['POST', '/get-session', false],
      ['POST', '/oauth2/token', true],
    ] as const) {
      expect(
        isAllowedPublicOAuthTokenCorsPost(postHeaders(), method, publicOrigin, path, query),
      ).toBe(false)
    }

    for (const origin of [
      publicOrigin,
      `${clientOrigin}/`,
      'https://user@example.test',
      'null',
      'file://client',
      'not-an-origin',
    ]) {
      const headers = postHeaders()
      headers.set('origin', origin)
      expect(
        isAllowedPublicOAuthTokenCorsPost(headers, 'POST', publicOrigin, '/oauth2/token', false),
        origin,
      ).toBe(false)
    }
  })

  it('admits only the exact public-token preflight surface', () => {
    const preflight = new Headers({
      'access-control-request-headers': 'Content-Type',
      'access-control-request-method': 'POST',
      origin: clientOrigin,
    })
    expect(
      isAllowedPublicOAuthTokenCorsPreflight(
        preflight,
        'OPTIONS',
        publicOrigin,
        '/oauth2/token',
        false,
      ),
    ).toBe(true)

    for (const [name, mutate] of [
      [
        'authorization request header',
        (headers: Headers) =>
          headers.set('access-control-request-headers', 'content-type, authorization'),
      ],
      [
        'private network',
        (headers: Headers) => headers.set('access-control-request-private-network', 'true'),
      ],
      ['wrong method', (headers: Headers) => headers.set('access-control-request-method', 'PUT')],
      ['cookie', (headers: Headers) => headers.set('cookie', 'secret=1')],
      ['authorization', (headers: Headers) => headers.set('authorization', 'Basic secret')],
    ] as const) {
      const headers = new Headers(preflight)
      mutate(headers)
      expect(
        isAllowedPublicOAuthTokenCorsPreflight(
          headers,
          'OPTIONS',
          publicOrigin,
          '/oauth2/token',
          false,
        ),
        name,
      ).toBe(false)
    }
  })
})
