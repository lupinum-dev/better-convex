import { oauthProvider, type OAuthOptions } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { jwt } from 'better-auth/plugins'
import { describe, expect, it, vi } from 'vitest'

import { createConvexAuthAdapter } from '../../src/runtime/convex-auth/adapter/create-adapter'
import {
  assertOAuthAccessTokenClaims,
  assertPkceS256,
  assertSafeStoredOAuthClient,
  assertSingleParameters,
  hardenOAuthProviderCallbacks,
  validateOAuthRedirectUris,
  type PinnedOAuthProviderProfile,
} from '../../src/runtime/convex-auth/oauth-security'
import { convexAuth } from '../../src/runtime/convex-auth/plugin'
import { buildAuthProxyForwardHeaders } from '../../src/runtime/server/api/auth/headers'
import { isCrossOriginAuthRequest } from '../../src/runtime/server/api/auth/security'
import { normalizeClientIp, verifySignedClientIp } from '../../src/runtime/shared/client-ip'
import { requireAttackDenied, SECURITY_MUTANT_SURVIVED } from './contract'
import manifest from './reviewed-mutants.json'

const ORIGIN = 'https://app.example.test'
const ISSUER = `${ORIGIN}/api/auth`
const RESOURCE = `${ORIGIN}/mcp`
const PROXY_SECRET = 'auth-mutation-proxy-secret-32-bytes'
const AUTH_SECRET = 'd0f9e60506f248f7b87656005dd789a3282eb7f6a1224eebb6417261d8cf6d47'

type NodeMutantId = (typeof manifest.mutants)[number]['id']
type MutantImplementation = () => boolean | Promise<boolean>

interface MutantPair {
  mutant: MutantImplementation
  production: MutantImplementation
}

function accepted(
  operation: () => unknown | Promise<unknown>,
  expectedDenial?: string,
): MutantImplementation {
  return async () => {
    try {
      await operation()
      return true
    } catch (error) {
      if (expectedDenial !== undefined && (error as Error)?.message !== expectedDenial) throw error
      return false
    }
  }
}

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
    scopes: ['mcp:read', 'mcp:write'],
    storeClientSecret: 'hashed',
    storeTokens: 'hashed',
    ...overrides,
  }
}

function storedClient(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  }
}

function claims(overrides: Record<string, unknown> = {}) {
  return {
    aud: RESOURCE,
    azp: 'client-1',
    client_id: 'client-1',
    exp: 1_600,
    iat: 1_000,
    iss: ISSUER,
    jti: 'token-1',
    scope: 'mcp:read mcp:write',
    sid: 'session-1',
    sub: 'user-1',
    token_use: 'oauth-access',
    ...overrides,
  }
}

function assertClaims(
  payload: Record<string, unknown>,
  overrides: Partial<Parameters<typeof assertOAuthAccessTokenClaims>[1]> = {},
) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(1_200 * 1_000))
  try {
    return assertOAuthAccessTokenClaims(payload, {
      allowedScopes: ['mcp:read', 'mcp:write'],
      audience: RESOURCE,
      clientId: 'client-1',
      issuer: ISSUER,
      requiredScopes: ['mcp:read'],
      subject: 'user-1',
      ...overrides,
    })
  } finally {
    vi.useRealTimers()
  }
}

function baseDatabase(): MemoryDB {
  return {
    oauthClient: [{ id: 'client-row', ...storedClient() }],
    oauthClientResource: [
      { id: `client-1::${RESOURCE}`, clientId: 'client-1', resourceId: RESOURCE },
    ],
    oauthResource: [
      {
        id: 'resource-row',
        accessTokenTtl: 600,
        allowedScopes: ['mcp:read', 'mcp:write'],
        disabled: false,
        dpopBoundAccessTokensRequired: false,
        identifier: RESOURCE,
        name: 'MCP',
        signingAlgorithm: 'RS256',
      },
    ],
    rateLimit: [],
    verification: [],
  }
}

const disabledOAuthPaths = [
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

function createOAuthAuth(db: MemoryDB) {
  const options = {
    accessTokenExpiresIn: 600,
    allowDynamicClientRegistration: false,
    allowPublicClientPrelogin: true,
    allowUnauthenticatedClientRegistration: false,
    clientPrivileges: async () => true,
    codeExpiresIn: 120,
    consentPage: '/oauth/consent',
    customAccessTokenClaims: async () => ({ token_use: 'oauth-access' as const }),
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
    silenceWarnings: { oauthAuthServerConfig: true },
    storeClientSecret: 'hashed',
    storeTokens: 'hashed',
  } satisfies OAuthOptions<['mcp:read', 'mcp:write']>
  return betterAuth({
    account: { encryptOAuthTokens: true, storeAccountCookie: false },
    advanced: { ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } },
    basePath: '/api/auth',
    baseURL: ORIGIN,
    database: memoryAdapter(db),
    disabledPaths: disabledOAuthPaths,
    logger: { disabled: true },
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: {
          disablePrivateKeyEncryption: false,
          gracePeriod: 21 * 60,
          keyPairConfig: { alg: 'RS256' },
        },
        jwt: { audience: ISSUER, expirationTime: '10m', issuer: ISSUER },
      }),
      convexAuth({
        authConfig: {
          providers: [
            {
              algorithm: 'RS256',
              applicationID: 'convex',
              issuer: 'https://deployment.convex.site',
              jwks: `${ISSUER}/jwks`,
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
    secret: AUTH_SECRET,
    trustedOrigins: [ORIGIN],
    verification: { storeIdentifier: 'hashed' },
  })
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  )
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

async function productionAcceptsMismatchedCodeRedirect(): Promise<boolean> {
  const code = 'reviewed-authorization-code'
  const codeVerifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'
  const now = new Date()
  const db = baseDatabase()
  db.oauthClient = [
    {
      id: 'client-row',
      ...storedClient({
        clientSecret: null,
        public: true,
        redirectUris: [
          'https://client.example.test/callback',
          'https://client.example.test/other-callback',
        ],
        tokenEndpointAuthMethod: 'none',
        type: 'native',
      }),
    },
  ]
  db.verification = [
    {
      id: 'authorization-code-row',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 120_000),
      identifier: await sha256Base64Url(code),
      updatedAt: now,
      value: JSON.stringify({
        query: {
          client_id: 'client-1',
          code_challenge: await sha256Base64Url(codeVerifier),
          code_challenge_method: 'S256',
          redirect_uri: 'https://client.example.test/callback',
          resource: RESOURCE,
          response_type: 'code',
          scope: 'mcp:read',
        },
        resource: [RESOURCE],
        sessionId: 'session-1',
        type: 'authorization_code',
        userId: 'user-1',
      }),
    },
  ]
  const auth = createOAuthAuth(db)
  const response = await auth.handler(
    new Request(`${ISSUER}/oauth2/token`, {
      body: new URLSearchParams({
        code,
        client_id: 'client-1',
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: 'https://client.example.test/other-callback',
        resource: RESOURCE,
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-bcn-verified-client-ip': '192.0.2.10',
      },
      method: 'POST',
    }),
  )
  const body = (await response.json()) as { error?: unknown }
  if (response.status === 400 && body.error === 'invalid_grant') return false
  if (response.status >= 200 && response.status < 300) return true
  throw new Error(
    `Authorization-code redirect negative control reached an unexpected response: ${response.status} ${String(body.error)}`,
  )
}

async function productionSplitsConsume(): Promise<boolean> {
  const calls: Array<{ kind: 'mutation' | 'query'; reference: unknown }> = []
  const consumeReference = { name: 'consumeOne' }
  const ctx = {
    auth: {},
    db: {},
    runMutation: async (reference: unknown) => {
      calls.push({ kind: 'mutation', reference })
      return null
    },
    runQuery: async (reference: unknown) => {
      calls.push({ kind: 'query', reference })
      return null
    },
  }
  const adapter = createConvexAuthAdapter(
    ctx as never,
    { adapter: { consumeOne: consumeReference } } as never,
  )({} as never)
  await adapter.consumeOne({ model: 'verification', where: [{ field: 'id', value: 'code-1' }] })
  return (
    calls.length !== 1 || calls[0]?.kind !== 'mutation' || calls[0]?.reference !== consumeReference
  )
}

const nodePairs: Record<string, MutantPair> = {
  'origin-from-host': {
    production: () =>
      !isCrossOriginAuthRequest(
        new Headers({ host: 'evil.example.test', origin: 'https://evil.example.test' }),
        'POST',
        ORIGIN,
        '/sign-in/email',
      ),
    mutant: () =>
      !isCrossOriginAuthRequest(
        new Headers({ host: 'evil.example.test', origin: 'https://evil.example.test' }),
        'POST',
        'https://evil.example.test',
        '/sign-in/email',
      ),
  },
  'client-ip-without-signature': {
    production: async () =>
      Boolean(await verifySignedClientIp('203.0.113.10', 'attacker-signature', PROXY_SECRET)),
    mutant: () => Boolean(normalizeClientIp('203.0.113.10')),
  },
  'undefined-privilege-allows': {
    production: async () => {
      const hardened = hardenOAuthProviderCallbacks(
        oauthOptions({ clientPrivileges: async () => undefined }),
      )
      return hardened.clientPrivileges({
        headers: new Headers(),
        session: { id: 'session-1' },
        user: { id: 'user-1' },
      })
    },
    mutant: async () => {
      const callback = async () => undefined
      return (await callback()) !== false
    },
  },
  'jwt-token-class-skipped': {
    production: accepted(
      () => assertClaims(claims({ token_use: 'session' })),
      'AUTH_OAUTH_TOKEN_INVALID',
    ),
    mutant: accepted(() => assertClaims(claims({ token_use: 'oauth-access' }))),
  },
  'jwt-audience-skipped': {
    production: accepted(
      () => assertClaims(claims({ aud: 'https://other.example/mcp' })),
      'AUTH_OAUTH_TOKEN_INVALID',
    ),
    mutant: accepted(() =>
      assertClaims(claims({ aud: 'https://other.example/mcp' }), {
        audience: 'https://other.example/mcp',
      }),
    ),
  },
  'oauth-resource-binding-skipped': {
    production: accepted(
      () => assertClaims(claims(), { audience: 'https://app.example.test/admin-resource' }),
      'AUTH_OAUTH_TOKEN_INVALID',
    ),
    mutant: accepted(() => assertClaims(claims(), { audience: RESOURCE })),
  },
  'oauth-client-binding-skipped': {
    production: accepted(
      () => assertClaims(claims(), { clientId: 'client-2' }),
      'AUTH_OAUTH_TOKEN_INVALID',
    ),
    mutant: accepted(() => assertClaims(claims(), { clientId: undefined })),
  },
  'oauth-scope-allowlist-skipped': {
    production: accepted(
      () => assertClaims(claims({ scope: 'mcp:read admin' })),
      'AUTH_OAUTH_TOKEN_INVALID',
    ),
    mutant: accepted(() =>
      assertClaims(claims({ scope: 'mcp:read admin' }), {
        allowedScopes: ['mcp:read', 'mcp:write', 'admin'],
      }),
    ),
  },
  'oauth-duplicate-parameter-last-wins': {
    production: accepted(() => {
      const parameters = new URLSearchParams('resource=first&resource=second')
      assertSingleParameters(parameters, ['resource'])
    }, 'AUTH_OAUTH_REQUEST_INVALID'),
    mutant: () => new URLSearchParams('resource=first&resource=second').get('resource') !== null,
  },
  'oauth-token-auth-method-skipped': {
    production: accepted(
      () =>
        assertSafeStoredOAuthClient(
          storedClient({ tokenEndpointAuthMethod: 'client_secret_post' }),
          ['mcp:read', 'mcp:write'],
        ),
      'AUTH_OAUTH_CONFIG_INVALID',
    ),
    mutant: accepted(() => assertSafeStoredOAuthClient(storedClient(), ['mcp:read', 'mcp:write'])),
  },
  'oauth-redirect-wildcard-allowed': {
    production: accepted(
      () => validateOAuthRedirectUris(['https://*.example.test/callback']),
      'AUTH_OAUTH_CONFIG_INVALID',
    ),
    mutant: () => {
      const parsed = new URL('https://*.example.test/callback')
      return parsed.protocol === 'https:' && !parsed.hash
    },
  },
  'oauth-pkce-plain-allowed': {
    production: accepted(
      () => assertPkceS256('A'.repeat(43), 'plain'),
      'AUTH_OAUTH_REQUEST_INVALID',
    ),
    mutant: () => /^.{43}$/u.test('A'.repeat(43)),
  },
  'oauth-code-redirect-binding-skipped': {
    production: productionAcceptsMismatchedCodeRedirect,
    mutant: () => {
      const stored = {
        clientId: 'client-1',
        redirectUri: 'https://client.example.test/callback',
        resource: RESOURCE,
      }
      const presented = {
        clientId: 'client-1',
        redirectUri: 'https://client.example.test/other-callback',
        resource: RESOURCE,
      }
      // Reviewed mutant: client and resource remain bound, redirect is omitted.
      return stored.clientId === presented.clientId && stored.resource === presented.resource
    },
  },
  'auth-proxy-control-header-forwarded': {
    production: async () => {
      const forwarded = await buildAuthProxyForwardHeaders(
        {
          headers: new Headers({
            host: 'evil.example.test',
            'x-bcn-internal-session': '1',
            'x-forwarded-host': 'evil.example.test',
          }),
        } as never,
        {},
      )
      return Object.keys(forwarded).length > 0
    },
    mutant: () =>
      new Headers({
        host: 'evil.example.test',
        'x-bcn-internal-session': '1',
        'x-forwarded-host': 'evil.example.test',
      }).has('x-forwarded-host'),
  },
  'adapter-consume-read-then-delete': {
    production: productionSplitsConsume,
    mutant: () => {
      const calls = [
        { kind: 'query', reference: 'findOne' },
        { kind: 'mutation', reference: 'deleteOne' },
      ]
      return calls.length !== 1 || calls[0]?.kind !== 'mutation'
    },
  },
}

const nodeManifest = manifest.mutants.filter((entry) => entry.project === 'node')
const nodeIds = new Set(nodeManifest.map((entry) => entry.id))
if (
  Object.keys(nodePairs).length !== nodeIds.size ||
  Object.keys(nodePairs).some((id) => !nodeIds.has(id as NodeMutantId))
) {
  throw new Error('Reviewed node mutant manifest and implementations differ')
}

describe('fixed reviewed auth security mutants', () => {
  for (const entry of nodeManifest) {
    it(`MUTANT::${entry.id}`, async () => {
      const pair = nodePairs[entry.id]
      if (!pair) throw new Error(`Missing reviewed mutant implementation: ${entry.id}`)

      await expect(requireAttackDenied(pair.production), entry.invariant).resolves.toBeUndefined()
      await expect(requireAttackDenied(pair.mutant), entry.invariant).rejects.toThrow(
        SECURITY_MUTANT_SURVIVED,
      )
    })
  }
})
