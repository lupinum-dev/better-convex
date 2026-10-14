import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { inspect } from 'node:util'

import { createEvent as createH3V1Event } from 'h3'
import { isNuxtError, type NuxtError } from 'nuxt/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getConvexUser, requireConvexUser } from '../../src/runtime/server/utils/convex-user'
import {
  eventNodeResponse,
  eventResponseHeaders,
  type ConvexServerEvent,
} from '../../src/runtime/server/utils/event'
import { resolveRequestAuthSnapshot } from '../../src/runtime/server/utils/request-auth'
import { serverConvex } from '../../src/runtime/server/utils/server-convex-caller'

// The `./server` helpers read the server's runtime config (`nuxt/server`
// `useRuntimeConfig()`); each test selects the public Convex config here.
const runtime = vi.hoisted(() => ({ publicConvex: undefined as unknown }))
vi.mock('nuxt/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nuxt/server')>()),
  useRuntimeConfig: () => ({ app: {}, public: { convex: runtime.publicConvex }, convex: {} }),
}))

const SESSION_COOKIE = 'better-auth.session_token=server-user-session-secret'
const PRIVATE_COOKIE = 'private_app_cookie=private-app-secret'
const SITE_URL = 'https://example.convex.site'
const AUTH_CONVEX = Object.freeze({
  url: 'https://example.convex.cloud',
  siteUrl: SITE_URL,
  auth: { origin: 'http://localhost:3000' },
})

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

function makeJwt(payload: Record<string, unknown>): string {
  return `${base64Url('{"alg":"RS256"}')}.${base64Url(JSON.stringify(payload))}.signature-secret`
}

const USER_JWT = makeJwt({
  sub: 'user-1',
  name: 'Ada',
  email: 'ada@example.test',
  exp: Math.floor(Date.now() / 1000) + 3600,
})

function nodeRequestResponse(cookie: string | undefined) {
  const req = new IncomingMessage(new Socket())
  req.method = 'GET'
  req.url = '/api/me'
  req.headers = { host: 'localhost:3000', ...(cookie ? { cookie } : {}) }
  return { req, res: new ServerResponse(req) }
}

// Every helper runs on both event shapes a supported Nuxt passes: the raw h3
// v1 event (Nuxt 4 routes and SSR; headers live on the Node response) and the
// web-shaped event (Nuxt 5, Nuxt 4.6 `nuxt/server` handlers; headers live on
// `event.res.headers`, the Node pair stays on `event.node`).
const shapes = [
  {
    name: 'raw h3 v1 event',
    create(cookie: string | undefined): ConvexServerEvent {
      const { req, res } = nodeRequestResponse(cookie)
      return createH3V1Event(req, res)
    },
  },
  {
    name: 'web-shaped event',
    create(cookie: string | undefined): ConvexServerEvent {
      const node = nodeRequestResponse(cookie)
      return {
        req: new Request('http://localhost:3000/api/me', {
          headers: cookie ? { cookie } : {},
        }),
        res: { headers: new Headers() },
        node,
        context: {},
      }
    },
  },
]

function responseHeaders(event: ConvexServerEvent): Record<string, string | null> {
  const headers = eventResponseHeaders(event)
  return Object.fromEntries([...new Set(headers.keys())].map((name) => [name, headers.get(name)]))
}

const fetchMock = vi.fn<typeof fetch>()

function exchangeResponds(status: number, body: unknown = {}) {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status }))
}

async function rejection(promise: Promise<unknown>): Promise<NuxtError> {
  try {
    await promise
  } catch (error) {
    expect(isNuxtError(error)).toBe(true)
    return error as NuxtError
  }
  throw new Error('expected the helper to reject')
}

/** Every rendering of a thrown error must stay free of request credentials. */
function expectNoCredentials(error: NuxtError): void {
  for (const rendered of [
    JSON.stringify(error),
    JSON.stringify(error.data),
    error.message,
    String(error.stack),
    inspect(error, { depth: 10 }),
  ]) {
    expect(rendered).not.toContain('server-user-session-secret')
    expect(rendered).not.toContain('private-app-secret')
    expect(rendered).not.toContain('signature-secret')
    expect(rendered).not.toContain(USER_JWT)
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe.each(shapes)('getConvexUser and requireConvexUser ($name)', (shape) => {
  function createEvent(cookie?: string, convex: unknown = AUTH_CONVEX): ConvexServerEvent {
    runtime.publicConvex = convex
    return shape.create(cookie)
  }

  it('resolve an anonymous request without a token exchange', async () => {
    const event = createEvent(PRIVATE_COOKIE)

    await expect(getConvexUser(event)).resolves.toBeNull()
    const error = await rejection(requireConvexUser(event))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(error.status).toBe(401)
    expect(error.data).toMatchObject({
      name: 'ConvexCallError',
      kind: 'authentication',
      code: 'UNAUTHENTICATED',
      status: 401,
    })
    expectNoCredentials(error)
  })

  it('mark the response Vary: Cookie and private, no-store once the session cookie is read', async () => {
    exchangeResponds(200, { token: USER_JWT })
    const signedIn = createEvent(SESSION_COOKIE)
    await getConvexUser(signedIn)
    expect(responseHeaders(signedIn)).toEqual({
      vary: 'Cookie',
      'cache-control': 'private, no-store',
    })

    // No auth cookie: the answer is anonymous, but still depends on the cookie header.
    const anonymous = createEvent(PRIVATE_COOKIE)
    await getConvexUser(anonymous)
    expect(responseHeaders(anonymous)).toEqual({ vary: 'Cookie' })
  })

  it('leave the response alone once its headers are sent (SSE, streaming)', async () => {
    exchangeResponds(200, { token: USER_JWT })
    const event = createEvent(SESSION_COOKIE)
    // After the flush Node throws ERR_HTTP_HEADERS_SENT on any header write.
    eventNodeResponse(event)!.writeHead(200)

    await expect(getConvexUser(event)).resolves.toMatchObject({ id: 'user-1' })
    expect(responseHeaders(event)).toEqual({})
  })

  it('exchange the session at most once per request and forward only Better Auth cookies', async () => {
    exchangeResponds(200, { token: USER_JWT })
    const event = createEvent(`${PRIVATE_COOKIE}; ${SESSION_COOKIE}`)

    const [first, required, second] = await Promise.all([
      getConvexUser(event),
      requireConvexUser(event),
      getConvexUser(event),
    ])

    expect(first).toEqual({ id: 'user-1', name: 'Ada', email: 'ada@example.test' })
    expect(required).toEqual(first)
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(`${SITE_URL}/api/auth/convex/token`)
    expect(new Headers(init?.headers).get('cookie')).toBe(SESSION_COOKIE)
    expect(init?.redirect).toBe('error')
    // The resolved user is display identity; the Convex token never leaves the snapshot.
    expect(JSON.stringify(first)).not.toContain(USER_JWT)
  })

  it('share one exchange, and one identity, with serverConvex on the same request', async () => {
    exchangeResponds(200, { token: USER_JWT })
    const event = createEvent(SESSION_COOKIE)

    const user = await requireConvexUser(event)
    const token = await serverConvex(event, { auth: 'required' }).getToken()
    await serverConvex(event).getToken()

    expect(user).toMatchObject({ id: 'user-1' })
    expect(token).toBe(USER_JWT)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keep serverConvex fail-closed on the shared snapshot', async () => {
    exchangeResponds(403, { message: 'revoked' })
    const revoked = createEvent(SESSION_COOKIE)
    await expect(getConvexUser(revoked)).resolves.toBeNull()
    await expect(serverConvex(revoked, { auth: 'required' }).getToken()).rejects.toMatchObject({
      kind: 'authentication',
      code: 'UNAUTHENTICATED',
      status: 403,
    })
    await expect(serverConvex(revoked, { auth: 'optional' }).getToken()).resolves.toBeNull()

    exchangeResponds(500, { detail: SESSION_COOKIE })
    const failing = createEvent(SESSION_COOKIE)
    for (const auth of ['required', 'optional'] as const) {
      const error = await serverConvex(failing, { auth })
        .getToken()
        .catch((cause: unknown) => cause)
      expect(error).toMatchObject({ kind: 'transport', code: 'AUTH_UNAVAILABLE' })
      expect(JSON.stringify(error)).not.toContain('server-user-session-secret')
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('share the SSR hydration exchange for the same request only', async () => {
    exchangeResponds(200, { token: USER_JWT })
    const event = createEvent(SESSION_COOKIE)

    await resolveRequestAuthSnapshot(event, {
      siteUrl: SITE_URL,
      publicOrigin: 'http://localhost:3000',
      trustedClientIpHeader: '',
      cookieHeader: SESSION_COOKIE,
    })
    await expect(getConvexUser(event)).resolves.toMatchObject({ id: 'user-1' })
    expect(fetchMock).toHaveBeenCalledOnce()

    await expect(getConvexUser(createEvent(SESSION_COOKIE))).resolves.toMatchObject({
      id: 'user-1',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([401, 403])('treat an exchange %i as an invalid session', async (status) => {
    exchangeResponds(status, { message: 'invalid session' })
    const event = createEvent(SESSION_COOKIE)

    await expect(getConvexUser(event)).resolves.toBeNull()
    const error = await rejection(requireConvexUser(event))

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(error.status).toBe(401)
    expect(error.data).toMatchObject({ kind: 'authentication', code: 'UNAUTHENTICATED' })
    expectNoCredentials(error)
  })

  it('never exchange a credential in a build without auth', async () => {
    const event = createEvent(SESSION_COOKIE, { url: 'https://example.convex.cloud', auth: false })

    await expect(getConvexUser(event)).resolves.toBeNull()
    const error = await rejection(requireConvexUser(event))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(error.status).toBe(401)
    expect(error.data).toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it.each([
    ['an upstream 500', () => exchangeResponds(500, { detail: SESSION_COOKIE })],
    ['a malformed body', () => exchangeResponds(200, { notToken: SESSION_COOKIE })],
    [
      'an expired token',
      () => exchangeResponds(200, { token: makeJwt({ sub: 'user-1', exp: 1 }) }),
    ],
    [
      'a network failure',
      () => fetchMock.mockRejectedValue(new Error(`connect failed ${SESSION_COOKIE}`)),
    ],
  ])('reject with a credential-free 502 on %s', async (_label, arrange) => {
    arrange()
    const event = createEvent(SESSION_COOKIE)

    const optional = await rejection(getConvexUser(event))
    const required = await rejection(requireConvexUser(event))

    expect(fetchMock).toHaveBeenCalledOnce()
    for (const error of [optional, required]) {
      expect(error.status).toBe(502)
      expect(error.data).toMatchObject({
        name: 'ConvexCallError',
        kind: 'transport',
        code: 'AUTH_UNAVAILABLE',
      })
      expectNoCredentials(error)
    }
  })

  it('fail closed with a 500 when auth has no Convex site URL', async () => {
    const event = createEvent(SESSION_COOKIE, { auth: { origin: 'http://localhost:3000' } })

    const error = await rejection(getConvexUser(event))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(error.status).toBe(500)
    expect(error.data).toMatchObject({ kind: 'unknown', code: 'SITE_URL_MISSING' })
    expectNoCredentials(error)
  })
})

describe('one auth snapshot per request', () => {
  // Catches a snapshot keyed by the event object: Nuxt 4.6 hands SSR the raw
  // h3 v1 event and `nuxt/server` handlers a portable Proxy over it, and Nuxt 5
  // gives SSR a new event; only `context` is shared. Keyed by event, one page
  // request would exchange (and renew) the session twice.
  it('exchange once for a raw h3 v1 event and a web-shaped event that share one context', async () => {
    exchangeResponds(200, { token: USER_JWT })
    runtime.publicConvex = AUTH_CONVEX
    const { req, res } = nodeRequestResponse(SESSION_COOKIE)
    const raw = createH3V1Event(req, res)
    const web: ConvexServerEvent = {
      req: new Request('http://localhost:3000/api/me', { headers: { cookie: SESSION_COOKIE } }),
      res: { headers: new Headers() },
      node: { req, res },
      context: raw.context,
    }

    await expect(getConvexUser(raw)).resolves.toMatchObject({ id: 'user-1' })
    await expect(serverConvex(web, { auth: 'required' }).getToken()).resolves.toBe(USER_JWT)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
