import { inspect } from 'node:util'

import { H3Error, type H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getConvexUser, requireConvexUser } from '../../src/runtime/server/utils/convex-user'
import { resolveRequestAuthSnapshot } from '../../src/runtime/server/utils/request-auth'
import { serverConvex } from '../../src/runtime/server/utils/server-convex-caller'

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

function createEvent(cookie?: string, convex: Record<string, unknown> = AUTH_CONVEX): H3Event {
  return {
    context: { nitro: { runtimeConfig: { public: { convex } } } },
    headers: new Headers(cookie ? { cookie } : {}),
  } as unknown as H3Event
}

const fetchMock = vi.fn<typeof fetch>()

function exchangeResponds(status: number, body: unknown = {}) {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status }))
}

async function rejection(promise: Promise<unknown>): Promise<H3Error> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(H3Error)
    return error as H3Error
  }
  throw new Error('expected the helper to reject')
}

/** Every rendering of a thrown error must stay free of request credentials. */
function expectNoCredentials(error: H3Error): void {
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

describe('getConvexUser and requireConvexUser', () => {
  it('resolve an anonymous request without a token exchange', async () => {
    const event = createEvent(PRIVATE_COOKIE)

    await expect(getConvexUser(event)).resolves.toBeNull()
    const error = await rejection(requireConvexUser(event))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(error.statusCode).toBe(401)
    expect(error.data).toMatchObject({
      name: 'ConvexCallError',
      kind: 'authentication',
      code: 'UNAUTHENTICATED',
      status: 401,
    })
    expectNoCredentials(error)
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
    expect(error.statusCode).toBe(401)
    expect(error.data).toMatchObject({ kind: 'authentication', code: 'UNAUTHENTICATED' })
    expectNoCredentials(error)
  })

  it('never exchange a credential in a build without auth', async () => {
    const event = createEvent(SESSION_COOKIE, { url: 'https://example.convex.cloud', auth: false })

    await expect(getConvexUser(event)).resolves.toBeNull()
    const error = await rejection(requireConvexUser(event))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(error.statusCode).toBe(401)
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
      expect(error.statusCode).toBe(502)
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
    expect(error.statusCode).toBe(500)
    expect(error.data).toMatchObject({ kind: 'unknown', code: 'SITE_URL_MISSING' })
    expectNoCredentials(error)
  })
})
