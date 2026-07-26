import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assertOAuthAccessTokenClaims,
  assertPkceS256,
  assertSafeStoredOAuthClient,
  assertSafeStoredOAuthClientResource,
  assertSafeStoredOAuthResource,
  hardenOAuthProviderCallbacks,
  installUrlCanParseCompatibility,
  parseBoundedFormRequest,
  projectOAuthAuthorizationServerMetadata,
  projectOAuthProtectedResourceMetadata,
  validateOAuthProviderProfile,
  validateOAuthRedirectUris,
  type PinnedOAuthProviderProfile,
} from '../../src/runtime/convex-auth/oauth-security'

const issuer = 'https://app.example.test/api/auth'
const resource = 'https://app.example.test/mcp'
const scopes = ['mcp:read', 'mcp:write'] as const

function oauthOptions(
  overrides: Partial<PinnedOAuthProviderProfile> = {},
): PinnedOAuthProviderProfile {
  return {
    accessTokenExpiresIn: 600,
    allowDynamicClientRegistration: false,
    allowPublicClientPrelogin: true,
    allowUnauthenticatedClientRegistration: false,
    clientPrivileges: async () => true,
    codeExpiresIn: 120,
    consentPage: '/oauth/consent',
    customAccessTokenClaims: async () => ({ token_use: 'oauth-access' }),
    dpop: { signingAlgorithms: [] },
    enforcePerClientResources: true,
    grantTypes: ['authorization_code'],
    loginPage: '/login',
    rateLimit: {
      authorize: { max: 30, window: 60 },
      revoke: { max: 30, window: 60 },
      token: { max: 20, window: 60 },
    },
    resourcePrivileges: async () => true,
    scopes: [...scopes],
    storeClientSecret: 'hashed',
    storeTokens: 'hashed',
    ...overrides,
  }
}

function storedClient(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'client-1',
    clientSecret: 'hashed-secret',
    dpopBoundAccessTokens: false,
    enableEndSession: false,
    grantTypes: ['authorization_code'],
    public: false,
    redirectUris: ['https://client.example.test/callback'],
    requirePKCE: true,
    responseTypes: ['code'],
    scopes: [...scopes],
    skipConsent: false,
    subjectType: 'public',
    tokenEndpointAuthMethod: 'client_secret_basic',
    type: 'web',
    ...overrides,
  }
}

function storedPublicClient(overrides: Record<string, unknown> = {}) {
  return storedClient({
    clientId: 'public-client',
    clientSecret: null,
    public: true,
    redirectUris: ['http://127.0.0.1:3334/oauth/callback'],
    tokenEndpointAuthMethod: 'none',
    type: 'native',
    ...overrides,
  })
}

function storedResource(overrides: Record<string, unknown> = {}) {
  return {
    accessTokenTtl: 600,
    allowedScopes: [...scopes],
    customClaims: null,
    disabled: false,
    dpopBoundAccessTokensRequired: false,
    identifier: resource,
    name: 'MCP',
    refreshTokenTtl: null,
    signingAlgorithm: 'RS256',
    signingKeyId: null,
    ...overrides,
  }
}

function validTokenClaims(overrides: Record<string, unknown> = {}) {
  return {
    aud: resource,
    azp: 'client-1',
    client_id: 'client-1',
    exp: 1600,
    iat: 1000,
    iss: issuer,
    jti: 'token-1',
    scope: 'mcp:read mcp:write',
    sid: 'session-1',
    sub: 'user-1',
    token_use: 'oauth-access',
    ...overrides,
  }
}

describe('fixed OAuth provider profile', () => {
  it('accepts only the authorization-code, short-lived, hashed-storage profile', () => {
    expect(() => validateOAuthProviderProfile(oauthOptions())).not.toThrow()
  })

  it.each([
    { grantTypes: ['client_credentials'] },
    { grantTypes: ['authorization_code', 'refresh_token'] },
    { accessTokenExpiresIn: 601 },
    { codeExpiresIn: 121 },
    { allowDynamicClientRegistration: true },
    { allowPublicClientPrelogin: false },
    { allowPublicClientPrelogin: undefined },
    { allowPublicClientPrelogin: 'yes' as never },
    { allowUnauthenticatedClientRegistration: true },
    { storeClientSecret: 'encrypted' },
    { storeTokens: 'plain' },
    { dpop: { signingAlgorithms: ['ES256'] } },
    { enforcePerClientResources: false },
    { scopes: ['openid', 'mcp:read'] },
    { scopes: ['mcp:read', 'mcp:read'] },
    { clientPrivileges: undefined },
    { resourcePrivileges: undefined },
    { customAccessTokenClaims: undefined },
    { requestUriResolver: () => ({}) },
    { extensions: [{}] },
    { m2mAccessTokenExpiresIn: 600 },
  ])('rejects beta profile drift %#', (override) => {
    expect(() =>
      validateOAuthProviderProfile(
        oauthOptions(override as unknown as Partial<PinnedOAuthProviderProfile>),
      ),
    ).toThrow('AUTH_OAUTH_CONFIG_INVALID')
  })

  it('wraps privilege callbacks so missing identity, errors, undefined, and timeouts deny', async () => {
    const options = oauthOptions({
      clientPrivileges: async ({ action }: { action?: unknown }) => {
        if (action === 'throw') throw new Error('secret callback detail')
        if (action === 'undefined') return undefined
        if (action === 'timeout') return new Promise<boolean>(() => {})
        return action === 'allow'
      },
    })
    const hardened = hardenOAuthProviderCallbacks(options)
    const identity = { headers: new Headers(), session: { id: 's' }, user: { id: 'u' } }

    await expect(hardened.clientPrivileges({ ...identity, action: 'allow' })).resolves.toBe(true)
    await expect(hardened.clientPrivileges({ ...identity, action: 'undefined' })).resolves.toBe(
      false,
    )
    await expect(hardened.clientPrivileges({ ...identity, action: 'throw' })).resolves.toBe(false)
    await expect(
      hardened.clientPrivileges({ headers: new Headers(), action: 'allow' }),
    ).resolves.toBe(false)
    const started = Date.now()
    await expect(hardened.clientPrivileges({ ...identity, action: 'timeout' })).resolves.toBe(false)
    expect(Date.now() - started).toBeGreaterThanOrEqual(450)
    expect(Date.now() - started).toBeLessThan(900)
  })

  it('enforces the one non-authorization token class claim', async () => {
    const safe = oauthOptions()
    const hardened = hardenOAuthProviderCallbacks(safe)
    await expect(hardened.customAccessTokenClaims({})).resolves.toEqual({
      token_use: 'oauth-access',
    })

    const unsafe = oauthOptions({
      customAccessTokenClaims: () => ({ role: 'admin', token_use: 'oauth-access' }),
    })
    await expect(hardenOAuthProviderCallbacks(unsafe).customAccessTokenClaims({})).rejects.toThrow(
      'AUTH_OAUTH_CONFIG_INVALID',
    )
  })
})

describe('stored OAuth beta inventory', () => {
  it('accepts only explicit confidential-basic and public-none profiles', () => {
    expect(() => assertSafeStoredOAuthClient(storedClient(), scopes)).not.toThrow()
    expect(() => assertSafeStoredOAuthClient(storedPublicClient(), scopes)).not.toThrow()
    expect(() => assertSafeStoredOAuthResource(storedResource(), scopes)).not.toThrow()
    expect(() =>
      assertSafeStoredOAuthClientResource(
        { id: `client-1::${resource}`, clientId: 'client-1', resourceId: resource },
        'client-1',
        resource,
      ),
    ).not.toThrow()
  })

  it.each([
    {
      public: true,
      clientSecret: 'hashed-secret',
      tokenEndpointAuthMethod: 'none',
      type: 'native',
    },
    { public: false, clientSecret: null, tokenEndpointAuthMethod: 'none', type: 'native' },
    { tokenEndpointAuthMethod: 'client_secret_post' },
    { tokenEndpointAuthMethod: 'private_key_jwt', jwks: '{}' },
    { grantTypes: ['refresh_token'] },
    { grantTypes: ['client_credentials'] },
    { responseTypes: [] },
    { requirePKCE: false },
    { skipConsent: true },
    { dpopBoundAccessTokens: true },
    { enableEndSession: true },
    { metadata: JSON.stringify({ dpop_bound_access_tokens: true }) },
    { expiresAt: new Date(0) },
  ])('rejects a malicious or drifted stored client %#', (override) => {
    expect(() => assertSafeStoredOAuthClient(storedClient(override), scopes)).toThrow(
      'AUTH_OAUTH_CONFIG_INVALID',
    )
  })

  it.each([
    { clientSecret: 'secret' },
    { public: false },
    { tokenEndpointAuthMethod: 'client_secret_basic' },
    { type: 'web' },
  ])('rejects a public client with secret or method ambiguity %#', (override) => {
    expect(() => assertSafeStoredOAuthClient(storedPublicClient(override), scopes)).toThrow(
      'AUTH_OAUTH_CONFIG_INVALID',
    )
  })

  it.each([
    { accessTokenTtl: 601 },
    { refreshTokenTtl: 3600 },
    { signingAlgorithm: 'ES256' },
    { signingKeyId: 'pinned-old-key' },
    { customClaims: { role: 'admin' } },
    { dpopBoundAccessTokensRequired: true },
    { allowedScopes: ['mcp:read', 'admin'] },
    { name: '' },
  ])('rejects a resource policy that escapes the beta profile %#', (override) => {
    expect(() => assertSafeStoredOAuthResource(storedResource(override), scopes)).toThrow(
      'AUTH_OAUTH_CONFIG_INVALID',
    )
  })

  it.each([
    'https://client.example.test/callback',
    'http://localhost:6274/oauth/callback',
    'http://127.0.0.1:3334/oauth/callback',
    'http://[::1]:3334/oauth/callback',
  ])('accepts an exact preregistered redirect %s', (redirectUri) => {
    expect(() => validateOAuthRedirectUris([redirectUri])).not.toThrow()
  })

  it.each([
    'https://client.example.test/callback#fragment',
    'https://client.example.test/callback#',
    'https://user@client.example.test/callback',
    'https://*.example.test/callback',
    'https://localhost:6274/oauth/callback',
    'https://127.0.0.1:3334/oauth/callback',
    'https://[::1]:3334/oauth/callback',
    'http://client.example.test/callback',
    'http://localhost/oauth/callback',
    'http://127.0.0.2:3334/oauth/callback',
    'http://localhost:0/oauth/callback',
  ])('rejects an unsafe redirect %s', (redirectUri) => {
    expect(() => validateOAuthRedirectUris([redirectUri])).toThrow('AUTH_OAUTH_CONFIG_INVALID')
  })
})

describe('pre-provider request parsing', () => {
  it('installs only the URL.canParse primitive missing from the Convex isolate', () => {
    const target: { canParse?: (input: string | URL, base?: string | URL) => boolean } = {}
    installUrlCanParseCompatibility(target)
    expect(target.canParse?.('https://resource.example.test/mcp')).toBe(true)
    expect(target.canParse?.('/relative-only')).toBe(false)
    expect(target.canParse?.('/relative', 'https://resource.example.test')).toBe(true)
    expect(target.canParse?.('not a URL')).toBe(false)

    const existing = target.canParse
    installUrlCanParseCompatibility(target)
    expect(target.canParse).toBe(existing)
  })

  it('accepts one bounded form value and never consumes the forwarded request', async () => {
    const request = new Request(`${issuer}/oauth2/token`, {
      body: 'grant_type=authorization_code&code=one',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    })
    const parsed = await parseBoundedFormRequest(request, ['grant_type', 'code'])
    expect(parsed.get('code')).toBe('one')
    expect(request.bodyUsed).toBe(false)
  })

  it.each(['code=one&code=two', 'code=one&client_secret=body-secret'])(
    'rejects duplicate or unrecognized security input %s',
    async (body) => {
      const request = new Request(`${issuer}/oauth2/token`, {
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      })
      await expect(parseBoundedFormRequest(request, ['code'])).rejects.toThrow(
        'AUTH_OAUTH_REQUEST_INVALID',
      )
    },
  )

  it('rejects non-form and oversized bodies before provider handling', async () => {
    const json = new Request(`${issuer}/oauth2/token`, {
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    await expect(parseBoundedFormRequest(json, ['code'])).rejects.toThrow(
      'AUTH_OAUTH_REQUEST_INVALID',
    )

    const oversized = new Request(`${issuer}/oauth2/token`, {
      body: `code=${'x'.repeat(128)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    })
    await expect(parseBoundedFormRequest(oversized, ['code'], 64)).rejects.toThrow(
      'AUTH_OAUTH_REQUEST_INVALID',
    )
  })

  it('requires a canonical S256 challenge', () => {
    expect(() => assertPkceS256('A'.repeat(43), 'S256')).not.toThrow()
    expect(() => assertPkceS256('A'.repeat(43), 'plain')).toThrow('AUTH_OAUTH_REQUEST_INVALID')
    expect(() => assertPkceS256('short', 'S256')).toThrow('AUTH_OAUTH_REQUEST_INVALID')
  })
})

describe('OAuth metadata projections', () => {
  function officialMetadata(overrides: Record<string, unknown> = {}) {
    return {
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      authorization_response_iss_parameter_supported: true,
      backchannel_logout_supported: true,
      code_challenge_methods_supported: ['S256'],
      dpop_signing_alg_values_supported: [],
      grant_types_supported: ['authorization_code'],
      introspection_endpoint: `${issuer}/oauth2/introspect`,
      issuer,
      jwks_uri: `${issuer}/jwks`,
      registration_endpoint: `${issuer}/oauth2/register`,
      revocation_endpoint: `${issuer}/oauth2/revoke`,
      response_types_supported: ['code'],
      scopes_supported: [...scopes],
      token_endpoint: `${issuer}/oauth2/token`,
      token_endpoint_auth_methods_supported: [
        'client_secret_basic',
        'client_secret_post',
        'private_key_jwt',
      ],
      ...overrides,
    }
  }

  it('derives a fixed allowlisted document from official provider metadata', () => {
    const projected = projectOAuthAuthorizationServerMetadata(officialMetadata(), issuer, scopes)
    expect(projected).toEqual({
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      authorization_response_iss_parameter_supported: true,
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code'],
      issuer,
      jwks_uri: `${issuer}/jwks`,
      revocation_endpoint: `${issuer}/oauth2/revoke`,
      response_types_supported: ['code'],
      scopes_supported: [...scopes],
      token_endpoint: `${issuer}/oauth2/token`,
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
    })
    for (const field of [
      'backchannel_logout_supported',
      'dpop_signing_alg_values_supported',
      'introspection_endpoint',
      'registration_endpoint',
    ]) {
      expect(projected).not.toHaveProperty(field)
    }
  })

  it('fails closed on wrong/off-origin official endpoints', () => {
    expect(() =>
      projectOAuthAuthorizationServerMetadata(
        officialMetadata({ token_endpoint: 'https://evil.example/token' }),
        issuer,
        scopes,
      ),
    ).toThrow('AUTH_OAUTH_CONFIG_INVALID')
    expect(() =>
      projectOAuthAuthorizationServerMetadata(
        officialMetadata({ pushed_authorization_request_endpoint: 'https://evil.example/par' }),
        issuer,
        scopes,
      ),
    ).toThrow('AUTH_OAUTH_CONFIG_INVALID')
  })

  it('omits DPoP and exposes header-only protected-resource metadata', () => {
    const projected = projectOAuthProtectedResourceMetadata(
      {
        authorization_servers: [issuer],
        dpop_signing_alg_values_supported: ['ES256'],
        resource,
        scopes_supported: [...scopes],
      },
      resource,
      issuer,
      scopes,
    )
    expect(projected).toEqual({
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
      resource,
      scopes_supported: [...scopes],
    })
    expect(projected).not.toHaveProperty('dpop_signing_alg_values_supported')
  })
})

describe('exact OAuth access-token class and bindings', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1_200 * 1_000))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const expectations = {
    allowedScopes: scopes,
    audience: resource,
    clientId: 'client-1',
    issuer,
    requiredScopes: ['mcp:write'],
    subject: 'user-1',
  } as const

  it('accepts the pinned provider JWT claim shape', () => {
    expect(assertOAuthAccessTokenClaims(validTokenClaims(), expectations)).toEqual({
      clientId: 'client-1',
      expiresAt: 1600,
      scopes: ['mcp:read', 'mcp:write'],
      sessionId: 'session-1',
      subject: 'user-1',
    })
  })

  it.each([
    { aud: [resource] },
    { aud: [resource, 'https://other.example/resource'] },
    { aud: 'https://other.example/resource' },
    { iss: 'https://evil.example/api/auth' },
    { client_id: 'client-2' },
    { azp: 'client-2' },
    { sub: 'user-2' },
    { sid: '' },
    { token_use: 'convex-session' },
    { token_use: undefined },
    { scope: 'mcp:read' },
    { scope: 'mcp:write admin' },
    { scope: 'mcp:write mcp:write' },
    { exp: 1601 },
    { exp: 1200 },
    { iat: 1201 },
    { cnf: { jkt: 'dpop-key' } },
    { role: 'admin' },
  ])('rejects token confusion or binding drift %#', (override) => {
    expect(() => assertOAuthAccessTokenClaims(validTokenClaims(override), expectations)).toThrow(
      'AUTH_OAUTH_TOKEN_INVALID',
    )
  })
})
