// Sign-in, back-channel logout and sign-out through a real Keycloak, the built Nuxt auth proxy and
// the real local Convex backend. Needs the container from test/fixtures/keycloak/docker-compose.yml
// and BCN_TEST_KEYCLOAK_URL; skips without it. The suite adds its own Keycloak client and user
// (both removed afterwards), because the realm's client registers only the convex-test origin.
import { randomBytes } from 'node:crypto'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { request, type APIRequestContext } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startLocalConvexBackend, type LocalConvexBackend } from '../helpers/local-convex'
import {
  availablePort,
  cleanEnvironment,
  convexCli,
  linkDependencies,
  root,
  runCommand,
  startNuxtServer,
  waitUntil,
} from './harness'

const KEYCLOAK = process.env.BCN_TEST_KEYCLOAK_URL
const REALM = 'better-convex-test'
const ISSUER = `${KEYCLOAK}/realms/${REALM}`
const BACKCHANNEL_PATH = '/api/auth/oidc/backchannel-logout'

// ---------- Keycloak: admin API and a browser login ----------
async function admin(path: string, init: RequestInit = {}) {
  // A fresh token per call: the master realm's admin token lives 60 s, less than the setup.
  const token = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'admin',
      password: 'admin',
    }),
  })
  const { access_token } = (await token.json()) as { access_token: string }
  return fetch(`${KEYCLOAK}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${access_token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
}

/** POSTs a representation and returns the id from the `Location` header. */
async function create(path: string, body: Record<string, unknown>) {
  const response = await admin(path, { method: 'POST', body: JSON.stringify(body) })
  expect(response.status).toBe(201)
  return response.headers.get('location')!.split('/').pop()!
}

type Jar = Map<string, string>
function absorb(jar: Jar, response: Response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';')
    const [name, ...rest] = pair!.split('=')
    if (rest.join('=') === '' || /max-age=0/iu.test(raw)) jar.delete(name!)
    else jar.set(name!, pair!)
  }
}
const cookieHeader = (jar: Jar) => [...jar.values()].join('; ')

/** Log in at Keycloak like a browser; returns the redirect back to the app and Keycloak's cookies. */
async function keycloakLogin(authorizeUrl: string, username: string, password: string) {
  const jar: Jar = new Map()
  let response = await fetch(authorizeUrl, { redirect: 'manual' })
  absorb(jar, response)
  const html = await response.text()
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/u.exec(html)?.[1]
  if (!action) throw new Error(`no Keycloak login form (status ${response.status})`)
  response = await fetch(action.replaceAll('&amp;', '&'), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) },
    body: new URLSearchParams({ username, password }),
  })
  absorb(jar, response)
  if (response.status !== 302) throw new Error(`Keycloak login failed: ${response.status}`)
  return { location: new URL(response.headers.get('location')!), jar }
}

describe.skipIf(!KEYCLOAK)('OIDC through the Nuxt auth proxy and the local backend', () => {
  let tempRoot: string
  let backend: LocalConvexBackend | undefined
  let nuxt: Awaited<ReturnType<typeof startNuxtServer>> | undefined
  let site: APIRequestContext | undefined
  let relay: Server | undefined
  let origin: string
  let clientUuid: string | undefined
  let userUuid: string | undefined
  const suffix = randomBytes(6).toString('hex')
  const clientId = `better-convex-proxy-${suffix}`
  const clientSecret = randomBytes(24).toString('base64url')
  const username = `proxy-${suffix}`
  const email = `${username}@example.test`
  const password = `${randomBytes(18).toString('base64url')}!aA1`
  const proxySecret = randomBytes(32).toString('base64url')
  const authSecrets = `1:${randomBytes(32).toString('base64url')}`
  const secrets = [clientSecret, password, proxySecret, authSecrets]
  /** Keycloak's back-channel POSTs and the proxy's answers. */
  const deliveries: { form: string; status: number }[] = []

  beforeAll(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'bcn-oidc-keycloak-'))
    const ports = new Set<number>()
    for (let index = 0; index < 3; index += 1) ports.add(await availablePort(ports))
    const [cloudPort, sitePort, nuxtPort] = [...ports] as [number, number, number]
    origin = `http://localhost:${nuxtPort}`

    // Keycloak runs in a container. On Linux it reaches the host only through the docker bridge,
    // so this relay listens on every interface and passes the one back-channel route to Nuxt
    // unchanged: no added headers, so the proxy sees a call without Origin or cookies.
    relay = createServer((incoming, outgoing) => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
      incoming.on('end', () => {
        void (async () => {
          const form = Buffer.concat(chunks).toString()
          if (incoming.method !== 'POST' || incoming.url !== BACKCHANNEL_PATH) {
            outgoing.writeHead(404).end()
            return
          }
          const response = await fetch(`${origin}${BACKCHANNEL_PATH}`, {
            method: 'POST',
            headers: { 'content-type': String(incoming.headers['content-type']) },
            body: form,
            redirect: 'manual',
          })
          await response.body?.cancel()
          deliveries.push({ form, status: response.status })
          outgoing.writeHead(response.status).end()
        })()
      })
    })
    await new Promise<void>((ready) => relay!.listen(0, '0.0.0.0', ready))
    const relayPort = (relay.address() as AddressInfo).port

    clientUuid = await create('/clients', {
      clientId,
      secret: clientSecret,
      protocol: 'openid-connect',
      publicClient: false,
      clientAuthenticatorType: 'client-secret',
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      frontchannelLogout: false,
      redirectUris: [`${origin}/api/auth/callback/oidc`],
      attributes: {
        'pkce.code.challenge.method': 'S256',
        'post.logout.redirect.uris': `${origin}/signed-out`,
        'backchannel.logout.url': `http://host.docker.internal:${relayPort}${BACKCHANNEL_PATH}`,
        'backchannel.logout.session.required': 'true',
        'use.refresh.tokens': 'true',
      },
      defaultClientScopes: ['web-origins', 'acr', 'profile', 'roles', 'basic', 'email'],
    })
    userUuid = await create('/users', {
      username,
      email,
      emailVerified: true,
      firstName: 'Proxy',
      lastName: 'User',
      enabled: true,
      credentials: [{ type: 'password', value: password, temporary: false }],
    })

    const app = join(tempRoot, 'app')
    await cp(join(root, 'test/fixtures/oidc-keycloak'), app, { recursive: true })
    await linkDependencies(app)
    backend = await startLocalConvexBackend({
      cwd: app,
      timeoutMs: 120_000,
      ports: { cloud: cloudPort, site: sitePort },
      devArguments: ['--tail-logs', 'disable', '--typecheck', 'disable'],
      secrets,
    })
    for (const [name, value] of [
      ['SITE_URL', origin],
      ['BETTER_AUTH_SECRETS', authSecrets],
      ['BCN_AUTH_PROXY_IP_SECRET', proxySecret],
      ['OIDC_ISSUER', ISSUER],
      ['OIDC_CLIENT_ID', clientId],
      ['OIDC_CLIENT_SECRET', clientSecret],
    ] as const) {
      await backend.setEnv(name, value, 6)
    }
    await backend.waitForFunctions()
    await runCommand(
      process.execPath,
      ['--', convexCli, 'run', 'auth:rotateSigningKey', '{}', '--env-file', '.env.local'],
      { cwd: app, env: cleanEnvironment(), secrets },
    )
    nuxt = await startNuxtServer(
      app,
      origin,
      {
        ...cleanEnvironment(),
        BCN_AUTH_PROXY_IP_SECRET: proxySecret,
        NUXT_PUBLIC_CONVEX_URL: backend.url,
        NUXT_PUBLIC_CONVEX_SITE_URL: backend.siteUrl,
      },
      secrets,
    )
    site = await request.newContext({ baseURL: origin, extraHTTPHeaders: { origin } })
  })

  afterAll(async () => {
    await site?.dispose()
    await nuxt?.release()
    await backend?.release()
    if (relay) await new Promise((closed) => relay!.close(closed))
    if (KEYCLOAK && userUuid) await admin(`/users/${userUuid}`, { method: 'DELETE' })
    if (KEYCLOAK && clientUuid) await admin(`/clients/${clientUuid}`, { method: 'DELETE' })
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  const sessionEmail = async () => {
    const response = await site!.get('/api/auth/get-session')
    expect(response.status()).toBe(200)
    return ((await response.json()) as { user?: { email?: string } } | null)?.user?.email ?? null
  }
  const mintStatus = async () => (await site!.get('/api/auth/convex/token')).status()
  const keycloakSessions = async () =>
    ((await (await admin(`/users/${userUuid}/sessions`)).json()) as unknown[]).length

  /** Start at the proxy, log in at Keycloak, return to the proxy's callback. */
  async function signIn() {
    const start = await site!.post('/api/auth/sign-in/social', {
      data: { provider: 'oidc', callbackURL: `${origin}/app`, errorCallbackURL: `${origin}/error` },
    })
    expect(start.status()).toBe(200)
    const authorizeUrl = ((await start.json()) as { url: string }).url
    const { location, jar } = await keycloakLogin(authorizeUrl, username, password)
    expect(`${location.origin}${location.pathname}`).toBe(`${origin}/api/auth/callback/oidc`)
    const callback = await site!.get(`${location.pathname}${location.search}`, { maxRedirects: 0 })
    return { authorizeUrl: new URL(authorizeUrl), callback, keycloakJar: jar }
  }

  // Catches: a redirect_uri built from the Convex site URL instead of the public origin, a proxy
  // that drops the state cookie or the callback's Set-Cookie, and IdP calls (redirect: 'manual',
  // AbortController, crypto.subtle) that work under convex-test but fail in the real runtime (R1).
  it('signs in through the proxy and mints a Convex token', async () => {
    const { authorizeUrl, callback } = await signIn()

    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(`${origin}/api/auth/callback/oidc`)
    expect(authorizeUrl.searchParams.get('client_id')).toBe(clientId)
    expect({ status: callback.status(), location: callback.headers().location }).toEqual({
      status: 302,
      location: `${origin}/app`,
    })
    expect(await sessionEmail()).toBe(email)
    expect(await mintStatus()).toBe(200)
  })

  // Catches: a proxy that refuses or alters Keycloak's form POST (no Origin, no cookies), and a
  // logout token that the real runtime cannot verify, so the session and the mint stay alive.
  it('Keycloak admin logout reaches Convex through the proxy and ends the session', async () => {
    expect(await mintStatus()).toBe(200)
    deliveries.length = 0

    const logout = await admin(`/users/${userUuid}/logout`, { method: 'POST' })
    expect(logout.status).toBe(204)
    await waitUntil(async () => deliveries.length > 0, 'Keycloak back-channel logout')

    expect(deliveries.map(({ status }) => status)).toEqual([200])
    // Mint first: reading the session clears the dead session cookie.
    expect(await mintStatus()).toBe(401)
    expect(await sessionEmail()).toBeNull()
  })

  // Catches: a sign-out through the proxy that returns no end-session URL, or one that Keycloak
  // refuses (wrong client_id or post-logout URI for this origin), so the Keycloak session lives on.
  it('sign-out returns the Keycloak end-session URL that ends the Keycloak session', async () => {
    const { callback, keycloakJar } = await signIn()
    expect(callback.status()).toBe(302)
    expect(await keycloakSessions()).toBe(1)

    const out = await site!.post('/api/auth/sign-out', {
      data: { disableRedirect: true, callbackURL: `${origin}/signed-out` },
    })

    expect(out.status()).toBe(200)
    expect(await sessionEmail()).toBeNull()
    const endSession = new URL(((await out.json()) as { url: string }).url)
    expect(`${endSession.origin}${endSession.pathname}`).toBe(
      `${ISSUER}/protocol/openid-connect/logout`,
    )
    expect(endSession.searchParams.get('client_id')).toBe(clientId)
    expect(endSession.searchParams.get('post_logout_redirect_uri')).toBe(`${origin}/signed-out`)
    const followed = await fetch(endSession, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(keycloakJar) },
    })
    expect(followed.status).toBe(302)
    expect(new URL(followed.headers.get('location')!).pathname).toBe('/signed-out')
    expect(await keycloakSessions()).toBe(0)
  })
})
