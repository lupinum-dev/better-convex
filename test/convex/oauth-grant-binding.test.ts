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
import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'
import { rotateSigningKeyWithOfficialJwt } from '../../src/runtime/convex-auth/jwks-rotation'
import { clearVerificationKeyCache } from '../../src/runtime/convex-auth/oauth-resource'
import { convexAuth } from '../../src/runtime/convex-auth/plugin'
import { createConvexAuthRateLimitStorage } from '../../src/runtime/convex-auth/rate-limit-storage'

// Non-renewable (renewal: false) access tokens must be bound to the exact
// consent they were issued under, like renewable ones: revoking consent A and
// granting an equivalent consent B for the same session must not revive a
// token issued under A.

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
const convexSite = 'https://deployment.convex.site'
const resource = `${convexSite}/mcp`
const scopes = ['mcp:read', 'mcp:write']
const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect'
const password = 'Synthetic password for tests 2026'

const providerLog = vi.fn()

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
    grantTypes: ['authorization_code'],
    loginPage: '/login',
    rateLimit: {
      authorize: { max: 30, window: 60 },
      revoke: { max: 30, window: 60 },
      token: { max: 20, window: 60 },
    },
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
    disabledPaths: [
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
    ],
    account: { encryptOAuthTokens: true, storeAccountCookie: false },
    basePath: '/api/auth',
    baseURL: origin,
    database: createConvexAuthAdapter(ctx, component),
    advanced: { ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } },
    // Silent, but captured: a refused token issuance must say why.
    logger: { level: 'error', log: providerLog },
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
              issuer: convexSite,
            },
          ],
        },
        oauthProvider: options,
        sessionJwt: {
          issuer: convexSite,
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
    providerId: 'credential',
    userId: 'user',
    password: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  })
  await create('oauthClient', {
    id: 'client-row',
    clientId: 'client',
    disabled: false,
    subjectType: 'public',
    applicationType: 'native',
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
    requirePKCE: true,
    skipConsent: false,
    enableEndSession: false,
    dpopBoundAccessTokens: false,
    scopes,
    redirectUris: [redirect],
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
  await test.action(async (ctx) => {
    const { auth, jwtOptions } = createAuth(ctx)
    await rotateSigningKeyWithOfficialJwt(await auth.$context, jwtOptions, (next) =>
      ctx.runMutation(component.adapter.rotateSigningKey, {
        next,
        onlyIfEmpty: true,
      }),
    )
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

  const login = await send(
    new Request(`${issuer}/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email: 'user@example.test', password }),
    }),
  )
  expect(login.status).toBe(200)
  const cookie = login.headers['set-cookie']!.split(';')[0]!

  /** Authorization request for the signed-in session under the current consent. */
  async function authorize(): Promise<{ code: string; verifier: string }> {
    const verifier = 'A'.repeat(64)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')
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
        headers: { cookie, accept: 'text/html' },
      }),
    )
    expect(authorization.status).toBe(302)
    const code = new URL(authorization.headers.location!).searchParams.get('code')
    expect(code).toBeTypeOf('string')
    return { code: code!, verifier }
  }

  const exchangeCode = ({ code, verifier }: { code: string; verifier: string }) =>
    send(
      new Request(`${issuer}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: 'client',
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirect,
          code_verifier: verifier,
          resource,
        }),
      }),
    )

  /** Authorization-code grant for the signed-in session under the current consent. */
  async function issueAccessToken(): Promise<string> {
    const exchange = await exchangeCode(await authorize())
    expect(exchange.status).toBe(200)
    const result = JSON.parse(exchange.text)
    expect(result.refresh_token).toBeUndefined()
    return result.access_token as string
  }

  const consent = (id: string) =>
    create('oauthConsent', {
      id,
      clientId: 'client',
      userId: 'user',
      resources: [resource],
      scopes,
    })

  const deleteConsent = (id: string) =>
    test.mutation(component.adapter.deleteOne, {
      model: 'oauthConsent',
      where: [{ field: 'id', value: id }],
    })

  return {
    test,
    consent,
    deleteConsent,
    authorize,
    exchangeCode,
    issueAccessToken,
  }
}

const betterConvexAuth = createBetterConvexAuth(component, {
  appName: 'Grant binding',
  oauth: {
    mcp: {
      scopes: { 'mcp:read': 'Read', 'mcp:write': 'Write' },
      renewal: false,
    },
  },
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  vi.stubEnv('SITE_URL', origin)
  vi.stubEnv('CONVEX_SITE_URL', convexSite)
  clearVerificationKeyCache()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  providerLog.mockReset()
})

describe('non-renewable OAuth access tokens are bound to their consent', () => {
  it('does not revive a token issued under a revoked consent when an equivalent consent is granted', async () => {
    const { test, consent, issueAccessToken } = await init()
    await consent('consent-a')
    const tokenA = await issueAccessToken()

    const verify = (token: string) =>
      test.query(async (ctx) => {
        const verified = await betterConvexAuth
          .createMcpAccessVerifier(ctx as never)
          .verifyAccessToken(token, { issuer, resource: new URL(resource) })
        const { user } = await betterConvexAuth.requireMcpPrincipal(
          ctx as never,
          verified.principal,
          { scope: 'mcp:read' },
        )
        return { grantId: verified.principal.grantId, userId: user.id }
      })

    await expect(verify(tokenA)).resolves.toEqual({
      grantId: 'consent-a',
      userId: 'user',
    })

    await test.mutation((ctx) =>
      betterConvexAuth.oauthConnections.revoke(ctx as never, {
        clientId: 'client',
        userId: 'user',
      }),
    )
    await expect(verify(tokenA)).rejects.toThrow('AUTH_OAUTH_TOKEN_INVALID')

    // Same user, same session, same client and scopes: an equivalent consent B.
    await consent('consent-b')
    await expect(verify(tokenA)).rejects.toThrow('AUTH_OAUTH_TOKEN_INVALID')

    const tokenB = await issueAccessToken()
    await expect(verify(tokenB)).resolves.toEqual({
      grantId: 'consent-b',
      userId: 'user',
    })
    await expect(verify(tokenA)).rejects.toThrow('AUTH_OAUTH_TOKEN_INVALID')

    // Each token names the immutable consent it was issued under.
    expect(decodeJwt(tokenA)).toMatchObject({
      bcn_grant_id: 'consent-a',
      scope: 'mcp:read mcp:write',
    })
    expect(decodeJwt(tokenB)).toMatchObject({ bcn_grant_id: 'consent-b' })
  })
})

describe('access-token issuance fails closed without a live consent', () => {
  it('issues no access token when the consent is deleted between authorize and token exchange', async () => {
    const { consent, deleteConsent, authorize, exchangeCode } = await init()
    await consent('consent-a')
    const grant = await authorize()

    await deleteConsent('consent-a')
    const exchange = await exchangeCode(grant)

    expect({ status: exchange.status, text: exchange.text }).toEqual({
      status: 500,
      text: '',
    })
    // oauthGrantClaim refused to bind the token: no consent row to name.
    const logged = providerLog.mock.calls.flatMap(([level, message, ...args]) =>
      [message, ...args].map((value) => ({
        level,
        message: value instanceof Error ? value.message : String(value),
      })),
    )
    expect(logged).toContainEqual({
      level: 'error',
      message: 'AUTH_OAUTH_GRANT_INVALID',
    })
  })
})
