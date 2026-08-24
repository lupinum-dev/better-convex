import { inspect } from 'node:util'

import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { symmetricEncrypt } from 'better-auth/crypto'
import { setTokenUtil } from 'better-auth/oauth2'
import { createJwk, jwt, type JwtOptions } from 'better-auth/plugins'
import { describe, expect, it } from 'vitest'

import {
  assertSentinelCategories,
  createSecretSentinels,
  disabledSentinelPhases,
  replaceSecretSentinel,
  scanSecretSentinelSurfaces,
  SecretSentinelLeakError,
  secretSentinelDefinitions,
  sentinelEncodings,
  sentinelTestClientIp,
} from '../../scripts/auth-secret-sentinels.mjs'
import { createAccountIdTokenProtector } from '../../src/runtime/convex-auth/adapter/create-adapter'
import { createDevtoolsSink } from '../../src/runtime/devtools/sink'
import { ConvexCallError } from '../../src/runtime/errors'
import { signClientIp } from '../../src/runtime/shared/client-ip'

const origin = 'https://sentinel.example.test'
const issuer = `${origin}/api/auth`
const runId = process.env.BCN_AUTH_SENTINEL_RUN_ID ?? 'bcn-auth-sentinel-local-0001'

type Sentinels = Readonly<Record<string, string>>

interface CreatedOAuthClient {
  client_id: string
  client_secret?: string
}

function expectSafeLeak(
  sentinels: Sentinels,
  surfaces: Parameters<typeof scanSecretSentinelSurfaces>[1],
): SecretSentinelLeakError {
  let caught: unknown
  try {
    scanSecretSentinelSurfaces(sentinels, surfaces)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(SecretSentinelLeakError)
  const leak = caught as SecretSentinelLeakError
  for (const value of Object.values(sentinels)) expect(leak.message).not.toContain(value)
  return leak
}

function storedCredentialAuth(sentinels: Sentinels) {
  const database: MemoryDB = {
    account: [],
    jwks: [],
    oauthAccessToken: [],
    oauthClient: [],
    oauthRefreshToken: [],
    session: [],
    user: [],
    verification: [],
  }
  const auth = betterAuth({
    account: { encryptOAuthTokens: true },
    basePath: '/api/auth',
    baseURL: origin,
    database: memoryAdapter(database),
    emailAndPassword: { enabled: true, minPasswordLength: 15 },
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
      oauthProvider({
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        clientPrivileges: async () => true,
        consentPage: '/oauth/consent',
        generateClientSecret: () => sentinels['oauth-client-secret']!,
        grantTypes: ['authorization_code'],
        loginPage: '/login',
        resourcePrivileges: async () => true,
        silenceWarnings: { oauthAuthServerConfig: true },
        storeClientSecret: 'hashed',
        storeTokens: 'hashed',
      }),
    ],
    secrets: [
      { value: sentinels['better-auth-current-secret']!, version: 2 },
      { value: sentinels['better-auth-prior-secret']!, version: 1 },
    ],
    verification: { storeIdentifier: 'hashed' },
  })
  return { auth, database }
}

describe('Section 9.6 secret sentinel gate', () => {
  it('keeps one complete closed registry and no premature refresh-token or DPoP exception', async () => {
    const sentinels = createSecretSentinels(runId)
    expect(Object.keys(sentinels).sort()).toEqual(
      secretSentinelDefinitions.map(({ id }) => id).sort(),
    )
    expect(new Set(Object.values(sentinels))).toHaveLength(secretSentinelDefinitions.length)
    expect(disabledSentinelPhases).toEqual([
      { authorizedLocations: [], id: 'oauth-refresh-token' },
      { authorizedLocations: [], id: 'dpop-private-key' },
    ])
    expect(
      secretSentinelDefinitions.find(({ id }) => id === 'pkce-code-verifier')?.authorizedLocations,
    ).toEqual([
      'http.request.oauth-token.body.code_verifier',
      'process.memory.oauth-client.pkce-code-verifier',
    ])
    expect(sentinels['proxy-ip-signature']).toBe(
      await signClientIp(sentinelTestClientIp(), sentinels['proxy-ip-secret']!),
    )
  })

  it('kills one raw leak for every active class and never repeats secret bytes in the error', () => {
    const sentinels = createSecretSentinels(runId)
    for (const definition of secretSentinelDefinitions) {
      const leak = expectSafeLeak(sentinels, [
        {
          category: 'snapshot',
          location: 'snapshot.negative-control',
          value: sentinels[definition.id],
        },
      ])
      expect(leak.findings).toContainEqual({
        category: 'snapshot',
        encoding: 'raw',
        id: definition.id,
        location: 'snapshot.negative-control',
      })
    }
  })

  it('detects encoded credentials and exercises every forbidden surface class', () => {
    const base = createSecretSentinels(runId)
    const sentinels = replaceSecretSentinel(
      base,
      'oauth-access-token',
      'BCN sentinel / encoded + credential = 9f28f6a5',
    )
    const encoded = sentinelEncodings(sentinels['oauth-access-token']!)
    const categories = [
      'database',
      'http',
      'serialized-error',
      'console',
      'devtools',
      'snapshot',
      'build-output',
      'source-map',
      'tarball',
    ]
    for (const [index, category] of categories.entries()) {
      const candidate = encoded[index % encoded.length]!.value
      const leak = expectSafeLeak(sentinels, [
        { category, location: `${category}.negative-control`, value: candidate },
      ])
      expect(
        leak.findings.some((finding: { id: string }) => finding.id === 'oauth-access-token'),
      ).toBe(true)
    }
  })

  it('permits raw bytes only at exact reviewed leaves, including decoded Basic auth', () => {
    const sentinels = createSecretSentinels(runId)
    const reviewed = secretSentinelDefinitions.flatMap((definition) =>
      definition.authorizedLocations.map((location) => ({
        category: 'authorized-location-contract',
        location,
        value: sentinels[definition.id],
      })),
    )
    const report = scanSecretSentinelSurfaces(sentinels, reviewed)
    expect(new Set(report.authorizedOccurrences.map(({ id }) => id))).toEqual(
      new Set(secretSentinelDefinitions.map(({ id }) => id)),
    )

    const basic = `Basic ${Buffer.from(`client:${sentinels['oauth-client-secret']}`).toString('base64')}`
    expect(() =>
      scanSecretSentinelSurfaces(sentinels, [
        {
          category: 'http',
          location: 'http.request.oauth-token',
          value: { headers: { authorization: basic } },
        },
      ]),
    ).not.toThrow()

    const misplaced = expectSafeLeak(sentinels, [
      {
        category: 'database',
        location: 'database.export',
        value: { session: [{ tokenCopy: sentinels['session-token'] }] },
      },
    ])
    expect(misplaced.findings[0]?.location).toBe('database.export.session[].tokenCopy')

    const rawProviderIdToken = expectSafeLeak(sentinels, [
      {
        category: 'database',
        location: 'database.export',
        value: { account: [{ idToken: sentinels['social-id-token'] }] },
      },
    ])
    expect(rawProviderIdToken.findings[0]?.location).toBe('database.export.account[].idToken')
  })

  it('scans official protected storage plus HTTP, error, console, and DevTools surfaces', async () => {
    let sentinels = createSecretSentinels(runId)
    const { auth, database } = storedCredentialAuth(sentinels)
    const context = await auth.$context

    const signUp = await auth.api.signUpEmail({
      asResponse: true,
      body: {
        email: 'sentinel-user@example.test',
        name: 'Sentinel User',
        password: 'Sentinel-password-24680',
      },
    })
    const session = database.session?.[0]
    if (!session?.token) throw new Error('AUTH_SECRET_SENTINEL_FIXTURE_INVALID: session missing')
    sentinels = replaceSecretSentinel(sentinels, 'session-token', session.token)

    const createdClientResponse = await auth.api.adminCreateOAuthClient({
      asResponse: true,
      body: {
        grant_types: ['authorization_code'],
        redirect_uris: ['https://client.example.test/callback'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        application_type: 'web',
      },
      headers: new Headers({ cookie: signUp.headers.get('set-cookie') ?? '' }),
    })
    const createdClient = (await createdClientResponse.json()) as CreatedOAuthClient
    if (createdClient.client_secret !== sentinels['oauth-client-secret']) {
      throw new Error('AUTH_SECRET_SENTINEL_FIXTURE_INVALID: client secret generator drift')
    }

    const tokenContext = context as unknown as Parameters<typeof setTokenUtil>[1]
    const encryptedAccessToken = await setTokenUtil(sentinels['social-access-token'], tokenContext)
    const encryptedRefreshToken = await setTokenUtil(
      sentinels['social-refresh-token'],
      tokenContext,
    )
    const protectedIdToken = (await createAccountIdTokenProtector({
      account: { encryptOAuthTokens: true },
      secrets: [
        { value: sentinels['better-auth-current-secret']!, version: 2 },
        { value: sentinels['better-auth-prior-secret']!, version: 1 },
      ],
    }).protect('account', { idToken: sentinels['social-id-token'] })) as {
      idToken: string
    }
    database.account!.push({
      accessToken: encryptedAccessToken,
      id: 'social-account-row',
      idToken: protectedIdToken.idToken,
      issuer: 'https://sentinel-provider.example.test',
      accountId: 'social-account',
      providerId: 'sentinel-provider',
      refreshToken: encryptedRefreshToken,
      userId: database.user![0]!.id,
    })

    const jwtPlugin = context.getPlugin('jwt')
    if (!jwtPlugin) throw new Error('AUTH_SECRET_SENTINEL_FIXTURE_INVALID: JWT plugin missing')
    await createJwk(
      { context } as unknown as Parameters<typeof createJwk>[0],
      jwtPlugin.options as JwtOptions,
    )
    const storedJwk = database.jwks?.[0]
    if (!storedJwk) throw new Error('AUTH_SECRET_SENTINEL_FIXTURE_INVALID: JWK missing')
    storedJwk.privateKey = JSON.stringify(
      await symmetricEncrypt({
        data: JSON.stringify({ d: sentinels['private-jwk-member'], kty: 'RSA' }),
        key: context.secretConfig,
      }),
    )

    const clientId = createdClient.client_id
    const basicAuthorization = `Basic ${Buffer.from(
      `${clientId}:${sentinels['oauth-client-secret']}`,
    ).toString('base64')}`
    const tokenRequestBody = {
      code: sentinels['authorization-code'],
      code_verifier: sentinels['pkce-code-verifier'],
      grant_type: 'authorization_code',
      redirect_uri: 'https://client.example.test/callback',
    }
    const tokenResponse = await auth.handler(
      new Request(`${issuer}/oauth2/token`, {
        body: new URLSearchParams(tokenRequestBody),
        headers: {
          authorization: basicAuthorization,
          'content-type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
      }),
    )
    const tokenResponseText = await tokenResponse.text()

    const publicError = new ConvexCallError({
      code: 'AUTH_CONFIG_INVALID',
      kind: 'authentication',
      message: 'Authentication failed',
      status: 500,
    })
    const sink = createDevtoolsSink()
    const mutationId = sink.registerMutation({
      args: { authorization: `Bearer ${sentinels['oauth-access-token']}` },
      hasOptimisticUpdate: false,
      name: 'auth:sentinel',
      startedAt: 1,
      state: 'pending',
      type: 'mutation',
    })
    sink.updateMutation(mutationId, {
      error: inspect(publicError),
      result: { sessionToken: sentinels['session-token'] },
      state: 'error',
    })

    const proxySignature = await signClientIp(sentinelTestClientIp(), sentinels['proxy-ip-secret'])
    const surfaces = [
      { category: 'database', location: 'database.export', value: database },
      {
        category: 'http',
        location: 'http.response.session',
        value: { headers: { 'set-cookie': signUp.headers.get('set-cookie') ?? '' } },
      },
      {
        category: 'http',
        location: 'http.response.oauth-client-create',
        value: {
          body: createdClient,
          headers: Object.fromEntries(createdClientResponse.headers.entries()),
        },
      },
      {
        category: 'http',
        location: 'http.request.oauth-token',
        value: { body: tokenRequestBody, headers: { authorization: basicAuthorization } },
      },
      {
        category: 'http',
        location: 'http.response.oauth-token-error',
        value: {
          body: tokenResponseText,
          headers: Object.fromEntries(tokenResponse.headers.entries()),
        },
      },
      {
        category: 'http',
        location: 'http.request.private-nuxt-convex',
        value: { headers: { 'x-bcn-client-ip-signature': proxySignature } },
      },
      {
        category: 'http',
        location: 'http.response.social-provider',
        value: {
          body: {
            access_token: sentinels['social-access-token'],
            id_token: sentinels['social-id-token'],
            refresh_token: sentinels['social-refresh-token'],
          },
        },
      },
      {
        category: 'http',
        location: 'http.response.oauth-authorize',
        value: {
          headers: {
            location: `https://client.example.test/callback?code=${encodeURIComponent(
              sentinels['authorization-code']!,
            )}&state=reviewed-state`,
          },
        },
      },
      {
        category: 'http',
        location: 'http.response.oauth-token',
        value: { body: { access_token: sentinels['oauth-access-token'] } },
      },
      {
        category: 'http',
        location: 'http.request.oauth-resource',
        value: { headers: { authorization: `Bearer ${sentinels['oauth-access-token']}` } },
      },
      {
        category: 'http',
        location: 'http.response.convex-token',
        value: { body: { token: sentinels['convex-session-jwt'] } },
      },
      {
        category: 'http',
        location: 'http.request.convex',
        value: { headers: { authorization: `Bearer ${sentinels['convex-session-jwt']}` } },
      },
      {
        category: 'http',
        location: 'http.request.localhost-inspector',
        value: { headers: { authorization: `Bearer ${sentinels['inspector-proxy-token']}` } },
      },
      {
        category: 'serialized-error',
        location: 'serialized-error.auth-boundary',
        value: JSON.stringify(publicError),
      },
      { category: 'console', location: 'console.auth-boundary', value: inspect(publicError) },
      {
        category: 'devtools',
        location: 'devtools.state',
        value: JSON.stringify(sink.getMutations()),
      },
    ]
    const report = scanSecretSentinelSurfaces(sentinels, surfaces)
    assertSentinelCategories(report, [
      'console',
      'database',
      'devtools',
      'http',
      'serialized-error',
    ])

    expect(encryptedAccessToken).not.toContain(sentinels['social-access-token'])
    expect(encryptedRefreshToken).not.toContain(sentinels['social-refresh-token'])
    expect(protectedIdToken.idToken).not.toContain(sentinels['social-id-token'])
    expect(database.oauthClient?.[0]?.clientSecret).not.toBe(sentinels['oauth-client-secret'])
    expect(storedJwk.privateKey).not.toContain(sentinels['private-jwk-member'])
    expect(createdClientResponse.status).toBe(201)
    expect(tokenResponse.status).toBeGreaterThanOrEqual(400)
  })
})
