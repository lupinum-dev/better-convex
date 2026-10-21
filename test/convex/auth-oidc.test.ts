/// <reference types="vite/client" />
import type { GithubProfile } from '@better-auth/core/social-providers'
import type { BetterAuthPlugin } from 'better-auth'
import type { JwtOptions } from 'better-auth/plugins'
import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema, httpRouter } from 'convex/server'
import { decodeJwt } from 'jose'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import type {
  BetterConvexAuthEmail,
  CreateBetterConvexAuthOptions,
} from '../../src/runtime/convex-auth/create-better-convex-auth'
import { rotateSigningKeyWithOfficialJwt } from '../../src/runtime/convex-auth/jwks-rotation'
import { getOidcClient } from '../../src/runtime/convex-auth/oidc-metadata'
import { resolveOidcConfig } from '../../src/runtime/convex-auth/oidc-options'
import {
  PUBLIC_ORIGIN_HEADER,
  PUBLIC_ORIGIN_SIGNATURE_HEADER,
  signPublicOrigin,
} from '../../src/runtime/shared/client-ip'
import { createFakeIdp, type FakeIdp } from '../helpers/fake-oidc-idp'

// Better Auth captures NODE_ENV at import and checks TEST when creating the request context.
// Production mode keeps the origin and CSRF checks on (F35), as in a deployment.
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
const SITE_B = 'https://site-b.example.test'
const PROXY_SECRET = 'oidc-site-origins-proxy-secret-32-bytes'
const EMAIL = 'ada@example.test'
const PASSWORD = 'ada-chosen-password-123'
const BACKCHANNEL_PATH = '/oidc/backchannel-logout'

type Options = Omit<CreateBetterConvexAuthOptions<never>, 'email' | 'oidc'>
type Client = ReturnType<ReturnType<ReturnType<typeof createEnvironment>['app']>['client']>

let ipCounter = 0
function freshIp() {
  ipCounter += 1
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`
}

function oidcOf(idp: FakeIdp) {
  return { issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret }
}

/** One Convex test deployment; `app` mounts an auth configuration on it. */
function createEnvironment() {
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent('sessionAuth', authSchema, authModules)
  const mails: BetterConvexAuthEmail[] = []

  function app(
    idp: FakeIdp | null,
    options: Options = {},
    extraPlugins: readonly BetterAuthPlugin[] = [],
  ) {
    const auth = createBetterConvexAuthOwned(
      components.sessionAuth,
      {
        email: async (_ctx: unknown, message: BetterConvexAuthEmail) => {
          mails.push(message)
        },
        ...(idp ? { oidc: oidcOf(idp) } : {}),
        ...options,
      } as never,
      extraPlugins,
    )
    const http = httpRouter()
    auth.registerRoutes(http)

    function client(clientOptions: { origin?: string; headers?: Record<string, string> } = {}) {
      let cookie = ''
      const origin = clientOptions.origin ?? SITE

      async function call(
        method: 'GET' | 'POST',
        path: string,
        init: {
          json?: Record<string, unknown>
          form?: string
          bare?: boolean
        } = {},
      ) {
        const ip = freshIp()
        const response = await test.action(async (ctx) => {
          const url = new URL(`https://deployment.convex.site/api/auth${path}`)
          const route = http.lookup(url.pathname, method)
          if (!route) throw new Error(`no route ${method} ${path}`)
          const handler = route[0] as unknown as {
            _handler: (ctx: unknown, request: Request) => Promise<Response>
          }
          const headers: Record<string, string> = init.bare
            ? {}
            : { Origin: origin, cookie, ...clientOptions.headers }
          if (init.form !== undefined) {
            headers['content-type'] = 'application/x-www-form-urlencoded'
          } else if (method === 'POST') headers['content-type'] = 'application/json'
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
          let parsed: unknown = text
          try {
            parsed = JSON.parse(text)
          } catch {
            // not JSON: keep the text
          }
          return {
            status: res.status,
            body: parsed as Record<string, unknown> | string,
            cookies: res.headers.getSetCookie(),
            location: res.headers.get('location') ?? '',
            cacheControl: res.headers.get('cache-control'),
          }
        })
        if (!init.bare) {
          for (const raw of response.cookies) {
            const [pair] = raw.split(';')
            const [name, ...rest] = pair!.split('=')
            const value = rest.join('=')
            const jar = new Map(
              cookie
                .split('; ')
                .filter(Boolean)
                .map((part) => [part.split('=')[0]!, part] as const),
            )
            if (value === '' || /max-age=0/iu.test(raw)) jar.delete(name!)
            else jar.set(name!, pair!)
            cookie = [...jar.values()].join('; ')
          }
        }
        return response
      }

      return {
        post: (path: string, json: Record<string, unknown> = {}) => call('POST', path, { json }),
        get: (path: string) => call('GET', path),
        /** The IdP's call: a form body, no Origin and no cookies. */
        backchannel: (form: string) => call('POST', BACKCHANNEL_PATH, { form, bare: true }),
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

    return { auth, client, provision }
  }

  const rows = (model: 'user' | 'account' | 'session') =>
    test
      .query(components.sessionAuth.adapter.findMany, {
        model,
        paginationOpts: { cursor: null, numItems: 50 },
      })
      .then((result) => result.page as Record<string, unknown>[])
  const oidcAccounts = async () =>
    (await rows('account')).filter((account) => account.providerId === 'oidc')

  return { test, app, mails, rows, oidcAccounts }
}

interface Authorization {
  readonly url: URL
  readonly state: string
}

/** Start an IdP sign-in (or link) and return the authorization request. */
async function startAt(
  client: Client,
  path: '/sign-in/social' | '/link-social',
  callbackURL = `${SITE}/app`,
): Promise<Authorization> {
  const start = await client.post(path, {
    provider: 'oidc',
    callbackURL,
    errorCallbackURL: `${new URL(callbackURL).origin}/error`,
  })
  expect(start.status).toBe(200)
  const url = new URL((start.body as { url: string }).url)
  return { url, state: url.searchParams.get('state')! }
}

/** The IdP's answer to an authorization request: a code for these claims, then our callback. */
async function finish(
  client: Client,
  idp: FakeIdp,
  authorization: Authorization,
  claims: Record<string, unknown> = {},
  query = '',
) {
  const params = authorization.url.searchParams
  const code = idp.issueCode({
    nonce: params.get('nonce')!,
    codeChallenge: params.get('code_challenge')!,
    redirectURI: params.get('redirect_uri')!,
    claims,
  })
  return await client.get(`/callback/oidc?code=${code}&state=${authorization.state}${query}`)
}

async function signIn(client: Client, idp: FakeIdp, claims: Record<string, unknown> = {}) {
  return await finish(client, idp, await startAt(client, '/sign-in/social'), claims)
}

/** The Convex identity that a minted session token carries. */
function identityOf(token: string) {
  const claims = decodeJwt(token)
  return { subject: claims.sub!, sid: String(claims.sid), token_use: String(claims.token_use) }
}

function errorOf(location: string): string | null {
  return location === '' ? null : new URL(location).searchParams.get('error')
}

function useAuthEnvironment() {
  beforeEach(() => {
    vi.stubEnv('SITE_URL', SITE)
    vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
    vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
    vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', PROXY_SECRET)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })
}

/** A fake IdP, installed at `fetch` for this test. */
async function installIdp(options?: Parameters<typeof createFakeIdp>[0]) {
  const idp = await createFakeIdp(options)
  idp.install()
  return idp
}

describe('OIDC sign-in with real Better Auth', () => {
  useAuthEnvironment()

  it('signs in a verified user and stores encrypted tokens', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const browser = env.app(idp).client()

    const authorization = await startAt(browser, '/sign-in/social')
    const callback = await finish(browser, idp, authorization)

    expect(callback.status).toBe(302)
    expect(callback.location).toBe(`${SITE}/app`)
    expect(await browser.hasSession()).toBe(true)
    const accountKey = await getOidcClient(resolveOidcConfig(oidcOf(idp))).accountKey('user-1')
    const [account] = await env.oidcAccounts()
    expect(account).toMatchObject({ accountId: accountKey })
    expect(accountKey).toMatch(/^[\w-]{16}:user-1$/u)
    for (const field of ['accessToken', 'refreshToken', 'idToken']) {
      expect(String(account![field])).toMatch(/^\$ba\$/u)
    }
    expect(await env.rows('user')).toMatchObject([{ email: EMAIL, emailVerified: true }])
  })

  // Catches: an IdP account without a verified address that still gets a user and a session.
  it('refuses an unverified email and creates no user', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const browser = env.app(idp).client()

    const callback = await signIn(browser, idp, { email_verified: false })

    expect(callback.location).toBe(
      `${SITE}/error?error=AUTH_USER_CREATE_UNVERIFIED_EMAIL&error_description=AUTH_USER_CREATE_UNVERIFIED_EMAIL`,
    )
    expect(await browser.hasSession()).toBe(false)
    expect(await env.rows('user')).toEqual([])
  })

  // Catches: implicit linking that hands an existing verified local user to whoever holds the IdP address.
  it('refuses an existing local user with the same email until linked, then signs in after linkSocial', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp, { emailAndPassword: { requireEmailVerification: false } })
    const owner = app.client()
    expect(
      (await owner.post('/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Ada' }))
        .status,
    ).toBe(200)
    // A verified local user: Better Auth refuses to link an unverified one on its own.
    await env.test.mutation(components.sessionAuth.adapter.updateOne, {
      model: 'user',
      where: [{ field: 'email', value: EMAIL }],
      update: { emailVerified: true },
    })
    expect(await env.rows('user')).toMatchObject([{ email: EMAIL, emailVerified: true }])

    const stranger = app.client()
    const refused = await signIn(stranger, idp)
    expect(errorOf(refused.location)).toBe('account_not_linked')
    expect(await stranger.hasSession()).toBe(false)

    expect((await owner.post('/sign-in/email', { email: EMAIL, password: PASSWORD })).status).toBe(
      200,
    )
    const linked = await finish(
      owner,
      idp,
      await startAt(owner, '/link-social', `${SITE}/settings`),
    )
    expect(linked.location).toBe(`${SITE}/settings`)
    expect(await env.oidcAccounts()).toHaveLength(1)

    const later = app.client()
    const signedIn = await signIn(later, idp)
    expect(signedIn.location).toBe(`${SITE}/app`)
    expect(await later.hasSession()).toBe(true)
  })

  // Catches: a client-supplied ID token (no nonce binding) accepted as proof of identity (F7).
  it('refuses client-submitted id_token sign-in', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const browser = env.app(idp).client()

    const response = await browser.post('/sign-in/social', {
      provider: 'oidc',
      idToken: { token: await idp.signIdToken() },
    })

    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ code: 'ID_TOKEN_NOT_SUPPORTED' })
    expect(await browser.hasSession()).toBe(false)
    expect(await env.rows('user')).toEqual([])
  })

  // Catches: a client-supplied ID token that links another IdP identity to a signed-in user.
  it('refuses a client-submitted id_token at link-social', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp, { emailAndPassword: { requireEmailVerification: false } })
    const browser = app.client()
    await browser.post('/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Ada' })
    await browser.post('/sign-in/email', { email: EMAIL, password: PASSWORD })

    const response = await browser.post('/link-social', {
      provider: 'oidc',
      idToken: { token: await idp.signIdToken() },
    })

    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ code: 'ID_TOKEN_NOT_SUPPORTED' })
    expect(await env.oidcAccounts()).toEqual([])
  })

  // Catches: a provider without `issuer`, so an authorization response from another server passes (F4).
  it('refuses a callback with another iss', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const browser = env.app(idp).client()

    const callback = await finish(
      browser,
      idp,
      await startAt(browser, '/sign-in/social'),
      {},
      `&iss=${encodeURIComponent('https://other-idp.example.test/realms/acme')}`,
    )

    expect(errorOf(callback.location)).toBe('issuer_mismatch')
    expect(await browser.hasSession()).toBe(false)
  })

  // Catches: a provider without requiresIdTokenNonce, so a state without a nonce reaches the token exchange.
  it('refuses a state created for another provider', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const browser = env
      .app(idp, { socialProviders: { github: { clientId: 'id', clientSecret: 'secret' } } })
      .client()
    const start = await browser.post('/sign-in/social', {
      provider: 'github',
      callbackURL: `${SITE}/app`,
      errorCallbackURL: `${SITE}/error`,
    })
    const state = new URL((start.body as { url: string }).url).searchParams.get('state')

    const callback = await browser.get(`/callback/oidc?code=stolen&state=${state}`)

    expect(errorOf(callback.location)).toBe('nonce_binding_missing')
    expect(await browser.hasSession()).toBe(false)
    expect(idp.requests.filter((request) => request.url.endsWith('/token'))).toEqual([])
  })

  // Catches: overrideUserInfo, which lets the IdP rebind a signed-in user to another address.
  it('keeps the stored email when the IdP email changes', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await signIn(app.client(), idp)

    const again = app.client()
    const callback = await signIn(again, idp, { email: 'ada.new@example.test', name: 'Ada New' })

    expect(callback.location).toBe(`${SITE}/app`)
    expect(await env.rows('user')).toMatchObject([{ email: EMAIL, name: 'Ada Lovelace' }])
  })

  // Catches: ID-token claims that reach additional user fields (F34), for example a role.
  it('keeps ID-token claims out of additional user fields', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const roleField: BetterAuthPlugin = {
      id: 'test-role-field',
      schema: { user: { fields: { role: { type: 'string', required: false, input: true } } } },
    }
    const browser = env.app(idp, {}, [roleField]).client()

    const callback = await signIn(browser, idp, { role: 'admin' })

    expect(callback.location).toBe(`${SITE}/app`)
    const [user] = await env.rows('user')
    expect(user).toMatchObject({ email: EMAIL })
    expect(user).not.toHaveProperty('role')
  })

  // Catches: an account key without the issuer, so another IdP's `sub` takes over the account.
  it('a sub from another issuer does not sign in the old account', async () => {
    const idpA = await installIdp()
    const idpB = await installIdp()
    const env = createEnvironment()
    expect((await signIn(env.app(idpA).client(), idpA)).location).toBe(`${SITE}/app`)

    const browser = env.app(idpB).client()
    const callback = await signIn(browser, idpB)

    expect(errorOf(callback.location)).toBe('account_not_linked')
    expect(await browser.hasSession()).toBe(false)
    expect(await env.oidcAccounts()).toHaveLength(1)
  })

  // Catches: eager discovery at construction, which always fails in a mutation (F28).
  it('builds Better Auth inside a mutation without fetching', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    const browser = app.client()
    await signIn(browser, idp)
    const { token } = await browser.mint()
    const before = idp.requests.length

    const constructed = await env.test.withIdentity(identityOf(token!)).mutation(async (ctx) => {
      const { auth, headers } = await app.auth.getAuth(ctx)
      return typeof auth.api.getSession === 'function' && headers.has('authorization')
    })

    expect(constructed).toBe(true)
    expect(idp.requests.length).toBe(before)
  })

  // Catches: a new client (and discovery fetch) per auth construction.
  it('resolves discovery once across sign-ins', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)

    await signIn(app.client(), idp)
    await signIn(app.client(), idp, { sub: 'user-2', email: 'grace@example.test' })

    const discovery = idp.requests.filter((request) =>
      request.url.endsWith('/.well-known/openid-configuration'),
    )
    expect(discovery).toHaveLength(1)
    expect(await env.oidcAccounts()).toHaveLength(2)
  })

  // Catches: an IdP outage answered with a 500, or a cached failure that never retries.
  it('sign-in answers 503 OIDC_UNAVAILABLE while discovery fails and works after the backoff', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const browser = env.app(idp).client()
    idp.respond.discovery = () => new Response('down', { status: 500 })
    vi.useFakeTimers({ toFake: ['Date'] })

    const down = await browser.post('/sign-in/social', { provider: 'oidc', callbackURL: SITE })
    const again = await browser.post('/sign-in/social', { provider: 'oidc', callbackURL: SITE })

    expect(down.status).toBe(503)
    expect(down.body).toMatchObject({ code: 'OIDC_UNAVAILABLE', message: 'OIDC_UNAVAILABLE' })
    expect(again.status).toBe(503)
    expect(idp.requests).toHaveLength(1)

    delete idp.respond.discovery
    vi.setSystemTime(Date.now() + 10_001)
    expect((await signIn(browser, idp)).location).toBe(`${SITE}/app`)
  })

  // Catches: another plugin that adds or shadows the `oidc` provider without nonce or issuer checks.
  it('rejects a second provider named oidc from another plugin', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const foreign: BetterAuthPlugin = {
      id: 'test-foreign-oidc',
      init: (ctx) => ({
        context: {
          socialProviders: [
            {
              id: 'oidc',
              name: 'Foreign',
              createAuthorizationURL: async () => new URL('https://attacker.example.test/auth'),
              validateAuthorizationCode: async () => null,
              getUserInfo: async () => null,
            },
            ...ctx.socialProviders,
          ],
        },
      }),
    }
    const browser = env.app(idp, {}, [foreign]).client()

    const response = await browser.post('/sign-in/social', { provider: 'oidc', callbackURL: SITE })

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ code: 'AUTH_CONFIG_INVALID' })
  })

  // Catches: a sign-out that leaves the IdP session alive or names the wrong client.
  it('sign-out returns the IdP end-session URL', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const browser = env.app(idp).client()
    await signIn(browser, idp)

    const response = await browser.post('/sign-out', {
      disableRedirect: true,
      callbackURL: `${SITE}/signed-out`,
    })

    expect(response.status).toBe(200)
    expect(response.location).toBe('')
    const url = new URL((response.body as { url: string }).url)
    expect(`${url.origin}${url.pathname}`).toBe(`${idp.issuer}/protocol/openid-connect/logout`)
    expect([...url.searchParams.keys()]).toEqual([
      'client_id',
      'id_token_hint',
      'post_logout_redirect_uri',
    ])
    expect(url.searchParams.get('client_id')).toBe('better-convex')
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(`${SITE}/signed-out`)
    expect(decodeJwt(url.searchParams.get('id_token_hint')!)).toMatchObject({
      iss: idp.issuer,
      sub: 'user-1',
    })
    expect(await browser.hasSession()).toBe(false)
  })

  // Catches: a redirect_uri or post-logout URI fixed to SITE_URL, which breaks every other site.
  it('uses each site origin for redirect_uri and post_logout_redirect_uri', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const browser = env.app(idp, { siteOrigins: [SITE_B] }).client({
      origin: SITE_B,
      headers: {
        [PUBLIC_ORIGIN_HEADER]: SITE_B,
        [PUBLIC_ORIGIN_SIGNATURE_HEADER]: await signPublicOrigin(SITE_B, PROXY_SECRET),
      },
    })

    const authorization = await startAt(browser, '/sign-in/social', `${SITE_B}/app`)
    const callback = await finish(browser, idp, authorization)
    const signOut = await browser.post('/sign-out', {
      disableRedirect: true,
      callbackURL: `${SITE_B}/signed-out`,
    })

    const redirectURI = `${SITE_B}/api/auth/callback/oidc`
    expect(authorization.url.searchParams.get('redirect_uri')).toBe(redirectURI)
    const tokenRequest = idp.requests.find((request) => request.url.endsWith('/token'))
    expect(tokenRequest?.body?.get('redirect_uri')).toBe(redirectURI)
    expect(callback.location).toBe(`${SITE_B}/app`)
    const logout = new URL((signOut.body as { url: string }).url)
    expect(logout.searchParams.get('post_logout_redirect_uri')).toBe(`${SITE_B}/signed-out`)
  })
})

describe('OIDC doors and linking with real Better Auth', () => {
  useAuthEnvironment()

  /** A password user who then links the IdP. */
  async function linkedPasswordUser(idp: FakeIdp, options: Options = {}) {
    const env = createEnvironment()
    const app = env.app(idp, {
      emailAndPassword: { requireEmailVerification: false },
      ...options,
    })
    const owner = app.client()
    await owner.post('/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Ada' })
    await owner.post('/sign-in/email', { email: EMAIL, password: PASSWORD })
    await finish(owner, idp, await startAt(owner, '/link-social', `${SITE}/settings`))
    expect(await env.oidcAccounts()).toHaveLength(1)
    return { env, app }
  }

  // Catches: a disabled employee who keeps access through the password door.
  it('a linked user cannot sign in with a password', async () => {
    const idp = await installIdp()
    const { app } = await linkedPasswordUser(idp)
    const browser = app.client()

    const response = await browser.post('/sign-in/email', { email: EMAIL, password: PASSWORD })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      code: 'OIDC_SIGN_IN_REQUIRED',
      message: 'OIDC_SIGN_IN_REQUIRED',
    })
    expect(await browser.hasSession()).toBe(false)
  })

  // Catches: a disabled employee, or a recycled address, that gets in through an email code.
  it('a linked user cannot sign in with an email code', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp, { emailOTP: {} })
    await signIn(app.client(), idp)
    const browser = app.client()

    await browser.post('/email-otp/send-verification-otp', { email: EMAIL, type: 'sign-in' })
    const mail = env.mails.find((message) => message.type === 'email-otp') as
      | { otp: string }
      | undefined
    const response = await browser.post('/sign-in/email-otp', { email: EMAIL, otp: mail!.otp })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      code: 'OIDC_SIGN_IN_REQUIRED',
      message: 'OIDC_SIGN_IN_REQUIRED',
    })
    expect(await browser.hasSession()).toBe(false)
  })

  // Catches: an unverified password user who linked the IdP and then signs in by email code.
  // Better Auth's unverified-user cleanup deletes every account first, the `oidc` row included,
  // so the user would leave the door guard, back-channel logout and the liveness check.
  it('an email code does not remove the identity-provider account of an unverified user', async () => {
    const idp = await installIdp()
    const { env, app } = await linkedPasswordUser(idp, { emailOTP: {} })
    const browser = app.client()

    await browser.post('/email-otp/send-verification-otp', { email: EMAIL, type: 'sign-in' })
    const mail = env.mails.find((message) => message.type === 'email-otp') as
      | { otp: string }
      | undefined
    const response = await browser.post('/sign-in/email-otp', { email: EMAIL, otp: mail!.otp })

    expect(response.status).toBe(403)
    expect(await env.oidcAccounts()).toHaveLength(1)
    expect(await browser.hasSession()).toBe(false)
  })

  // Catches: a callback check that tests only the path, so a user disabled at the IdP gets a session
  // through /callback/github.
  it('a linked user cannot sign in with another social provider', async () => {
    const idp = await installIdp()
    const previous = globalThis.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
      new Request(input, init).url === 'https://github.com/login/oauth/access_token'
        ? Response.json({ access_token: 'github-access-token', token_type: 'bearer' })
        : previous(input, init),
    )
    const env = createEnvironment()
    const app = env.app(idp, {
      socialProviders: {
        github: {
          clientId: 'github-id',
          clientSecret: 'github-secret',
          // The account id comes from `data`; Better Auth 1.7.7 forbids `id` on the mapped user.
          getUserInfo: async () => ({
            user: { name: 'Ada', email: EMAIL, emailVerified: true },
            // Only `id` is read (the account key); the rest of the GitHub profile is not used.
            data: { id: '4242' } as GithubProfile,
          }),
        },
      },
    })
    const githubCallback = async (client: Client, path: '/sign-in/social' | '/link-social') => {
      const start = await client.post(path, {
        provider: 'github',
        callbackURL: `${SITE}/app`,
        errorCallbackURL: `${SITE}/error`,
      })
      const state = new URL((start.body as { url: string }).url).searchParams.get('state')
      return await client.get(`/callback/github?code=github-code&state=${state}`)
    }
    const owner = app.client()
    await signIn(owner, idp)
    expect((await githubCallback(owner, '/link-social')).location).toBe(`${SITE}/app`)
    expect((await env.rows('account')).map((account) => account.providerId).sort()).toEqual([
      'github',
      'oidc',
    ])

    const browser = app.client()
    const callback = await githubCallback(browser, '/sign-in/social')

    expect(errorOf(callback.location)).toBe('OIDC_SIGN_IN_REQUIRED')
    expect(await browser.hasSession()).toBe(false)
  })

  // Catches: a linked user who unlinks the `oidc` row and so leaves the door guard, back-channel
  // logout and the mint liveness check, then signs in with the password again.
  it('a linked user cannot unlink the identity-provider account', async () => {
    const idp = await installIdp()
    const { env, app } = await linkedPasswordUser(idp)
    const browser = app.client()
    await signIn(browser, idp)
    const [account] = await env.oidcAccounts()

    const response = await browser.post('/unlink-account', { accountId: account!.id })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      code: 'OIDC_UNLINK_REFUSED',
      message: 'OIDC_UNLINK_REFUSED',
    })
    expect(await env.oidcAccounts()).toHaveLength(1)
    const password = await app.client().post('/sign-in/email', { email: EMAIL, password: PASSWORD })
    expect(password.status).toBe(403)
    expect(password.body).toMatchObject({ code: 'OIDC_SIGN_IN_REQUIRED' })
  })

  // Catches: a door guard that closes the password door for every user.
  it('an unlinked password user still signs in with a password', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp, { emailAndPassword: { requireEmailVerification: false } })
    const browser = app.client()
    await browser.post('/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Ada' })

    const response = await browser.post('/sign-in/email', { email: EMAIL, password: PASSWORD })

    expect(response.status).toBe(200)
    expect(await browser.hasSession()).toBe(true)
  })

  // Catches: a second `oidc` account, after which the helper could hand out another subject's token.
  it('refuses linking a second identity-provider account', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const browser = env.app(idp).client()
    await signIn(browser, idp)

    const response = await finish(
      browser,
      idp,
      await startAt(browser, '/link-social', `${SITE}/settings`),
      { sub: 'user-2' },
    )

    // Better Auth does not turn a hook error in the link flow into a redirect.
    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ code: 'OIDC_ACCOUNT_CONFLICT' })
    expect(response.location).toBe('')
    const accounts = await env.oidcAccounts()
    expect(accounts).toHaveLength(1)
    expect(String(accounts[0]!.accountId)).toMatch(/:user-1$/u)
  })
})

describe('OIDC back-channel logout with real Better Auth', () => {
  useAuthEnvironment()

  async function logoutForm(idp: FakeIdp, claims: Record<string, unknown> = {}) {
    return `logout_token=${await idp.signLogoutToken(claims)}`
  }

  // Catches: a valid logout that leaves sessions or Convex token mint alive.
  it('ends every session and blocks token mint', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await app.provision()
    const laptop = app.client()
    const phone = app.client()
    await signIn(laptop, idp)
    await signIn(phone, idp)
    const { token } = await laptop.mint()
    expect((await phone.mint()).status).toBe(200)
    const identity = identityOf(token!)
    expect(
      await env.test.withIdentity(identity).query((ctx) => app.auth.getUser(ctx)),
    ).toMatchObject({ email: EMAIL })

    const response = await app.client().backchannel(await logoutForm(idp))

    expect(response.status).toBe(200)
    expect(await env.test.withIdentity(identity).query((ctx) => app.auth.getUser(ctx))).toBeNull()
    expect((await laptop.mint()).status).toBe(401)
    expect((await phone.mint()).status).toBe(401)
    expect(await laptop.hasSession()).toBe(false)
    expect(await phone.hasSession()).toBe(false)
  })

  // Catches: IdP tokens that survive a logout, so the helper keeps handing out a dead grant's access token.
  it('clears the stored IdP tokens', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await signIn(app.client(), idp)

    expect((await app.client().backchannel(await logoutForm(idp))).status).toBe(200)

    expect(await env.oidcAccounts()).toMatchObject([
      {
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      },
    ])
  })

  // Catches: the origin check, CSRF or a cookie requirement blocking the IdP's server-to-server call (F13, F14).
  it('reaches the route without Origin or cookies', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    const browser = app.client()
    await signIn(browser, idp)

    const response = await app.client().backchannel(await logoutForm(idp))

    expect(response.status).toBe(200)
    expect(response.body).toBe('')
    expect(response.cacheControl).toBe('no-store')
    expect(await browser.hasSession()).toBe(false)
  })

  // Catches: a replay cache that lives only in one auth construction or isolate.
  it('rejects a replayed logout token across requests', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp)
    await signIn(app.client(), idp)
    const form = await logoutForm(idp)
    expect((await app.client().backchannel(form)).status).toBe(200)
    const browser = app.client()
    await signIn(browser, idp)

    const replay = await app.client().backchannel(form)

    expect(replay.status).toBe(400)
    expect(replay.body).toEqual({ error: 'invalid_request' })
    expect(await browser.hasSession()).toBe(true)
  })

  // Catches: a subject lookup that ignores the provider, so a github account id ends someone else's sessions.
  it('does not end sessions of a user whose github account has the same id', async () => {
    const idp = await installIdp()
    const env = createEnvironment()
    const app = env.app(idp, { emailAndPassword: { requireEmailVerification: false } })
    const other = app.client()
    await other.post('/sign-up/email', {
      email: 'grace@example.test',
      password: PASSWORD,
      name: 'G',
    })
    await other.post('/sign-in/email', { email: 'grace@example.test', password: PASSWORD })
    const [grace] = await env.rows('user')
    const now = Date.now()
    await env.test.mutation(components.sessionAuth.adapter.create, {
      model: 'account',
      data: {
        id: crypto.randomUUID(),
        accountId: await getOidcClient(resolveOidcConfig(oidcOf(idp))).accountKey('user-1'),
        providerId: 'github',
        userId: String(grace!.id),
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: null,
        password: null,
        createdAt: now,
        updatedAt: now,
      },
    })

    const response = await app.client().backchannel(await logoutForm(idp))

    expect(response.status).toBe(200)
    expect(await other.hasSession()).toBe(true)
  })
})
