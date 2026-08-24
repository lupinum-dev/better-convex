import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assertSafePinnedClientProvisioning,
  assertSafePinnedClientUpdate,
  assertSafePinnedResourceProvisioning,
} from '../../src/runtime/convex-auth/oauth-provider-compat'
import {
  assertOAuthAccessTokenClaims,
  assertSafeStoredOAuthClient,
  assertSafeStoredOAuthClientResource,
  assertSafeStoredOAuthResource,
  hardenOAuthProviderCallbacks,
  installUrlCanParseCompatibility,
  parseBoundedFormRequest,
  projectOAuthAuthorizationServerMetadata,
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
    redirectUris: ['https://client.example.test/callback'],
    requirePKCE: true,
    responseTypes: ['code'],
    scopes: [...scopes],
    skipConsent: false,
    subjectType: 'public',
    tokenEndpointAuthMethod: 'client_secret_basic',
    applicationType: 'web',
    ...overrides,
  }
}

function provisioningClient(overrides: Record<string, unknown> = {}) {
  return {
    dpop_bound_access_tokens: false,
    enable_end_session: false,
    grant_types: ['authorization_code'],
    redirect_uris: ['https://client.example.test/callback'],
    require_pkce: true,
    response_types: ['code'],
    scope: 'mcp:read mcp:write',
    skip_consent: false,
    token_endpoint_auth_method: 'client_secret_basic',
    application_type: 'web',
    ...overrides,
  }
}

function storedPublicClient(overrides: Record<string, unknown> = {}) {
  return storedClient({
    clientId: 'public-client',
    clientSecret: null,
    redirectUris: ['http://127.0.0.1:3334/oauth/callback'],
    tokenEndpointAuthMethod: 'none',
    applicationType: 'native',
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

function provisioningResource(overrides: Record<string, unknown> = {}) {
  return {
    accessTokenTtl: 600,
    allowedScopes: [...scopes],
    disabled: false,
    dpopBoundAccessTokensRequired: false,
    identifier: resource,
    name: 'MCP',
    signingAlgorithm: 'RS256',
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
    { futureProviderOption: true },
    { signup: { page: '/signup' } },
    { signup: { page: 'https://evil.example/signup' } },
    { selectAccount: { page: '//evil.example/select', shouldRedirect: async () => true } },
    {
      postLogin: {
        consentReferenceId: async () => 'tenant',
        page: '/post-login?next=evil',
        shouldRedirect: async () => true,
      },
    },
  ])('rejects unknown and unreviewed redirect-capable provider options %#', (override) => {
    expect(() =>
      validateOAuthProviderProfile(
        oauthOptions(override as unknown as Partial<PinnedOAuthProviderProfile>),
      ),
    ).toThrow('AUTH_OAUTH_CONFIG_INVALID')
  })

  it.each(['https://evil.example/login', '//evil.example/login', '/login?next=/admin', '/login#x'])(
    'rejects unsafe login and consent page target %s',
    (page) => {
      expect(() => validateOAuthProviderProfile(oauthOptions({ loginPage: page }))).toThrow(
        'AUTH_OAUTH_CONFIG_INVALID',
      )
      expect(() => validateOAuthProviderProfile(oauthOptions({ consentPage: page }))).toThrow(
        'AUTH_OAUTH_CONFIG_INVALID',
      )
    },
  )

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
        { id: 'opaque-link-row', clientId: 'client-1', resourceId: resource },
        'client-1',
        resource,
      ),
    ).not.toThrow()
  })

  it.each([
    {
      clientSecret: 'hashed-secret',
      tokenEndpointAuthMethod: 'none',
      applicationType: 'native',
    },
    { clientSecret: null, tokenEndpointAuthMethod: 'none', applicationType: 'web' },
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
    { clientCredentialsScopes: ['mcp:read'] },
    { clientDiscoveryId: 'discovery-client' },
    { public: false },
    { type: 'web' },
    { expiresAt: new Date(0) },
  ])('rejects a malicious or drifted stored client %#', (override) => {
    expect(() => assertSafeStoredOAuthClient(storedClient(override), scopes)).toThrow(
      'AUTH_OAUTH_CONFIG_INVALID',
    )
  })

  it.each([
    { clientSecret: 'secret' },
    { tokenEndpointAuthMethod: 'client_secret_basic' },
    { applicationType: 'web' },
    { public: true },
    { type: 'native' },
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

describe('admin OAuth provisioning boundary', () => {
  function expectClientProfile4xx(run: () => void): void {
    expect(run).toThrow(
      expect.objectContaining({
        body: { message: 'AUTH_OAUTH_CLIENT_PROFILE_INVALID' },
        status: 'BAD_REQUEST',
        statusCode: 400,
      }),
    )
  }

  function expectResourceProfile4xx(run: () => void): void {
    expect(run).toThrow(
      expect.objectContaining({
        body: { message: 'AUTH_OAUTH_RESOURCE_PROFILE_INVALID' },
        status: 'BAD_REQUEST',
        statusCode: 400,
      }),
    )
  }

  it.each(['mcp:read  mcp:write', 'mcp:read mcp:read'])(
    'maps malformed scope %j to the reviewed client-profile 4xx',
    (scope) => {
      expectClientProfile4xx(() =>
        assertSafePinnedClientProvisioning('POST', provisioningClient({ scope }), scopes),
      )
    },
  )

  it('requires the explicit pinned mutation method at every provisioning boundary', () => {
    for (const method of [undefined, 'GET', 'PATCH']) {
      expectClientProfile4xx(() =>
        assertSafePinnedClientProvisioning(method, provisioningClient(), scopes),
      )
    }
    for (const method of [undefined, 'GET', 'POST']) {
      expectClientProfile4xx(() => assertSafePinnedClientUpdate(method, {}, scopes))
    }
    for (const method of [undefined, 'GET']) {
      expectResourceProfile4xx(() => assertSafePinnedResourceProvisioning(method, {}, scopes))
    }
  })

  it.each([
    {
      accepted: true,
      name: 'confidential-basic web client',
      request: {},
      stored: {},
    },
    {
      accepted: true,
      name: 'public-none native client',
      request: { token_endpoint_auth_method: 'none', application_type: 'native' },
      stored: {
        clientSecret: null,
        tokenEndpointAuthMethod: 'none',
        applicationType: 'native',
      },
    },
    {
      accepted: false,
      name: 'duplicate scope',
      request: { scope: 'mcp:read mcp:read' },
      stored: { scopes: ['mcp:read', 'mcp:read'] },
    },
    {
      accepted: false,
      name: 'unapproved scope',
      request: { scope: 'mcp:admin' },
      stored: { scopes: ['mcp:admin'] },
    },
    {
      accepted: false,
      name: 'PKCE disabled',
      request: { require_pkce: false },
      stored: { requirePKCE: false },
    },
    {
      accepted: false,
      name: 'consent skipped',
      request: { skip_consent: true },
      stored: { skipConsent: true },
    },
    {
      accepted: false,
      name: 'end session enabled',
      request: { enable_end_session: true },
      stored: { enableEndSession: true },
    },
    {
      accepted: false,
      name: 'DPoP enabled',
      request: { dpop_bound_access_tokens: true },
      stored: { dpopBoundAccessTokens: true },
    },
    {
      accepted: false,
      name: 'refresh grant',
      request: { grant_types: ['refresh_token'] },
      stored: { grantTypes: ['refresh_token'] },
    },
    {
      accepted: false,
      name: 'missing code response',
      request: { response_types: [] },
      stored: { responseTypes: [] },
    },
    {
      accepted: false,
      name: 'unsafe redirect',
      request: { redirect_uris: ['https://localhost/callback'] },
      stored: { redirectUris: ['https://localhost/callback'] },
    },
    {
      accepted: false,
      name: 'pairwise subject',
      request: { subject_type: 'pairwise' },
      stored: { subjectType: 'pairwise' },
    },
    {
      accepted: false,
      name: 'hidden metadata',
      request: { metadata: { privilege: 'admin' } },
      stored: { metadata: JSON.stringify({ privilege: 'admin' }) },
    },
    {
      accepted: false,
      name: 'expired client secret',
      request: { client_secret_expires_at: 1 },
      stored: { expiresAt: new Date(1000) },
    },
    {
      accepted: false,
      name: 'invalid client secret expiry',
      request: { client_secret_expires_at: 'not-a-time' },
      stored: { expiresAt: new Date(Number.NaN) },
    },
    {
      accepted: false,
      name: 'post authentication',
      request: { token_endpoint_auth_method: 'client_secret_post' },
      stored: { tokenEndpointAuthMethod: 'client_secret_post' },
    },
    {
      accepted: false,
      name: 'confidential native mismatch',
      request: { application_type: 'native' },
      stored: { applicationType: 'native' },
    },
  ])('keeps request and stored validation aligned: $name', ({ accepted, request, stored }) => {
    const requestValidation = () =>
      assertSafePinnedClientProvisioning('POST', provisioningClient(request), scopes)
    const storedValidation = () => assertSafeStoredOAuthClient(storedClient(stored), scopes)

    if (accepted) {
      expect(requestValidation).not.toThrow()
      expect(storedValidation).not.toThrow()
    } else {
      expectClientProfile4xx(requestValidation)
      expect(storedValidation).toThrow('AUTH_OAUTH_CONFIG_INVALID')
    }
  })

  it.each([
    {
      accepted: true,
      name: 'empty safe update',
      request: {},
      stored: {},
    },
    {
      accepted: true,
      name: 'scope narrowing',
      request: { scope: 'mcp:read' },
      stored: { scopes: ['mcp:read'] },
    },
    {
      accepted: true,
      name: 'safe redirect replacement',
      request: { redirect_uris: ['https://client.example.test/new-callback'] },
      stored: { redirectUris: ['https://client.example.test/new-callback'] },
    },
    {
      accepted: false,
      name: 'pairwise subject update',
      request: { subject_type: 'pairwise' },
      stored: { subjectType: 'pairwise' },
    },
    {
      accepted: false,
      name: 'disabled update',
      request: { disabled: true },
      stored: { disabled: true },
    },
    {
      accepted: false,
      name: 'invalid expiry update',
      request: { client_secret_expires_at: 'not-a-time' },
      stored: { expiresAt: new Date(Number.NaN) },
    },
    {
      accepted: false,
      name: 'duplicate scope update',
      request: { scope: 'mcp:read mcp:read' },
      stored: { scopes: ['mcp:read', 'mcp:read'] },
    },
    {
      accepted: false,
      name: 'confidential native update',
      request: { application_type: 'native' },
      stored: { applicationType: 'native' },
    },
    {
      accepted: false,
      name: 'hidden metadata update',
      request: { metadata: { privilege: 'admin' } },
      stored: { metadata: JSON.stringify({ privilege: 'admin' }) },
    },
  ])('keeps update and stored validation aligned: $name', ({ accepted, request, stored }) => {
    const requestValidation = () => assertSafePinnedClientUpdate('PATCH', request, scopes)
    const storedValidation = () => assertSafeStoredOAuthClient(storedClient(stored), scopes)

    if (accepted) {
      expect(requestValidation).not.toThrow()
      expect(storedValidation).not.toThrow()
    } else {
      expectClientProfile4xx(requestValidation)
      expect(storedValidation).toThrow('AUTH_OAUTH_CONFIG_INVALID')
    }
  })

  it.each([
    {
      accepted: true,
      name: 'fixed RS256 resource',
      request: {},
      stored: {},
    },
    {
      accepted: false,
      name: 'disabled resource',
      request: { disabled: true },
      stored: { disabled: true },
    },
    {
      accepted: false,
      name: 'DPoP-bound resource',
      request: { dpopBoundAccessTokensRequired: true },
      stored: { dpopBoundAccessTokensRequired: true },
    },
    {
      accepted: false,
      name: 'long token lifetime',
      request: { accessTokenTtl: 601 },
      stored: { accessTokenTtl: 601 },
    },
    {
      accepted: false,
      name: 'refresh token lifetime',
      request: { refreshTokenTtl: 600 },
      stored: { refreshTokenTtl: 600 },
    },
    {
      accepted: false,
      name: 'custom signing key',
      request: { signingKeyId: 'key-1' },
      stored: { signingKeyId: 'key-1' },
    },
    {
      accepted: false,
      name: 'custom claims',
      request: { customClaims: { role: 'admin' } },
      stored: { customClaims: JSON.stringify({ role: 'admin' }) },
    },
    {
      accepted: false,
      name: 'non-RS256 signing',
      request: { signingAlgorithm: 'ES256' },
      stored: { signingAlgorithm: 'ES256' },
    },
    {
      accepted: false,
      name: 'unapproved resource scope',
      request: { allowedScopes: ['mcp:admin'] },
      stored: { allowedScopes: ['mcp:admin'] },
    },
  ])(
    'keeps resource request and stored validation aligned: $name',
    ({ accepted, request, stored }) => {
      const requestValidation = () =>
        assertSafePinnedResourceProvisioning('POST', provisioningResource(request), scopes)
      const storedValidation = () => assertSafeStoredOAuthResource(storedResource(stored), scopes)

      if (accepted) {
        expect(requestValidation).not.toThrow()
        expect(storedValidation).not.toThrow()
      } else {
        expectResourceProfile4xx(requestValidation)
        expect(storedValidation).toThrow('AUTH_OAUTH_CONFIG_INVALID')
      }
    },
  )
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
