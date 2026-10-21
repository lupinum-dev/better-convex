/// <reference types="vite/client" />
/*
 * Sign-in, central logout and upstream tokens against a real Keycloak, through the real Better Auth
 * factory and the real Convex auth component schema. Needs the container from
 * test/fixtures/keycloak/docker-compose.yml and BCN_TEST_KEYCLOAK_URL; skips without it.
 * Only the browser is simulated: a small HTTP server on :18081 stands in for the Convex site and
 * forwards Keycloak's back-channel POST into the route handler.
 */
import { createServer, type Server } from 'node:http'

import type { AuthContext } from 'better-auth'
import type { JwtOptions } from 'better-auth/plugins'
import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, httpRouter } from 'convex/server'
import { decodeJwt, decodeProtectedHeader } from 'jose'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import type { BetterConvexAuthEmail } from '../../src/runtime/convex-auth/create-better-convex-auth'
import { rotateSigningKeyWithOfficialJwt } from '../../src/runtime/convex-auth/jwks-rotation'

// Better Auth captures NODE_ENV at import and checks TEST when creating the request context.
// Production mode keeps the origin and CSRF checks on, as in a deployment.
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
const components = componentsGeneric() as unknown as { sessionAuth: ComponentApi<'sessionAuth'> }

const KEYCLOAK = process.env.BCN_TEST_KEYCLOAK_URL
const REALM = 'better-convex-test'
const ISSUER = `${KEYCLOAK}/realms/${REALM}`
const CLIENT_ID = 'better-convex'
const CLIENT_SECRET = 'test-client-secret-not-for-production'
const SITE = 'https://app.example.test'
const BACKCHANNEL_PORT = 18_081
const BACKCHANNEL_PATH = '/oidc/backchannel-logout'
const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout'

const realFetch = globalThis.fetch

// ---------- the app under test ----------
let ipCounter = 0
const freshIp = () => `198.51.100.${(ipCounter++ % 250) + 1}`

type Row = Record<string, unknown>
type Client = ReturnType<ReturnType<typeof createApp>['client']>

function createApp() {
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent('sessionAuth', authSchema, authModules)
  const auth = createBetterConvexAuthOwned(components.sessionAuth, {
    email: async (_ctx: unknown, _message: BetterConvexAuthEmail) => {},
    oidc: { issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
  } as never)
  const http = httpRouter()
  auth.registerRoutes(http)

  function client() {
    let cookie = ''

    async function call(
      method: 'GET' | 'POST',
      path: string,
      init: { json?: Record<string, unknown>; form?: string } = {},
    ) {
      const ip = freshIp()
      const response = await test.action(async (ctx) => {
        const url = new URL(`https://deployment.convex.site/api/auth${path}`)
        const route = http.lookup(url.pathname, method)
        if (!route) throw new Error(`no route ${method} ${path}`)
        const handler = route[0] as unknown as {
          _handler: (ctx: unknown, request: Request) => Promise<Response>
        }
        // Keycloak's back-channel call has no Origin and no cookies.
        const headers: Record<string, string> =
          init.form === undefined
            ? {
                Origin: SITE,
                cookie,
                ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
              }
            : { 'content-type': 'application/x-www-form-urlencoded' }
        const res = await handler._handler(
          { ...ctx, meta: { getRequestMetadata: async () => ({ ip }) } },
          new Request(url, {
            method,
            headers,
            ...(method === 'POST' ? { body: init.form ?? JSON.stringify(init.json ?? {}) } : {}),
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
          body: body as Record<string, unknown> | string | null,
          cookies: res.headers.getSetCookie(),
          location: res.headers.get('location') ?? '',
        }
      })
      if (init.form === undefined) {
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
      }
      return response
    }

    return {
      post: (path: string, json: Record<string, unknown> = {}) => call('POST', path, { json }),
      get: (path: string) => call('GET', path),
      backchannel: (form: string) => call('POST', BACKCHANNEL_PATH, { form }),
      hasSession: async () => {
        const res = await call('GET', '/get-session')
        return typeof res.body === 'object' && res.body !== null && Boolean(res.body.user)
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
      const context = (await instance.$context) as unknown as AuthContext
      await rotateSigningKeyWithOfficialJwt(
        context as unknown as Parameters<typeof rotateSigningKeyWithOfficialJwt>[0],
        context.getPlugin('jwt')!.options as JwtOptions,
        (next) => ctx.runMutation(components.sessionAuth.adapter.rotateSigningKey, { next }),
      )
    })
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
  /** Within the 60 s refresh margin, so the next use refreshes. */
  const expireAccessToken = () =>
    test.mutation(components.sessionAuth.adapter.updateOne, {
      model: 'account',
      where: [{ field: 'providerId', value: 'oidc' }],
      update: { accessTokenExpiresAt: Date.now() - 1_000 },
    })

  return { test, auth, client, provision, rows, oidcAccount, expireAccessToken }
}

// ---------- Keycloak: the browser and the admin API ----------
type Jar = Map<string, string>
function absorb(jar: Jar, res: Response) {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(';')
    const [name, ...rest] = pair!.split('=')
    if (rest.join('=') === '' || /max-age=0/iu.test(raw)) jar.delete(name!)
    else jar.set(name!, pair!)
  }
}
const cookieHeader = (jar: Jar) => [...jar.values()].join('; ')

/** Log in at Keycloak like a browser; returns the redirect back to the app and the cookie jar. */
async function keycloakLogin(authorizeUrl: string, username: string) {
  const jar: Jar = new Map()
  let res = await realFetch(authorizeUrl, { redirect: 'manual' })
  absorb(jar, res)
  const html = await res.text()
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/u.exec(html)?.[1]
  if (!action) throw new Error(`no Keycloak login form (status ${res.status})`)
  res = await realFetch(action.replaceAll('&amp;', '&'), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) },
    body: new URLSearchParams({ username, password: `${username}-test-password` }),
  })
  absorb(jar, res)
  if (res.status !== 302) throw new Error(`Keycloak login failed: ${res.status}`)
  return { location: res.headers.get('location')!, jar }
}

async function keycloakAdmin() {
  const res = await realFetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'admin',
      password: 'admin',
    }),
  })
  const { access_token } = (await res.json()) as { access_token: string }
  const api = (path: string, init: RequestInit = {}) =>
    realFetch(`${KEYCLOAK}/admin/realms/${REALM}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${access_token}`, ...init.headers },
    })
  const userId = async (username: string) =>
    ((await (await api(`/users?username=${username}&exact=true`)).json()) as { id: string }[])[0]!
      .id
  return {
    userId,
    /** Ends every Keycloak session of the user; Keycloak then sends back-channel logout. */
    async logout(username: string) {
      const response = await api(`/users/${await userId(username)}/logout`, { method: 'POST' })
      expect(response.status).toBe(204)
    },
    async sessionIds(username: string) {
      const response = await api(`/users/${await userId(username)}/sessions`)
      return ((await response.json()) as { id: string }[]).map((session) => session.id)
    },
    async setEnabled(username: string, enabled: boolean) {
      const response = await api(`/users/${await userId(username)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      expect(response.status).toBe(204)
    },
  }
}

// ---------- Keycloak's back-channel POST, forwarded into the route handler ----------
interface Delivery {
  readonly form: string
  readonly status: number
}
const deliveries: Delivery[] = []
let backchannelTarget: ((form: string) => Promise<{ status: number }>) | null = null
let backchannelServer: Server

beforeAll(async () => {
  if (!KEYCLOAK) return
  backchannelServer = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const form = Buffer.concat(chunks).toString()
      void (async () => {
        const forwarded = request.url === `/api/auth${BACKCHANNEL_PATH}` && backchannelTarget
        const { status } = forwarded ? await backchannelTarget!(form) : { status: 404 }
        deliveries.push({ form, status })
        response.writeHead(status).end()
      })()
    })
  })
  // 0.0.0.0, not 127.0.0.1: on Linux the container reaches the host through the docker bridge.
  await new Promise<void>((resolve) =>
    backchannelServer.listen(BACKCHANNEL_PORT, '0.0.0.0', resolve),
  )
})
afterAll(async () => {
  if (backchannelServer) await new Promise((resolve) => backchannelServer.close(resolve))
})

async function until<T>(read: () => Promise<T | undefined | false> | T | undefined | false) {
  const deadline = Date.now() + 20_000
  for (;;) {
    const value = await read()
    if (value) return value
    if (Date.now() > deadline) throw new Error('timed out waiting for Keycloak')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

// ---------- a sign-in through the real IdP ----------
async function startSignIn(browser: Client) {
  const start = await browser.post('/sign-in/social', {
    provider: 'oidc',
    callbackURL: `${SITE}/app`,
    errorCallbackURL: `${SITE}/error`,
  })
  expect(start.status).toBe(200)
  return (start.body as { url: string }).url
}

/** Log in at Keycloak and return to the app's callback; `mutate` can change the returned query. */
async function signIn(
  browser: Client,
  username: string,
  mutate?: (query: URLSearchParams) => void,
) {
  const authorizeUrl = await startSignIn(browser)
  const { location, jar } = await keycloakLogin(authorizeUrl, username)
  const back = new URL(location)
  const issuer = back.searchParams.get('iss')
  mutate?.(back.searchParams)
  const callback = await browser.get(`/callback/oidc${back.search}`)
  return { authorizeUrl: new URL(authorizeUrl), issuer, callback, kcJar: jar }
}

function errorOf(location: string) {
  return location === '' ? null : new URL(location).searchParams.get('error')
}

/** Sign in as alice, mint a Convex token and return the identity it carries. */
async function signInAndMint(browser: Client) {
  const { callback } = await signIn(browser, 'alice')
  expect(callback.location).toBe(`${SITE}/app`)
  const { status, token } = await browser.mint()
  expect(status).toBe(200)
  const claims = decodeJwt(token!)
  return { subject: claims.sub!, sid: String(claims.sid), token_use: String(claims.token_use) }
}

describe.skipIf(!KEYCLOAK)('OIDC against a real Keycloak', () => {
  let refreshRequests = 0

  beforeEach(() => {
    vi.stubEnv('SITE_URL', SITE)
    vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
    vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
    deliveries.length = 0
    backchannelTarget = null
    refreshRequests = 0
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (
        url === `${ISSUER}/protocol/openid-connect/token` &&
        new URLSearchParams(String(init?.body)).get('grant_type') === 'refresh_token'
      ) {
        refreshRequests += 1
      }
      return realFetch(input as RequestInfo, init)
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  // Catches: a PKCE, nonce, state or issuer binding that the fake IdP accepts but Keycloak refuses,
  // and a callback whose `iss` is never compared.
  it('signs in alice through Keycloak with PKCE', async () => {
    const app = createApp()
    const browser = app.client()

    const { authorizeUrl, issuer, callback } = await signIn(browser, 'alice')

    const params = authorizeUrl.searchParams
    expect(`${authorizeUrl.origin}${authorizeUrl.pathname}`).toBe(
      `${ISSUER}/protocol/openid-connect/auth`,
    )
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('redirect_uri')).toBe(`${SITE}/api/auth/callback/oidc`)
    expect(params.get('scope')).toBe('openid email profile')
    expect(issuer).toBe(ISSUER)
    expect(callback.status).toBe(302)
    expect(callback.location).toBe(`${SITE}/app`)
    expect(await browser.hasSession()).toBe(true)
    const [user] = await app.rows('user')
    expect(user).toMatchObject({ email: 'alice@example.test', emailVerified: true })
    const account = await app.oidcAccount()
    expect(account.accountId).toMatch(/^[\w-]{16}:[\da-f-]{36}$/u)
    for (const field of ['accessToken', 'refreshToken', 'idToken']) {
      expect(String(account[field])).toMatch(/^\$ba\$/u)
    }

    // The same login with another `iss` in the callback: Better Auth compares it.
    const forged = await signIn(app.client(), 'alice', (query) =>
      query.set('iss', 'https://evil.example.test/realms/x'),
    )
    expect(errorOf(forged.callback.location)).toBe('issuer_mismatch')
  })

  // Catches: an unverified Keycloak address that still gets a user and a session.
  it('refuses bob (unverified)', async () => {
    const app = createApp()
    const browser = app.client()

    const { callback } = await signIn(browser, 'bob')

    expect(errorOf(callback.location)).toBe('AUTH_USER_CREATE_UNVERIFIED_EMAIL')
    expect(await browser.hasSession()).toBe(false)
    expect(await app.rows('user')).toEqual([])
  })

  // Catches: a Keycloak logout token that our verifier or handler refuses, so an admin logout
  // leaves the app session, the Convex token mint and the stored IdP tokens alive.
  it('Keycloak admin logout ends the app sessions through back-channel logout', async () => {
    const app = createApp()
    await app.provision()
    const browser = app.client()
    backchannelTarget = browser.backchannel
    await signInAndMint(browser)
    const keycloak = await keycloakAdmin()

    await keycloak.logout('alice')
    await until(() => deliveries.length > 0)

    const [delivery] = deliveries
    expect(delivery!.status).toBe(200)
    const logoutToken = new URLSearchParams(delivery!.form).get('logout_token')!
    const claims = decodeJwt(logoutToken)
    expect(claims.sub).toBe(await keycloak.userId('alice'))
    expect(Object.keys(claims.events as object)).toEqual([LOGOUT_EVENT])
    expect('nonce' in claims).toBe(false)
    expect(claims.iss).toBe(ISSUER)
    expect(claims.aud).toBe(CLIENT_ID)
    expect(typeof claims.jti).toBe('string')
    expect(typeof claims.sid).toBe('string')
    expect(decodeProtectedHeader(logoutToken)).toMatchObject({ alg: 'RS256', typ: 'logout+jwt' })
    // Mint first: reading the session clears the dead session cookie.
    expect((await browser.mint()).status).toBe(401)
    expect(await browser.hasSession()).toBe(false)
    expect(await app.oidcAccount()).toMatchObject({
      accessToken: null,
      refreshToken: null,
      idToken: null,
    })
  })

  // Catches: a sign-out that returns a URL Keycloak refuses, or that leaves the Keycloak session alive.
  it('sign-out follows the Keycloak end-session URL to the post-logout URI', async () => {
    // End sessions that earlier tests left at Keycloak; backchannelTarget is still null here, so
    // their back-channel calls reach no app. The counts below then belong to this test alone.
    const keycloak = await keycloakAdmin()
    await keycloak.logout('alice')
    const app = createApp()
    const browser = app.client()
    backchannelTarget = browser.backchannel
    const { kcJar } = await signIn(browser, 'alice')
    const before = await keycloak.sessionIds('alice')
    expect(before).toHaveLength(1)

    const out = await browser.post('/sign-out', {
      disableRedirect: true,
      callbackURL: `${SITE}/signed-out`,
    })

    expect(out.status).toBe(200)
    expect(await browser.hasSession()).toBe(false)
    const endSession = new URL((out.body as { url: string }).url)
    expect(`${endSession.origin}${endSession.pathname}`).toBe(
      `${ISSUER}/protocol/openid-connect/logout`,
    )
    expect(endSession.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(endSession.searchParams.get('post_logout_redirect_uri')).toBe(`${SITE}/signed-out`)
    const followed = await realFetch(endSession, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(kcJar) },
    })
    expect(followed.status).toBe(302)
    expect(followed.headers.get('location')).toMatch(/^https:\/\/app\.example\.test\/signed-out/u)
    expect(await keycloak.sessionIds('alice')).toEqual([])
  })

  // Catches: a refresh without the lease. Keycloak rotates the refresh token, so a second refresh
  // with the old one is invalid_grant and would end the user's sessions.
  it('getOidcAccessToken refreshes under refresh-token rotation for two concurrent actions', async () => {
    const app = createApp()
    await app.provision()
    const browser = app.client()
    const identity = await signInAndMint(browser)
    await app.expireAccessToken()

    const [first, second] = await Promise.all([
      app.test.withIdentity(identity).action((ctx) => app.auth.getOidcAccessToken(ctx)),
      app.test.withIdentity(identity).action((ctx) => app.auth.getOidcAccessToken(ctx)),
    ])

    expect(refreshRequests).toBe(1)
    expect(second).toEqual(first)
    expect(first.expiresAt).toBeGreaterThan(Date.now() + 60_000)
    const userinfo = await realFetch(`${ISSUER}/protocol/openid-connect/userinfo`, {
      headers: { authorization: `Bearer ${first.accessToken}` },
    })
    expect(userinfo.status).toBe(200)
    expect(await browser.hasSession()).toBe(true)
  })

  // Catches: a Keycloak user who is disabled but keeps a working app session, because the mint
  // never asks the IdP. Back-channel delivery is off here, so only the liveness check can end it.
  it('disabled user at Keycloak ends the app session at the next token mint', async () => {
    const app = createApp()
    await app.provision()
    const browser = app.client()
    await signInAndMint(browser)
    await app.expireAccessToken()
    const keycloak = await keycloakAdmin()

    await keycloak.setEnabled('alice', false)
    try {
      expect((await browser.mint()).status).toBe(401)
    } finally {
      await keycloak.setEnabled('alice', true)
    }

    expect(await browser.hasSession()).toBe(false)
    expect(await app.oidcAccount()).toMatchObject({ accessToken: null, refreshToken: null })
  })

  // Catches: a replay cache that Keycloak's real jti does not fit, so a captured logout token
  // could be sent again.
  it('logout tokens replayed from Keycloak are refused', async () => {
    const app = createApp()
    await app.provision()
    const browser = app.client()
    backchannelTarget = browser.backchannel
    await signInAndMint(browser)
    const keycloak = await keycloakAdmin()
    await keycloak.logout('alice')
    await until(() => deliveries.length > 0)
    expect(deliveries[0]!.status).toBe(200)

    const replay = await browser.backchannel(deliveries[0]!.form)

    expect(replay.status).toBe(400)
    expect(replay.body).toEqual({ error: 'invalid_request' })
  })
})
