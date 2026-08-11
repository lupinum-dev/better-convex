import { oauthProvider, type OAuthOptions } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { jwt } from 'better-auth/plugins'
import { describe, expect, it } from 'vitest'

import { convexAuth } from '../../src/runtime/convex-auth/plugin'

const origin = 'https://app.example.test'
const issuer = `${origin}/api/auth`
const resource = `${origin}/mcp`
const publicClientId = 'bcn-mcp-remote-fixture'
const publicRedirectUri = 'http://127.0.0.1:3334/oauth/callback'
const noncanonicalLoopbackRedirects = [
  'http://127.1:49152/oauth/callback',
  'http://2130706433:49152/oauth/callback',
  'http://0x7f000001:49152/oauth/callback',
  'http://0177.0.0.1:49152/oauth/callback',
  'http://127.0.0.1:49152/oauth/callback#',
] as const
const secret = 'd0f9e60506f248f7b87656005dd789a3282eb7f6a1224eebb6417261d8cf6d47'

const disabledPaths = [
  '/token',
  '/get-access-token',
  '/refresh-token',
  '/.well-known/openid-configuration',
  '/oauth2/register',
  '/oauth2/introspect',
  '/oauth2/userinfo',
  '/oauth2/end-session',
  '/oauth2/create-client',
  '/oauth2/get-client',
  '/oauth2/get-clients',
  '/oauth2/update-client',
  '/oauth2/client/rotate-secret',
  '/oauth2/delete-client',
]

function createOAuthOptions() {
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
    scopes: ['mcp:read', 'mcp:write'],
    storeClientSecret: 'hashed',
    storeTokens: 'hashed',
  } satisfies OAuthOptions<['mcp:read', 'mcp:write']>
}

function database(): MemoryDB {
  return {
    oauthClient: [
      {
        id: 'client-row',
        clientId: 'client-1',
        clientSecret: 'stored-hash',
        disabled: false,
        dpopBoundAccessTokens: false,
        enableEndSession: false,
        grantTypes: ['authorization_code'],
        public: false,
        redirectUris: ['https://client.example.test/callback'],
        requirePKCE: true,
        responseTypes: ['code'],
        scopes: ['mcp:read', 'mcp:write'],
        skipConsent: false,
        subjectType: 'public',
        tokenEndpointAuthMethod: 'client_secret_basic',
        type: 'web',
      },
      {
        id: 'public-client-row',
        clientId: publicClientId,
        disabled: false,
        dpopBoundAccessTokens: false,
        enableEndSession: false,
        grantTypes: ['authorization_code'],
        public: true,
        redirectUris: [publicRedirectUri],
        requirePKCE: true,
        responseTypes: ['code'],
        scopes: ['mcp:read', 'mcp:write'],
        skipConsent: false,
        subjectType: 'public',
        tokenEndpointAuthMethod: 'none',
        type: 'native',
      },
    ],
    oauthClientResource: [
      {
        id: `client-1::${resource}`,
        clientId: 'client-1',
        resourceId: resource,
      },
      {
        id: `${publicClientId}::${resource}`,
        clientId: publicClientId,
        resourceId: resource,
      },
    ],
    oauthResource: [
      {
        id: 'resource-row',
        accessTokenTtl: 600,
        allowedScopes: ['mcp:read', 'mcp:write'],
        disabled: false,
        dpopBoundAccessTokensRequired: false,
        identifier: resource,
        name: 'MCP',
        signingAlgorithm: 'RS256',
      },
    ],
    rateLimit: [],
    verification: [],
  }
}

function createAuth(
  db: MemoryDB,
  configure?: (options: ReturnType<typeof createOAuthOptions>) => void,
) {
  const options = createOAuthOptions()
  configure?.(options)
  return betterAuth({
    account: { encryptOAuthTokens: true, storeAccountCookie: false },
    advanced: { ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } },
    basePath: '/api/auth',
    baseURL: origin,
    database: memoryAdapter(db),
    disabledPaths,
    logger: { disabled: true },
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: {
          disablePrivateKeyEncryption: false,
          gracePeriod: 21 * 60,
          keyPairConfig: { alg: 'RS256' },
        },
        jwt: { audience: issuer, expirationTime: '10m', issuer },
      }),
      convexAuth({
        authConfig: {
          providers: [
            {
              algorithm: 'RS256',
              applicationID: 'convex',
              issuer: 'https://deployment.convex.site',
              jwks: 'https://app.example.test/api/auth/jwks',
              type: 'customJwt',
            },
          ],
        },
        oauthProvider: options,
        sessionJwt: {
          audience: 'convex',
          expirationTime: '15m',
          issuer: 'https://deployment.convex.site',
        },
      }),
      oauthProvider(options),
    ],
    rateLimit: { enabled: true, modelName: 'rateLimit', storage: 'database' },
    secret,
    trustedOrigins: [origin],
    verification: { storeIdentifier: 'hashed' },
  })
}

function tokenRequest(body: string, authorization?: string): Request {
  return new Request(`${issuer}/oauth2/token`, {
    body,
    headers: {
      ...(authorization ? { authorization } : {}),
      'content-type': 'application/x-www-form-urlencoded',
      'x-bcn-verified-client-ip': '192.0.2.20',
    },
    method: 'POST',
  })
}

function authorizationCodeBody(overrides: Record<string, null | string> = {}): string {
  const parameters = new URLSearchParams({
    code: 'not-a-code',
    code_verifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~',
    grant_type: 'authorization_code',
    redirect_uri: 'https://client.example.test/callback',
    resource,
  })
  for (const [field, value] of Object.entries(overrides)) {
    if (value === null) parameters.delete(field)
    else parameters.set(field, value)
  }
  return parameters.toString()
}

function authorizeUrl(overrides: Record<string, string[]> = {}): string {
  const parameters = new URLSearchParams({
    client_id: 'client-1',
    code_challenge: 'A'.repeat(43),
    code_challenge_method: 'S256',
    redirect_uri: 'https://client.example.test/callback',
    resource,
    response_type: 'code',
    scope: 'mcp:read',
    state: 'state-1',
  })
  for (const [field, values] of Object.entries(overrides)) {
    parameters.delete(field)
    for (const value of values) parameters.append(field, value)
  }
  return `${issuer}/oauth2/authorize?${parameters}`
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  )
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

async function seedPublicAuthorizationCode(
  db: MemoryDB,
  code: string,
  codeVerifier: string,
  redirectUri = publicRedirectUri,
): Promise<void> {
  const now = new Date()
  db.verification = [
    {
      id: 'authorization-code-row',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 120_000),
      identifier: await sha256Base64Url(code),
      updatedAt: now,
      value: JSON.stringify({
        query: {
          client_id: publicClientId,
          code_challenge: await sha256Base64Url(codeVerifier),
          code_challenge_method: 'S256',
          redirect_uri: redirectUri,
          resource,
          response_type: 'code',
          scope: 'mcp:read',
        },
        resource: [resource],
        sessionId: 'session-1',
        type: 'authorization_code',
        userId: 'user-1',
      }),
    },
  ]
}

function authorizationError(response: Response): URL {
  expect(response.status).toBe(302)
  const location = response.headers.get('location')
  expect(location).toBeTruthy()
  return new URL(location!, origin)
}

describe('pinned OAuth provider lifecycle and pre-provider barrier', () => {
  it('initializes the exact jwt -> convexAuth -> oauthProvider graph', async () => {
    const auth = createAuth(database())
    await expect(auth.$context).resolves.toBeDefined()
  })

  it('projects official discovery down to public-none and confidential-basic code clients', async () => {
    const auth = createAuth(database())
    const response = await auth.handler(
      new Request(`${origin}/.well-known/oauth-authorization-server/api/auth`),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      authorization_response_iss_parameter_supported: true,
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code'],
      issuer,
      jwks_uri: `${issuer}/jwks`,
      revocation_endpoint: `${issuer}/oauth2/revoke`,
      response_types_supported: ['code'],
      scopes_supported: ['mcp:read', 'mcp:write'],
      token_endpoint: `${issuer}/oauth2/token`,
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
    })
  })

  it('rejects post/assertion/mixed and duplicate resource input before code lookup', async () => {
    const db = database()
    const auth = createAuth(db)
    const common =
      'grant_type=authorization_code&code=not-a-code&redirect_uri=https%3A%2F%2Fclient.example.test%2Fcallback&code_verifier=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'

    const post = await auth.handler(
      tokenRequest(`${common}&resource=${encodeURIComponent(resource)}&client_secret=body-secret`),
    )
    const assertion = await auth.handler(
      tokenRequest(
        `${common}&resource=${encodeURIComponent(resource)}&client_assertion=jwt&client_assertion_type=urn`,
      ),
    )
    const duplicate = await auth.handler(
      tokenRequest(
        `${common}&resource=${encodeURIComponent(resource)}&resource=${encodeURIComponent(resource)}`,
        `Basic ${btoa('client-1:wrong-secret')}`,
      ),
    )

    expect(post.status).toBe(401)
    expect(assertion.status).toBe(401)
    expect(duplicate.status).toBe(400)
    await expect(post.json()).resolves.toEqual({ error: 'invalid_client' })
    await expect(assertion.json()).resolves.toEqual({
      error: 'invalid_client',
    })
    await expect(duplicate.json()).resolves.toEqual({
      error: 'invalid_request',
    })
    expect(db.rateLimit).toHaveLength(1)
    expect(db.rateLimit![0]).toMatchObject({ count: 3 })
  })

  it('lets a safe Basic profile reach the official consume boundary without checking its secret early', async () => {
    const auth = createAuth(database())
    const response = await auth.handler(
      tokenRequest(authorizationCodeBody(), `Basic ${btoa('client-1:wrong-secret')}`),
    )
    const body = (await response.json()) as { error?: string }
    expect(response.status).toBe(400)
    expect(body.error).toBe('invalid_grant')
  })

  it('lets an exact public-none client reach code consumption with body client_id and no secret', async () => {
    const auth = createAuth(database())
    const response = await auth.handler(
      tokenRequest(
        authorizationCodeBody({
          client_id: publicClientId,
          redirect_uri: publicRedirectUri,
        }),
      ),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_grant',
    })
  })

  it('rejects mixed, crossed, unknown, and secret-bearing public authentication', async () => {
    const auth = createAuth(database())
    const publicBody = authorizationCodeBody({
      client_id: publicClientId,
      redirect_uri: publicRedirectUri,
    })
    const attempts = [
      tokenRequest(publicBody, `Basic ${btoa('client-1:secret')}`),
      tokenRequest(authorizationCodeBody({ client_id: 'client-1' })),
      tokenRequest(authorizationCodeBody(), `Basic ${btoa(`${publicClientId}:secret`)}`),
      tokenRequest(`${publicBody}&client_secret=secret`),
      tokenRequest(
        authorizationCodeBody({
          client_id: 'unknown-public-client',
          redirect_uri: publicRedirectUri,
        }),
      ),
      tokenRequest(publicBody, 'Bearer not-client-authentication'),
    ]

    for (const attempt of attempts) {
      const response = await auth.handler(attempt)
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({
        error: 'invalid_client',
      })
    }
  })

  it('rejects an unregistered redirect shape before authorization-code consumption', async () => {
    const db = database()
    const code = 'registered-shape-code'
    const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'
    await seedPublicAuthorizationCode(db, code, verifier)
    const auth = createAuth(db)
    const wrongRedirect = await auth.handler(
      tokenRequest(
        authorizationCodeBody({
          client_id: publicClientId,
          code,
          code_verifier: verifier,
          redirect_uri: 'http://127.0.0.1:3334/not-registered',
        }),
      ),
    )
    expect(wrongRedirect.status).toBe(400)
    await expect(wrongRedirect.json()).resolves.toEqual({
      error: 'invalid_request',
    })
    expect(db.verification).toHaveLength(1)
  })

  it('requires a bounded PKCE verifier before public code consumption', async () => {
    const auth = createAuth(database())
    const missingVerifier = await auth.handler(
      tokenRequest(
        authorizationCodeBody({
          client_id: publicClientId,
          code_verifier: null,
          redirect_uri: publicRedirectUri,
        }),
      ),
    )
    expect(missingVerifier.status).toBe(400)
    await expect(missingVerifier.json()).resolves.toEqual({
      error: 'invalid_request',
    })
  })

  it('returns the one-resource product error only through a trusted callback', async () => {
    const auth = createAuth(database())
    const missingResource = await auth.handler(new Request(authorizeUrl({ resource: [] })))
    const duplicateResource = await auth.handler(
      new Request(authorizeUrl({ resource: [resource, resource] })),
    )

    for (const response of [missingResource, duplicateResource]) {
      const location = authorizationError(response)
      expect(`${location.origin}${location.pathname}`).toBe('https://client.example.test/callback')
      expect(location.searchParams.get('error')).toBe('invalid_target')
      expect(location.searchParams.get('error_description')).toBe(
        'exactly one resource is required',
      )
      expect(location.searchParams.get('state')).toBe('state-1')
      expect(location.searchParams.get('iss')).toBe(issuer)
    }
  })

  it('delegates PKCE and scope errors to the provider authorization response', async () => {
    const auth = createAuth(database())
    const plainPkce = await auth.handler(
      new Request(authorizeUrl({ code_challenge_method: ['plain'] })),
    )
    const unsupportedScope = await auth.handler(new Request(authorizeUrl({ scope: ['mcp:admin'] })))

    for (const [response, error] of [
      [plainPkce, 'invalid_request'],
      [unsupportedScope, 'invalid_scope'],
    ] as const) {
      const location = authorizationError(response)
      expect(`${location.origin}${location.pathname}`).toBe('https://client.example.test/callback')
      expect(location.searchParams.get('error')).toBe(error)
      expect(location.searchParams.get('state')).toBe('state-1')
      expect(location.searchParams.get('iss')).toBe(issuer)
    }
  })

  it.each([
    { skipConsent: true },
    { dpopBoundAccessTokens: true },
    { requirePKCE: false },
    { grantTypes: ['refresh_token'] },
  ])('rejects stored client profile drift before provider authorization %#', async (drift) => {
    const db = database()
    Object.assign(db.oauthClient![0]!, drift)
    const auth = createAuth(db)
    const response = await auth.handler(new Request(authorizeUrl()))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_client',
    })
    expect(db.verification).toHaveLength(0)
  })

  it.each([
    'https://localhost:3334/oauth/callback',
    'https://127.0.0.1:3334/oauth/callback',
    'https://[::1]:3334/oauth/callback',
  ])('rejects an HTTPS loopback stored profile before provider authorization: %s', async (uri) => {
    const db = database()
    db.oauthClient![1]!.redirectUris = [uri]
    const auth = createAuth(db)
    const response = await auth.handler(
      new Request(
        authorizeUrl({
          client_id: [publicClientId],
          redirect_uri: [uri],
        }),
      ),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_client' })
    expect(db.verification).toHaveLength(0)
  })

  it('redirects unsafe resource inventory failures only to the trusted callback', async () => {
    const db = database()
    db.oauthClientResource = []
    const auth = createAuth(db)
    const response = await auth.handler(new Request(authorizeUrl()))
    const location = authorizationError(response)

    expect(`${location.origin}${location.pathname}`).toBe('https://client.example.test/callback')
    expect(location.searchParams.get('error')).toBe('invalid_target')
    expect(location.searchParams.get('error_description')).toBe('requested resource is invalid')
    expect(location.searchParams.get('state')).toBe('state-1')
    expect(db.verification).toHaveLength(0)
  })

  it('rejects malformed authorization transport before provider handling', async () => {
    const auth = createAuth(database())
    const requests = [
      new Request(`${issuer}/oauth2/authorize`, { method: 'PUT' }),
      new Request(`${issuer}/oauth2/authorize`, {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      new Request(`${issuer}/oauth2/authorize`, {
        body: `client_id=client-1&padding=${'x'.repeat(8_192)}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      }),
      new Request(`${issuer}/oauth2/authorize`, {
        body: 'client_id=client-1',
        headers: {
          'content-length': '8193',
          'content-type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
      }),
    ]

    for (const request of requests) {
      const response = await auth.handler(request)
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'invalid_request',
      })
    }
  })

  it('never sends an authorization error to an unregistered callback', async () => {
    const auth = createAuth(database())
    const unregisteredRedirect = await auth.handler(
      new Request(
        authorizeUrl({
          redirect_uri: ['https://client.example.test/not-registered'],
        }),
      ),
    )
    const location = authorizationError(unregisteredRedirect)

    expect(`${location.origin}${location.pathname}`).toBe(`${issuer}/error`)
    expect(location.searchParams.get('error')).toBe('invalid_redirect')
    expect(location.href).not.toContain('/not-registered')
  })

  it.each(noncanonicalLoopbackRedirects)(
    'rejects a noncanonical loopback authorization callback before provider state: %s',
    async (redirectUri) => {
      const db = database()
      const auth = createAuth(db)
      const response = await auth.handler(
        new Request(
          authorizeUrl({
            client_id: [publicClientId],
            redirect_uri: [redirectUri],
          }),
        ),
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'invalid_request' })
      expect(db.verification).toHaveLength(0)
    },
  )

  it.each(noncanonicalLoopbackRedirects)(
    'rejects a noncanonical loopback token callback without consuming the code: %s',
    async (redirectUri) => {
      const db = database()
      const code = `noncanonical-${redirectUri}`
      const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'
      await seedPublicAuthorizationCode(db, code, verifier)
      const auth = createAuth(db)
      const response = await auth.handler(
        tokenRequest(
          authorizationCodeBody({
            client_id: publicClientId,
            code,
            code_verifier: verifier,
            redirect_uri: redirectUri,
          }),
        ),
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'invalid_request' })
      expect(db.verification).toHaveLength(1)
    },
  )

  it('accepts RFC 8252 ephemeral ports but keeps scheme, address, path, and query bound', async () => {
    const auth = createAuth(database())
    const ephemeralRedirect = 'http://127.0.0.1:49152/oauth/callback'
    const authorize = await auth.handler(
      new Request(
        authorizeUrl({
          client_id: [publicClientId],
          redirect_uri: [ephemeralRedirect],
        }),
      ),
    )
    expect(authorize.status).toBe(302)
    expect(authorize.headers.get('location')).toMatch(/^\/login\?/u)

    const missingResource = await auth.handler(
      new Request(
        authorizeUrl({
          client_id: [publicClientId],
          redirect_uri: [ephemeralRedirect],
          resource: [],
        }),
      ),
    )
    const missingResourceLocation = authorizationError(missingResource)
    expect(`${missingResourceLocation.origin}${missingResourceLocation.pathname}`).toBe(
      ephemeralRedirect,
    )
    expect(missingResourceLocation.searchParams.get('error')).toBe('invalid_target')

    const token = await auth.handler(
      tokenRequest(
        authorizationCodeBody({
          client_id: publicClientId,
          redirect_uri: ephemeralRedirect,
        }),
      ),
    )
    expect(token.status).toBe(400)
    await expect(token.json()).resolves.toMatchObject({
      error: 'invalid_grant',
    })

    const changedPath = await auth.handler(
      tokenRequest(
        authorizationCodeBody({
          client_id: publicClientId,
          redirect_uri: 'http://127.0.0.1:49152/other',
        }),
      ),
    )
    expect(changedPath.status).toBe(400)
    await expect(changedPath.json()).resolves.toEqual({
      error: 'invalid_request',
    })
  })

  it('lets the provider consume a code when the request uses another registered callback', async () => {
    const db = database()
    const alternateRedirect = 'http://127.0.0.1:3334/other-registered'
    db.oauthClient![1]!.redirectUris.push(alternateRedirect)
    const code = 'code-bound-redirect-code'
    const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'
    await seedPublicAuthorizationCode(db, code, verifier)
    const auth = createAuth(db)
    const response = await auth.handler(
      tokenRequest(
        authorizationCodeBody({
          client_id: publicClientId,
          code,
          code_verifier: verifier,
          redirect_uri: alternateRedirect,
        }),
      ),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_grant',
    })
    expect(db.verification).toHaveLength(0)
  })

  it('forwards a safe authorize profile to the official signed login transaction', async () => {
    const auth = createAuth(database())
    const responses = [
      await auth.handler(new Request(authorizeUrl())),
      await auth.handler(
        new Request(
          authorizeUrl({
            client_id: [publicClientId],
            redirect_uri: [publicRedirectUri],
          }),
        ),
      ),
    ]
    for (const response of responses) {
      expect(response.status).toBe(302)
      const location = response.headers.get('location')
      expect(location).toMatch(/^\/login\?/)
      expect(location).toContain('sig=')
    }
  })

  it.each([
    { tokenEndpointAuthMethod: 'client_secret_post' },
    { tokenEndpointAuthMethod: 'none' },
    { dpopBoundAccessTokens: true },
    { requirePKCE: false },
  ])('rejects a malicious stored client before authorization-code lookup %#', async (drift) => {
    const db = database()
    Object.assign(db.oauthClient![0]!, drift)
    const auth = createAuth(db)
    const response = await auth.handler(
      tokenRequest(
        `grant_type=authorization_code&code=not-a-code&redirect_uri=https%3A%2F%2Fclient.example.test%2Fcallback&code_verifier=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~&resource=${encodeURIComponent(resource)}`,
        `Basic ${btoa('client-1:any-secret')}`,
      ),
    )
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_client',
    })
  })

  it.each([
    '/api/auth/token',
    '/api/auth/get-access-token',
    '/api/auth/refresh-token',
    '/api/auth/.well-known/openid-configuration',
    '/api/auth/oauth2/register',
    '/api/auth/oauth2/introspect',
    '/api/auth/oauth2/userinfo',
    '/api/auth/oauth2/end-session',
  ])('keeps disabled protocol surface raw-404: %s', async (path) => {
    const auth = createAuth(database())
    const response = await auth.handler(
      new Request(`${origin}${path}`, {
        body: path.endsWith('openid-configuration') || path.endsWith('/token') ? undefined : '',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        method: path.endsWith('openid-configuration') ? 'GET' : 'POST',
      }),
    )
    expect(response.status).toBe(404)
  })

  it('rejects a provider instance created before convexAuth can harden the shared callbacks', async () => {
    const db = database()
    const options = createOAuthOptions()
    const prematurelyCreatedProvider = oauthProvider(options)
    const auth = betterAuth({
      account: { encryptOAuthTokens: true, storeAccountCookie: false },
      advanced: {
        ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] },
      },
      basePath: '/api/auth',
      baseURL: origin,
      database: memoryAdapter(db),
      disabledPaths,
      logger: { disabled: true },
      plugins: [
        jwt({
          jwks: {
            disablePrivateKeyEncryption: false,
            keyPairConfig: { alg: 'RS256' },
          },
          jwt: { audience: issuer, expirationTime: '10m', issuer },
        }),
        convexAuth({
          authConfig: {
            providers: [
              {
                algorithm: 'RS256',
                applicationID: 'convex',
                issuer: 'https://deployment.convex.site',
                type: 'customJwt',
              },
            ],
          },
          oauthProvider: options,
          sessionJwt: {
            audience: 'convex',
            expirationTime: '15m',
            issuer: 'https://deployment.convex.site',
          },
        }),
        prematurelyCreatedProvider,
      ],
      rateLimit: { enabled: true, modelName: 'rateLimit', storage: 'database' },
      secret,
    })
    await expect(auth.$context).rejects.toThrow('AUTH_OAUTH_CONFIG_INVALID')
  })
})
