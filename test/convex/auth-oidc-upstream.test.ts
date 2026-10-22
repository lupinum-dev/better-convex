/// <reference types="vite/client" />
import type { JwtOptions } from 'better-auth/plugins'
import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, httpRouter } from 'convex/server'
import { decodeJwt } from 'jose'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import type { BetterConvexAuthEmail } from '../../src/runtime/convex-auth/create-better-convex-auth'
import { rotateSigningKeyWithOfficialJwt } from '../../src/runtime/convex-auth/jwks-rotation'
import { createFakeIdp, type FakeIdp } from '../helpers/fake-oidc-idp'

// The harness is the one in auth-oidc.test.ts: production mode keeps the origin and CSRF checks
// on (F35), and the fake IdP is the only network.
const restoreHostEnvironment = await vi.hoisted(async () => {
  const { env } = await import('node:process')
  const previous = { NODE_ENV: env.NODE_ENV, TEST: env.TEST }
  env.NODE_ENV = 'production'
  env.TEST = 'false'
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(env, name)
      else env[name] = value
    }
  }
})
const { createBetterConvexAuthOwned } =
  await import('../../src/runtime/convex-auth/create-better-convex-auth')
afterAll(restoreHostEnvironment)

const rootModules = import.meta.glob('../fixtures/jwks-rotation/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const components = componentsGeneric() as unknown as {
  sessionAuth: ComponentApi<'sessionAuth'>
}

const SITE = 'https://app.example.test'
const TOKEN_FIELDS = [
  'accessToken',
  'refreshToken',
  'idToken',
  'accessTokenExpiresAt',
  'refreshTokenExpiresAt',
] as const

type Client = ReturnType<ReturnType<ReturnType<typeof createEnvironment>['app']>['client']>
type Row = Record<string, unknown>

let ipCounter = 0
function freshIp() {
  ipCounter += 1
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`
}

function createEnvironment() {
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent('sessionAuth', authSchema, authModules)

  function app(idp: FakeIdp, options: Record<string, unknown> = {}) {
    const auth = createBetterConvexAuthOwned(components.sessionAuth, {
      email: async (_ctx: unknown, _message: BetterConvexAuthEmail) => {},
      oidc: { issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret },
      ...options,
    } as never)
    const http = httpRouter()
    auth.registerRoutes(http)

    function client() {
      let cookie = ''

      async function call(
        method: 'GET' | 'POST',
        path: string,
        json?: Record<string, unknown>,
        form?: Record<string, string>,
      ) {
        const ip = freshIp()
        const response = await test.action(async (ctx) => {
          const url = new URL(`https://deployment.convex.site/api/auth${path}`)
          const route = http.lookup(url.pathname, method)
          if (!route) throw new Error(`no route ${method} ${path}`)
          const handler = route[0] as unknown as {
            _handler: (ctx: unknown, request: Request) => Promise<Response>
          }
          const res = await handler._handler(
            { ...ctx, meta: { getRequestMetadata: async () => ({ ip }) } },
            new Request(url, {
              method,
              headers: {
                Origin: SITE,
                cookie,
                ...(form
                  ? { 'content-type': 'application/x-www-form-urlencoded' }
                  : method === 'POST'
                    ? { 'content-type': 'application/json' }
                    : {}),
              },
              ...(form
                ? { body: new URLSearchParams(form) }
                : method === 'POST'
                  ? { body: JSON.stringify(json ?? {}) }
                  : {}),
              redirect: 'manual',
            }),
          )
          const text = await res.text()
          let body: unknown = text
          try {
            body = JSON.parse(text)
          } catch {
            // not JSON: keep the text
          }
          return {
            status: res.status,
            body,
            cookies: res.headers.getSetCookie(),
            location: res.headers.get('location'),
            retryAfter: res.headers.get('retry-after'),
          }
        })
        for (const raw of response.cookies) {
          const [pair] = raw.split(';')
          const [name, ...rest] = pair!.split('=')
          const jar = new Map(
            cookie
              .split('; ')
              .filter(Boolean)
              .map((part) => [part.split('=')[0]!, part] as const),
          )
          if (rest.join('=') === '' || /max-age=0/iu.test(raw)) jar.delete(name!)
          else jar.set(name!, pair!)
          cookie = [...jar.values()].join('; ')
        }
        return response
      }

      return {
        post: (path: string, json: Record<string, unknown> = {}) => call('POST', path, json),
        get: (path: string) => call('GET', path),
        form: (path: string, fields: Record<string, string>) =>
          call('POST', path, undefined, fields),
        hasSession: async () => {
          const res = await call('GET', '/get-session')
          return typeof res.body === 'object' && res.body !== null && 'user' in res.body
        },
        mint: async () => {
          const res = await call('GET', '/convex/token')
          return { status: res.status, token: (res.body as { token?: string } | null)?.token }
        },
      }
    }

    /** Create the Convex token signing key, as `jwksOperatorFunctions` does in a deployment. */
    async function provision() {
      await test.mutation(async (ctx) => {
        const instance = await auth.createAuth(ctx)
        const context = (await instance.$context) as Parameters<
          typeof rotateSigningKeyWithOfficialJwt
        >[0] & { getPlugin(id: 'jwt'): { options: unknown } | undefined }
        await rotateSigningKeyWithOfficialJwt(
          context,
          context.getPlugin('jwt')!.options as JwtOptions,
          (next) => ctx.runMutation(components.sessionAuth.adapter.rotateSigningKey, { next }),
        )
      })
    }

    /** Sign in through the IdP and mint a Convex token; returns the identity the token carries. */
    async function signInAndMint(browser: Client) {
      await signIn(browser, idp)
      const { status, token } = await browser.mint()
      expect(status).toBe(200)
      const claims = decodeJwt(token!)
      return { subject: claims.sub!, sid: String(claims.sid), token_use: String(claims.token_use) }
    }

    return { auth, client, provision, signInAndMint }
  }

  const rows = (model: 'user' | 'account') =>
    test
      .query(components.sessionAuth.adapter.findMany, {
        model,
        paginationOpts: { cursor: null, numItems: 50 },
      })
      .then((result) => result.page as Row[])
  const oidcAccount = async () => {
    const accounts = (await rows('account')).filter((account) => account.providerId === 'oidc')
    expect(accounts).toHaveLength(1)
    return accounts[0]!
  }
  const tokensOf = (account: Row) =>
    Object.fromEntries(TOKEN_FIELDS.map((field) => [field, account[field]]))
  /** Write fields of the user's `oidc` account directly, as old or hostile data would be. */
  const patchOidcAccount = async (update: Row) => {
    await test.mutation(components.sessionAuth.adapter.updateOne, {
      model: 'account',
      where: [{ field: 'providerId', value: 'oidc' }],
      update,
    })
  }
  /** Within the 60 s refresh margin, so the next use refreshes. */
  const expireAccessToken = () => patchOidcAccount({ accessTokenExpiresAt: Date.now() - 1_000 })

  const createRow = (model: string, data: Record<string, unknown>) =>
    test.mutation(components.sessionAuth.adapter.create, { model, data })

  /** The operator-provisioned MCP client and resource (what `oauthOperator` writes), plus the user's consent. */
  async function seedMcpClient(userId: string | null) {
    await createRow('oauthClient', {
      id: 'mcp-client-row',
      clientId: MCP_CLIENT,
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
      scopes: MCP_SCOPES,
      redirectUris: [MCP_REDIRECT],
    })
    await createRow('oauthResource', {
      id: 'mcp-resource-row',
      identifier: MCP_RESOURCE,
      name: 'MCP',
      disabled: false,
      allowedScopes: MCP_SCOPES,
      accessTokenTtl: 600,
      signingAlgorithm: 'RS256',
      dpopBoundAccessTokensRequired: false,
    })
    await createRow('oauthClientResource', {
      id: 'mcp-link',
      clientId: MCP_CLIENT,
      resourceId: MCP_RESOURCE,
    })
    if (userId !== null) {
      await createRow('oauthConsent', {
        id: 'mcp-consent',
        clientId: MCP_CLIENT,
        userId,
        resources: [MCP_RESOURCE],
        scopes: MCP_SCOPES,
      })
    }
  }
  const userIdOf = async (email?: string) => {
    const users = await rows('user')
    const user = email ? users.find((row) => row.email === email) : users[0]
    return String(user!.id)
  }

  return {
    test,
    app,
    rows,
    oidcAccount,
    tokensOf,
    patchOidcAccount,
    expireAccessToken,
    seedMcpClient,
    userIdOf,
  }
}

const MCP_CLIENT = 'mcp-client'
const MCP_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect'
const MCP_RESOURCE = 'https://deployment.convex.site/mcp'
const MCP_SCOPES = ['mcp:read', 'offline_access']
const MCP_OPTIONS = { oauth: { mcp: { scopes: { 'mcp:read': 'Read' } } } }

/** Authorization-code flow for the signed-in `browser` against the seeded MCP client; returns the first token response. */
async function connectMcpClient(browser: Client, mcpClient: Client) {
  const verifier = 'A'.repeat(64)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  const authorization = await browser.get(
    `/oauth2/authorize?${new URLSearchParams({
      client_id: MCP_CLIENT,
      redirect_uri: MCP_REDIRECT,
      response_type: 'code',
      scope: MCP_SCOPES.join(' '),
      resource: MCP_RESOURCE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'state',
    })}`,
  )
  expect(authorization.status).toBe(302)
  const code = new URL(authorization.location!).searchParams.get('code')
  expect(code).toBeTypeOf('string')
  const exchange = await mcpClient.form('/oauth2/token', {
    client_id: MCP_CLIENT,
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: MCP_REDIRECT,
    code_verifier: verifier,
    resource: MCP_RESOURCE,
  })
  expect(exchange.status).toBe(200)
  return exchange.body as { access_token: string; refresh_token: string }
}

const refreshGrant = (mcpClient: Client, refreshToken: string) =>
  mcpClient.form('/oauth2/token', {
    client_id: MCP_CLIENT,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    resource: MCP_RESOURCE,
  })

/** A fake IdP at `fetch` that also records every access token its token endpoint hands out. */
async function installIdp() {
  const idp = await createFakeIdp()
  idp.install()
  const idpFetch = globalThis.fetch
  const issued: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await idpFetch(input, init)
    if (new Request(input, init).url.endsWith('/protocol/openid-connect/token') && response.ok) {
      issued.push(((await response.clone().json()) as { access_token: string }).access_token)
    }
    return response
  })
  const tokenRequests = (grantType: 'authorization_code' | 'refresh_token') =>
    idp.requests.filter((request) => request.body?.get('grant_type') === grantType).length
  return { idp, idpFetch, issued, tokenRequests }
}

async function signIn(browser: Client, idp: FakeIdp) {
  const start = await browser.post('/sign-in/social', {
    provider: 'oidc',
    callbackURL: `${SITE}/app`,
    errorCallbackURL: `${SITE}/error`,
  })
  expect(start.status).toBe(200)
  const url = new URL((start.body as { url: string }).url)
  const code = idp.issueCode({
    nonce: url.searchParams.get('nonce')!,
    codeChallenge: url.searchParams.get('code_challenge')!,
    redirectURI: url.searchParams.get('redirect_uri')!,
  })
  const callback = await browser.get(
    `/callback/oidc?code=${code}&state=${url.searchParams.get('state')}`,
  )
  expect(callback.status).toBe(302)
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('OIDC upstream tokens with real Better Auth', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_URL', SITE)
    vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
    vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  // Catches: a helper that refreshes a token with time left, or hands out a token other than the stored one.
  it('getOidcAccessToken returns a stored fresh token', async () => {
    const { idp, issued, tokenRequests } = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    const identity = await app.signInAndMint(app.client())
    const account = await env.oidcAccount()

    const token = await env.test
      .withIdentity(identity)
      .action((ctx) => app.auth.getOidcAccessToken(ctx))

    expect(token).toEqual({
      accessToken: issued[0],
      expiresAt: account.accessTokenExpiresAt,
    })
    expect(tokenRequests('refresh_token')).toBe(0)
  })

  // Catches: a missing lease across actions, so a rotating IdP sees the refresh token twice.
  it('getOidcAccessToken refreshes once for two concurrent actions', async () => {
    const { idp, issued, tokenRequests } = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    const identity = await app.signInAndMint(app.client())
    await env.expireAccessToken()

    const [first, second] = await Promise.all([
      env.test.withIdentity(identity).action((ctx) => app.auth.getOidcAccessToken(ctx)),
      env.test.withIdentity(identity).action((ctx) => app.auth.getOidcAccessToken(ctx)),
    ])

    expect(tokenRequests('refresh_token')).toBe(1)
    expect(issued).toHaveLength(2)
    expect(first.accessToken).toBe(issued[1])
    expect(second).toEqual(first)
    expect(String((await env.oidcAccount()).accessToken)).toMatch(/^\$ba\$/u)
  })

  // Catches: an ended IdP grant that the helper reports as an outage, or that leaves sessions alive.
  it('getOidcAccessToken after invalid_grant throws OIDC_SIGN_IN_REQUIRED and ends sessions', async () => {
    const { idp } = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    const browser = app.client()
    const identity = await app.signInAndMint(browser)
    await env.expireAccessToken()
    idp.respond.token = () => json({ error: 'invalid_grant' }, 400)

    await expect(
      env.test.withIdentity(identity).action((ctx) => app.auth.getOidcAccessToken(ctx)),
    ).rejects.toMatchObject({
      data: {
        code: 'OIDC_SIGN_IN_REQUIRED',
        message: 'Sign in through the identity provider again',
      },
    })
    expect(await browser.hasSession()).toBe(false)
    expect(env.tokensOf(await env.oidcAccount())).toEqual({
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    })
  })

  // Catches: the helper running in a query or mutation, where `fetch` fails and a refresh cannot run (F28).
  it('refuses getOidcAccessToken from a mutation', async () => {
    const { idp } = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    const identity = await app.signInAndMint(app.client())
    const helper = app.auth.getOidcAccessToken as (ctx: unknown) => Promise<unknown>

    await expect(env.test.withIdentity(identity).mutation((ctx) => helper(ctx))).rejects.toThrow(
      new TypeError('AUTH_OIDC_ACCESS_TOKEN_REQUIRES_ACTION'),
    )
    await expect(env.test.withIdentity(identity).query((ctx) => helper(ctx))).rejects.toThrow(
      new TypeError('AUTH_OIDC_ACCESS_TOKEN_REQUIRES_ACTION'),
    )
  })

  // Catches: a helper that skips the live session check and reads the tokens of an ended session.
  it('getOidcAccessToken without a session throws UNAUTHENTICATED', async () => {
    const { idp } = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    const browser = app.client()
    const identity = await app.signInAndMint(browser)
    expect((await browser.post('/sign-out', { disableRedirect: true })).status).toBe(200)

    await expect(
      env.test.withIdentity(identity).action((ctx) => app.auth.getOidcAccessToken(ctx)),
    ).rejects.toMatchObject({
      data: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    })
  })

  // Catches: an account lookup without the provider, which mixes up the GitHub and IdP tokens.
  it("never returns another provider's token", async () => {
    const { idp, issued } = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    const identity = await app.signInAndMint(app.client())
    const [user] = await env.rows('user')
    const now = Date.now()
    await env.test.mutation(components.sessionAuth.adapter.create, {
      model: 'account',
      data: {
        id: crypto.randomUUID(),
        accountId: 'github-ada',
        providerId: 'github',
        userId: String(user!.id),
        accessToken: 'github-access-token',
        refreshToken: 'github-refresh-token',
        idToken: null,
        accessTokenExpiresAt: now + 3_600_000,
        refreshTokenExpiresAt: null,
        scope: null,
        password: null,
        createdAt: now,
        updatedAt: now,
      },
    })

    const token = await env.test
      .withIdentity(identity)
      .action((ctx) => app.auth.getOidcAccessToken(ctx))

    expect(token.accessToken).toBe(issued[0])
  })

  // Catches: a plaintext refresh token (old or injected data) that is accepted and sent to the IdP.
  it('refuses a refresh token stored without encryption', async () => {
    const { idp, tokenRequests } = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    const identity = await app.signInAndMint(app.client())
    await env.patchOidcAccount({
      refreshToken: 'plain-refresh-token',
      accessTokenExpiresAt: Date.now() - 1_000,
    })

    await expect(
      env.test.withIdentity(identity).action((ctx) => app.auth.getOidcAccessToken(ctx)),
    ).rejects.toMatchObject({
      data: {
        code: 'OIDC_UNAVAILABLE',
        message: 'The identity provider is not available. Try again later',
      },
    })
    expect(tokenRequests('refresh_token')).toBe(0)
    expect((await env.oidcAccount()).refreshToken).toBe('plain-refresh-token')
  })

  // Catches: a user without an `oidc` account who gets a raw error or "sign in again" in place of
  // OIDC_ACCOUNT_REQUIRED.
  it('getOidcAccessToken without an oidc account throws OIDC_ACCOUNT_REQUIRED', async () => {
    const { idp, tokenRequests } = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    const identity = await app.signInAndMint(app.client())
    await env.test.mutation(components.sessionAuth.adapter.deleteOne, {
      model: 'account',
      where: [{ field: 'providerId', value: 'oidc' }],
    })

    await expect(
      env.test.withIdentity(identity).action((ctx) => app.auth.getOidcAccessToken(ctx)),
    ).rejects.toMatchObject({
      data: {
        code: 'OIDC_ACCOUNT_REQUIRED',
        message: 'Sign in through the identity provider or link it first',
      },
    })
    expect(tokenRequests('refresh_token')).toBe(0)
  })

  // Catches: a store or decryption failure that reaches the action as a raw Error, which an app
  // that checks for OIDC_UNAVAILABLE cannot tell from a bug.
  it('getOidcAccessToken maps an unreadable account to OIDC_UNAVAILABLE', async () => {
    const { idp, tokenRequests } = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    const identity = await app.signInAndMint(app.client())
    // The adapter refuses to reveal an ID token stored without encryption, so the account read throws.
    await env.patchOidcAccount({ idToken: 'plain-id-token' })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      env.test.withIdentity(identity).action((ctx) => app.auth.getOidcAccessToken(ctx)),
    ).rejects.toMatchObject({
      data: {
        code: 'OIDC_UNAVAILABLE',
        message: 'The identity provider is not available. Try again later',
      },
    })
    expect(
      log.mock.calls.map((call) => (call[1] as { code?: string } | undefined)?.code),
    ).toContain('AUTH_OIDC_REFRESH_FAILED:helper')
    expect(tokenRequests('refresh_token')).toBe(0)
  })

  // Catches: a refresh that overwrites the tokens a sign-in stored while the IdP answered (no compare-and-swap).
  it('a refresh does not overwrite tokens from a newer sign-in', async () => {
    const { idp, idpFetch, issued, tokenRequests } = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    const identity = await app.signInAndMint(app.client())
    await env.expireAccessToken()
    let afterSignIn: Row | null = null
    idp.respond.token = async (request) => {
      delete idp.respond.token
      // The same user signs in again on another device before the refresh answer arrives.
      await signIn(app.client(), idp)
      afterSignIn = env.tokensOf(await env.oidcAccount())
      return await idpFetch(request)
    }

    const token = await env.test
      .withIdentity(identity)
      .action((ctx) => app.auth.getOidcAccessToken(ctx))

    // The fake records the refresh twice: once here, once when the override passes it on.
    expect(tokenRequests('refresh_token')).toBe(2)
    expect(issued).toHaveLength(3)
    expect(token.accessToken).toBe(issued[1])
    expect(afterSignIn).not.toBeNull()
    expect(env.tokensOf(await env.oidcAccount())).toEqual(afterSignIn)
  })

  // Catches: Better Auth's own refresh path reaching the oidc account, a second refresh owner without a lease.
  it('auth.api.getAccessToken cannot refresh the oidc account', async () => {
    const { idp, tokenRequests } = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    await app.signInAndMint(app.client())
    await env.expireAccessToken()
    const before = await env.oidcAccount()

    await expect(
      env.test.action(async (ctx) => {
        const instance = await app.auth.createAuth(ctx)
        return await instance.api.getAccessToken({
          body: { accountId: String(before.id), userId: String(before.userId) },
        })
      }),
    ).rejects.toMatchObject({ body: { code: 'FAILED_TO_GET_ACCESS_TOKEN' } })
    expect(tokenRequests('refresh_token')).toBe(0)
    expect(await env.oidcAccount()).toEqual(before)
  })

  // Catches: a token mint that ignores an IdP that refused the refresh token (4.6).
  it('ended IdP grant blocks token mint', async () => {
    const { idp, tokenRequests } = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    const browser = app.client()
    await app.signInAndMint(browser)
    await env.expireAccessToken()
    idp.respond.token = () => json({ error: 'invalid_grant' }, 400)

    const minted = await browser.get('/convex/token')
    expect(minted.status).toBe(401)
    expect(minted.body).toMatchObject({ code: 'OIDC_SIGN_IN_REQUIRED' })
    expect(tokenRequests('refresh_token')).toBe(1)
    expect(await browser.hasSession()).toBe(false)
    expect(env.tokensOf(await env.oidcAccount())).toEqual({
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    })
  })

  // Catches: a grace limit that is off by direction or missing: an IdP that stays down must block the
  // Convex token once the stored access token is over an hour old, and never end the session.
  it.each([
    { minutes: 61, status: 503, code: 'OIDC_UNAVAILABLE' },
    { minutes: 59, status: 200, code: undefined },
  ])(
    'IdP down with the access token expired $minutes minutes ago: mint answers $status',
    async ({ minutes, status, code }) => {
      const { idp } = await installIdp()
      const env = createEnvironment()
      const app = env.app(idp)
      await app.provision()
      const browser = app.client()
      await app.signInAndMint(browser)
      await env.patchOidcAccount({ accessTokenExpiresAt: Date.now() - minutes * 60_000 })
      idp.respond.token = () => {
        throw new TypeError('fetch failed')
      }

      const minted = await browser.get('/convex/token')
      expect(minted.status).toBe(status)
      if (code) expect(minted.body).toMatchObject({ code })
      expect(await browser.hasSession()).toBe(true)
    },
  )

  // Catches: an unreachable IdP that signs people out or blocks their Convex token.
  it('IdP outage does not block token mint', async () => {
    const { idp, tokenRequests } = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    const browser = app.client()
    await app.signInAndMint(browser)
    await env.expireAccessToken()
    const before = env.tokensOf(await env.oidcAccount())
    idp.respond.token = () => {
      throw new TypeError('fetch failed')
    }

    expect((await browser.mint()).status).toBe(200)
    expect(tokenRequests('refresh_token')).toBe(1)
    expect(await browser.hasSession()).toBe(true)
    expect(env.tokensOf(await env.oidcAccount())).toEqual(before)
  })

  describe('MCP access tokens', () => {
    async function connected() {
      const { idp, tokenRequests } = await installIdp()
      const env = createEnvironment()
      const app = env.app(idp, MCP_OPTIONS)
      await app.provision()
      const browser = app.client()
      await app.signInAndMint(browser)
      await env.seedMcpClient(await env.userIdOf())
      const mcpClient = app.client()
      const tokens = await connectMcpClient(browser, mcpClient)
      return { idp, tokenRequests, env, app, browser, mcpClient, tokens }
    }

    // Catches: MCP clients that keep refreshing for days after the IdP ended the user's grant (reviewer's reproduced bug).
    it('IdP ended the grant: the MCP refresh grant fails with invalid_grant and the user is signed out', async () => {
      const { idp, env, browser, mcpClient, tokens } = await connected()
      await env.expireAccessToken()
      idp.respond.token = () => json({ error: 'invalid_grant' }, 400)

      const refreshed = await refreshGrant(mcpClient, tokens.refresh_token)

      expect(refreshed.status).toBe(400)
      expect(refreshed.body).toMatchObject({ error: 'invalid_grant' })
      expect(await browser.hasSession()).toBe(false)
    })

    // Catches: a long IdP outage that leaves MCP tokens flowing unchecked, or one that signs the user out.
    it('IdP down and its token expired over an hour ago: the MCP refresh grant answers 503 and the session stays', async () => {
      const { idp, env, browser, mcpClient, tokens } = await connected()
      await env.patchOidcAccount({ accessTokenExpiresAt: Date.now() - 61 * 60_000 })
      idp.respond.token = () => {
        throw new TypeError('fetch failed')
      }

      const refreshed = await refreshGrant(mcpClient, tokens.refresh_token)

      expect(refreshed.status).toBe(503)
      expect(refreshed.body).toMatchObject({ error: 'temporarily_unavailable' })
      expect(refreshed.retryAfter).toBe('30')
      expect(await browser.hasSession()).toBe(true)
    })

    // Catches: the check applied to every OAuth user, which refuses MCP tokens for people who never signed in through the IdP.
    it('a user without an oidc account still gets MCP tokens while the IdP is down', async () => {
      const { idp } = await installIdp()
      const env = createEnvironment()
      const app = env.app(idp, {
        ...MCP_OPTIONS,
        emailAndPassword: { requireEmailVerification: false },
      })
      await app.provision()
      const browser = app.client()
      const credentials = { email: 'plain@example.test', password: 'Synthetic password 2026' }
      await browser.post('/sign-up/email', { ...credentials, name: 'Plain' })
      await browser.post('/sign-in/email', credentials)
      await env.seedMcpClient(await env.userIdOf('plain@example.test'))
      idp.respond.token = () => {
        throw new TypeError('fetch failed')
      }
      const mcpClient = app.client()

      const tokens = await connectMcpClient(browser, mcpClient)
      const refreshed = await refreshGrant(mcpClient, tokens.refresh_token)

      expect(refreshed.status).toBe(200)
      expect(await browser.hasSession()).toBe(true)
    })
  })
})
