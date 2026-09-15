/// <reference types="vite/client" />
import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { hashPassword } from 'better-auth/crypto'
import { jwt } from 'better-auth/plugins'
import { convexTest } from 'convex-test'
import {
  componentsGeneric,
  defineSchema,
  type GenericActionCtx,
  type GenericDataModel,
} from 'convex/server'
import { decodeJwt } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createConvexAuthAdapter } from '../../src/runtime/convex-auth/adapter/create-adapter'
import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import { rotateSigningKeyWithOfficialJwt } from '../../src/runtime/convex-auth/jwks-rotation'
import { validateOAuthAccess } from '../../src/runtime/convex-auth/oauth-live-access'
import { convexAuth } from '../../src/runtime/convex-auth/plugin'
import { createConvexAuthRateLimitStorage } from '../../src/runtime/convex-auth/rate-limit-storage'

const rootModules = import.meta.glob('../fixtures/jwks-rotation/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const component = (
  componentsGeneric() as unknown as {
    authRotation: ComponentApi<'authRotation'>
  }
).authRotation
const now = 1_700_000_000_000
const origin = 'https://app.example.test'
const issuer = `${origin}/api/auth`
const resource = 'https://deployment.convex.site/mcp'
const scopes = ['mcp:read', 'mcp:write', 'offline_access']
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
const originalToken = 'SyntheticOnlyRefreshTokenForProviderTest'

function createAuth(ctx: GenericActionCtx<GenericDataModel>) {
  const options = {
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
    grantTypes: ['authorization_code', 'refresh_token'],
    loginPage: '/login',
    rateLimit: {
      authorize: { max: 30, window: 60 },
      revoke: { max: 30, window: 60 },
      token: { max: 20, window: 60 },
    },
    refreshTokenExpiresIn: 604800,
    refreshTokenReuseInterval: 10,
    resourcePrivileges: async () => true,
    scopes,
    storeClientSecret: 'hashed' as const,
    storeTokens: 'hashed' as const,
  }
  const jwtOptions = {
    disableSettingJwtHeader: true,
    jwks: {
      disablePrivateKeyEncryption: false,
      gracePeriod: 1260,
      keyPairConfig: { alg: 'RS256' as const },
    },
    jwt: { audience: issuer, expirationTime: '10m', issuer },
  }
  const auth = betterAuth<BetterAuthOptions>({
    emailAndPassword: { enabled: true },
    disabledPaths,
    account: { encryptOAuthTokens: true, storeAccountCookie: false },
    basePath: '/api/auth',
    baseURL: origin,
    database: createConvexAuthAdapter(ctx, component),
    advanced: { ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } },
    logger: { disabled: true },
    secret: 'synthetic-provider-test-secret-with-adequate-entropy',
    secrets: [
      {
        version: 1,
        value: 'synthetic-provider-test-secret-with-adequate-entropy',
      },
    ],
    plugins: [
      jwt(jwtOptions),
      convexAuth({
        authConfig: {
          providers: [
            {
              type: 'customJwt',
              algorithm: 'RS256',
              applicationID: 'convex',
              issuer: 'https://deployment.convex.site',
            },
          ],
        },
        oauthProvider: options,
        sessionJwt: {
          issuer: 'https://deployment.convex.site',
          audience: 'convex',
          expirationTime: '15m',
        },
      }),
      oauthProvider(options),
    ],
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'rateLimit',
      customStorage: createConvexAuthRateLimitStorage(ctx, component, 60),
    },
    verification: { storeIdentifier: 'hashed' },
    trustedOrigins: [origin],
  })
  return { auth, jwtOptions }
}

async function init() {
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent('authRotation', authSchema, authModules)
  const create = (model: string, data: Record<string, unknown>) =>
    test.mutation(component.adapter.create, { model, data })
  await create('user', {
    id: 'user',
    name: 'Synthetic',
    email: 'user@example.test',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await create('account', {
    id: 'credential-account',
    accountId: 'user',
    issuer: 'local:credential',
    providerId: 'credential',
    userId: 'user',
    password: await hashPassword('Synthetic password for tests 2026'),
    createdAt: now,
    updatedAt: now,
  })
  await create('session', {
    id: 'session',
    userId: 'user',
    token: 'synthetic-session',
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 3600000,
  })
  await create('oauthClient', {
    id: 'client-row',
    clientId: 'client',
    disabled: false,
    subjectType: 'public',
    applicationType: 'native',
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    requirePKCE: true,
    skipConsent: false,
    enableEndSession: false,
    dpopBoundAccessTokens: false,
    scopes,
    redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
  })
  await create('oauthResource', {
    id: 'resource-row',
    identifier: resource,
    name: 'Synthetic',
    disabled: false,
    allowedScopes: scopes,
    accessTokenTtl: 600,
    signingAlgorithm: 'RS256',
    dpopBoundAccessTokensRequired: false,
  })
  await create('oauthClientResource', {
    id: 'link',
    clientId: 'client',
    resourceId: resource,
  })
  await create('oauthConsent', {
    id: 'consent',
    clientId: 'client',
    userId: 'user',
    resources: [resource],
    scopes,
  })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(originalToken))
  const token = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  await create('oauthRefreshToken', {
    id: 'refresh',
    token,
    clientId: 'client',
    userId: 'user',
    sessionId: 'session',
    resources: [resource],
    scopes,
    createdAt: now,
    expiresAt: now + 3600000,
  })
  await test.action(async (ctx) => {
    const { auth, jwtOptions } = createAuth(ctx)
    await rotateSigningKeyWithOfficialJwt(await auth.$context, jwtOptions, (next) =>
      ctx.runMutation(component.adapter.rotateSigningKey, {
        next,
        onlyIfEmpty: true,
      }),
    )
  })
  const request = async (
    token = originalToken,
    overrides: Record<string, string> = {},
    path = 'token',
  ) =>
    test.action(async (ctx) => {
      const { auth } = createAuth(ctx)
      const response = await auth.handler(
        new Request(`${issuer}/oauth2/${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-bcn-verified-client-ip': '192.0.2.1',
          },
          body: new URLSearchParams(
            path === 'token'
              ? {
                  grant_type: 'refresh_token',
                  refresh_token: token,
                  client_id: 'client',
                  resource,
                  ...overrides,
                }
              : {
                  token,
                  token_type_hint: 'refresh_token',
                  client_id: 'client',
                  ...overrides,
                },
          ),
        }),
      )
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : {} }
    })
  const send = (request: Request) =>
    test.action(async (ctx) => {
      const { auth } = createAuth(ctx)
      const response = await auth.handler(request)
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        text: await response.text(),
      }
    })
  return { test, request, send }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

describe('official provider renewal through the canonical Convex adapter', () => {
  it('rotates, replays a lost response briefly, and renews after access expiry', async () => {
    const { test, request } = await init()
    const first = await request()
    expect(first, JSON.stringify(first)).toMatchObject({ status: 200 })
    expect(first.body.refresh_token).toBeTypeOf('string')
    expect(first.body.refresh_token).not.toBe(originalToken)
    expect(first.body.expires_in).toBe(600)
    expect(decodeJwt(first.body.access_token)).toMatchObject({
      sid: 'session',
      sub: 'user',
      aud: resource,
      scope: scopes.join(' '),
    })
    const retry = await request()
    expect(retry.status).toBe(200)
    expect(retry.body.refresh_token).toBe(first.body.refresh_token)
    expect(retry.body.access_token).toBe(first.body.access_token)
    const rows = await test.query(component.adapter.findMany, {
      model: 'oauthRefreshToken',
      paginationOpts: { cursor: null, numItems: 10 },
    })
    expect(rows.page).toHaveLength(2)
    expect(JSON.stringify(rows.page)).not.toContain(first.body.refresh_token)
    vi.setSystemTime(now + 601000)
    const renewed = await request(first.body.refresh_token)
    expect(renewed.status).toBe(200)
    expect(renewed.body.refresh_token).not.toBe(first.body.refresh_token)
  })
  it('rejects token reuse outside grace and revokes the descendant plus live consent', async () => {
    const { test, request } = await init()
    const first = await request()
    expect(first, JSON.stringify(first)).toMatchObject({ status: 200 })
    vi.setSystemTime(now + 11000)
    expect((await request()).status).toBe(400)
    expect((await request(first.body.refresh_token)).status).toBe(400)
    expect(await test.query(component.adapter.count, { model: 'oauthConsent' })).toBe(0)
  })
  it('handles concurrent refresh without creating two successors', async () => {
    const { test, request } = await init()
    const results = await Promise.all([request(), request()])
    expect(results.some((result) => result.status === 200)).toBe(true)
    const successes = results.filter((result) => result.status === 200)
    expect(new Set(successes.map((result) => result.body.refresh_token)).size).toBe(1)
    expect(await test.query(component.adapter.count, { model: 'oauthRefreshToken' })).toBe(2)
  })
  it('rejects crossed clients, scopes, resources, and revoked sessions', async () => {
    const { test, request } = await init()
    const deniedRequests: Record<string, string>[] = [
      { client_id: 'other' },
      { scope: 'admin' },
      { resource: 'https://other.example/mcp' },
    ]
    for (const overrides of deniedRequests)
      expect((await request(originalToken, overrides)).status).not.toBe(200)
    const first = await request()
    expect(first, JSON.stringify(first)).toMatchObject({ status: 200 })
    await test.mutation(component.adapter.deleteOne, {
      model: 'session',
      where: [{ field: 'id', value: 'session' }],
    })
    expect((await request(first.body.refresh_token)).status).toBe(400)
    expect((await request()).status).toBe(400)
  })
  it('makes explicit token revocation immediately invalidate consent', async () => {
    const { test, request } = await init()
    const first = await request()
    expect(first, JSON.stringify(first)).toMatchObject({ status: 200 })
    expect((await request(first.body.refresh_token, {}, 'revoke')).status).toBe(200)
    expect(await test.query(component.adapter.count, { model: 'oauthConsent' })).toBe(0)
    expect((await request(first.body.refresh_token)).status).toBe(400)
  })
  it('signs out the canonical session after a large renewal history', async () => {
    const { test, request, send } = await init()
    const login = await send(
      new Request(`${issuer}/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({
          email: 'user@example.test',
          password: 'Synthetic password for tests 2026',
        }),
      }),
    )
    expect(login.status).toBe(200)
    const session = await test.query(component.adapter.findOne, {
      model: 'session',
      where: [{ field: 'token', value: JSON.parse(login.text).token }],
    })
    expect(session).not.toBeNull()
    if (typeof session?.id !== 'string') throw new Error('Expected the authenticated session ID')
    await test.mutation(component.adapter.updateOne, {
      model: 'oauthRefreshToken',
      where: [{ field: 'id', value: 'refresh' }],
      update: { sessionId: session.id },
    })
    const row = await test.query(component.adapter.findOne, {
      model: 'oauthRefreshToken',
      where: [{ field: 'id', value: 'refresh' }],
    })
    for (let index = 0; index < 127; index++)
      await test.mutation(component.adapter.create, {
        model: 'oauthRefreshToken',
        data: { ...row, id: `history-${index}`, token: `synthetic-history-hash-${index}` },
      })
    const first = await request()
    expect(first.status).toBe(200)
    const logout = await send(
      new Request(`${issuer}/sign-out`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
          cookie: login.headers['set-cookie']!.split(';')[0]!,
        },
        body: '{}',
      }),
    )
    expect(logout.status).toBe(200)
    expect(
      await test.query(component.adapter.findOne, {
        model: 'session',
        where: [{ field: 'id', value: session.id }],
      }),
    ).toBeNull()
    expect((await request(first.body.refresh_token)).status).toBe(400)
    expect((await request()).status).toBe(400)
  })
  it('rejects removal of renewal scope before consuming the token; permits bounded application downscope', async () => {
    const { request } = await init()
    expect(await request(originalToken, { scope: 'mcp:read' })).toMatchObject({
      status: 400,
      body: { error: 'invalid_scope' },
    })
    const narrowed = await request(originalToken, { scope: 'mcp:read offline_access' })
    expect(narrowed.status).toBe(200)
    expect(narrowed.body.scope).toBe('mcp:read offline_access')
    expect((await request(narrowed.body.refresh_token)).status).toBe(200)
  })
  it('does not revive an old JWT when the same account consents again', async () => {
    const { test, request } = await init()
    const first = await request()
    expect(first.status).toBe(200)
    const claims = decodeJwt(first.body.access_token)
    const access = {
      clientId: 'client',
      subject: 'user',
      sessionId: 'session',
      issuer,
      resource,
      scopes,
      grantId: String(claims.bcn_grant_id),
    }
    const live = () => test.query((ctx) => validateOAuthAccess(ctx, component, access))
    expect(await live()).toBe(true)
    await request(first.body.refresh_token, {}, 'revoke')
    expect(await live()).toBe(false)
    await test.mutation(component.adapter.create, {
      model: 'oauthConsent',
      data: {
        id: 'new-consent',
        clientId: 'client',
        userId: 'user',
        resources: [resource],
        scopes,
      },
    })
    expect(await live()).toBe(false)
  })
  it('does not revoke a different client when an old rotated token is submitted', async () => {
    const { test, request } = await init()
    expect((await request()).status).toBe(200)
    const client = await test.query(component.adapter.findOne, {
      model: 'oauthClient',
      where: [{ field: 'clientId', value: 'client' }],
    })
    await test.mutation(component.adapter.create, {
      model: 'oauthClient',
      data: { ...client, id: 'other-client-row', clientId: 'other' },
    })
    await test.mutation(component.adapter.create, {
      model: 'oauthClientResource',
      data: { id: 'other-link', clientId: 'other', resourceId: resource },
    })
    await test.mutation(component.adapter.create, {
      model: 'oauthConsent',
      data: {
        id: 'other-consent',
        clientId: 'other',
        userId: 'user',
        resources: [resource],
        scopes,
      },
    })
    await request(originalToken, { client_id: 'other' }, 'revoke')
    expect(
      await test.query(component.adapter.findOne, {
        model: 'oauthConsent',
        where: [{ field: 'id', value: 'other-consent' }],
      }),
    ).not.toBeNull()
  })
  it('exchanges a normal signed-in authorization code for the first renewable token', async () => {
    const { send, request } = await init()
    const login = await send(
      new Request(`${issuer}/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({
          email: 'user@example.test',
          password: 'Synthetic password for tests 2026',
        }),
      }),
    )
    expect(login.status).toBe(200)
    const cookie = login.headers['set-cookie']?.split(';')[0]
    expect(cookie).toBeTypeOf('string')
    const verifier = 'A'.repeat(64)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')
    const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect'
    const parameters = new URLSearchParams({
      client_id: 'client',
      redirect_uri: redirect,
      response_type: 'code',
      scope: scopes.join(' '),
      resource,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'synthetic-state',
    })
    const authorization = await send(
      new Request(`${issuer}/oauth2/authorize?${parameters}`, {
        headers: { cookie: cookie!, accept: 'text/html' },
      }),
    )
    expect(authorization.status).toBe(302)
    const code = new URL(authorization.headers.location!).searchParams.get('code')
    expect(code).toBeTypeOf('string')
    const exchange = await send(
      new Request(`${issuer}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: 'client',
          grant_type: 'authorization_code',
          code: code!,
          redirect_uri: redirect,
          code_verifier: verifier,
          resource,
        }),
      }),
    )
    expect(exchange.status).toBe(200)
    const result = JSON.parse(exchange.text)
    expect(result.refresh_token).toBeTypeOf('string')
    expect((await request(result.refresh_token)).status).toBe(200)
    expect(decodeJwt(result.access_token)).toMatchObject({
      bcn_grant_id: 'consent',
      sub: 'user',
      scope: scopes.join(' '),
    })
  })
})
