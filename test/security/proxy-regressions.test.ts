import { Socket } from 'node:net'
import { join } from 'node:path'
import { inspect } from 'node:util'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConvexServerEvent } from '../../src/runtime/server/utils/event'
import { rawProxyEvent } from '../helpers/auth-proxy-event'

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  recordAuthProxyRequest: vi.fn(),
}))

vi.mock('../../src/runtime/server/utils/server-config', () => ({
  readServerConvexConfig: mocks.config,
}))
vi.mock('../../src/runtime/devtools/auth-proxy-registry', () => ({
  recordAuthProxyRequest: mocks.recordAuthProxyRequest,
}))

const DEFAULT_HEADERS = {
  'cf-connecting-ip': '203.0.113.10',
  origin: 'https://app.example.test',
}

/**
 * The raw h3 v1 event of a Nuxt 4 request. A Uint8Array body is the live
 * Node request body; a ReadableStream body is the body h3 1.x already holds
 * (`event._requestBody`, its web adapter).
 */
function event(
  method = 'GET',
  body?: Uint8Array | ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
  path = '/api/auth/get-session',
) {
  const raw = rawProxyEvent({
    method,
    path,
    headers: { ...DEFAULT_HEADERS, ...headers },
    body: body instanceof Uint8Array ? body : undefined,
    open: body instanceof ReadableStream,
  })
  if (body instanceof ReadableStream) Object.assign(raw.event, { _requestBody: body })
  return raw
}

/** A Nuxt 5 (h3 v2) event: web Request and response headers, no Node objects. */
function webEvent(init: RequestInit & { path?: string } = {}) {
  const { path = '/api/auth/get-session', headers, ...requestInit } = init
  return {
    req: new Request(`https://app.example.test${path}`, {
      ...requestInit,
      headers: { ...DEFAULT_HEADERS, ...Object.fromEntries(new Headers(headers)) },
      ...(requestInit.body ? { duplex: 'half' } : {}),
    } as RequestInit),
    res: { headers: new Headers() },
    context: {},
  }
}

function stubFetch<T extends (...args: never[]) => unknown>(fetchMock: T): T {
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const handlers = {
  proxy: () => import('../../src/runtime/server/api/auth/[...]'),
  jwks: () => import('../../src/runtime/server/api/auth/jwks'),
  metadata: () => import('../../src/runtime/server/api/auth/authorization-server-metadata'),
}

async function loadHandler(name: keyof typeof handlers = 'proxy') {
  const handler = (await handlers[name]()).default
  return (input: ConvexServerEvent | { event: ConvexServerEvent }) =>
    handler('event' in input ? input.event : input)
}

/**
 * `import.meta.dev` is a build-time constant that Vitest leaves undefined.
 * Turn it on for the proxy module only, for the duration of `run`.
 */
async function inDevelopment<T>(run: () => Promise<T>): Promise<T> {
  const proxyModule = join('server', 'api', 'auth', '[...].ts')
  Object.defineProperty(Object.prototype, 'dev', {
    configurable: true,
    get(this: { filename?: unknown }) {
      return typeof this.filename === 'string' && this.filename.endsWith(proxyModule)
        ? true
        : undefined
    },
  })
  try {
    return await run()
  } finally {
    Reflect.deleteProperty(Object.prototype, 'dev')
  }
}

describe('auth proxy security regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', 'proxy-ip-test-secret-with-32-bytes')
    mocks.config.mockReturnValue({
      url: 'https://demo.convex.cloud',
      siteUrl: 'https://demo.convex.site',
      auth: {
        origin: 'https://app.example.test',
        trustedClientIpHeader: 'cf-connecting-ip',
        redirectTo: '/auth/signin',
      },
    })
    mocks.recordAuthProxyRequest.mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('makes exactly one manual request and never follows an upstream redirect', async () => {
    const fetchMock = stubFetch(
      vi.fn(
        async () =>
          new Response('', {
            status: 302,
            headers: { location: 'http://127.0.0.1/api/auth/get-session' },
          }),
      ),
    )
    const handler = await loadHandler()
    const response = await handler(event())
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.convex.site/api/auth/get-session',
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(response.status).toBe(302)
    expect(response.statusText).toBe('')
    expect(response.headers.get('location')).toBe('http://127.0.0.1/api/auth/get-session')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('preserves Better Auth navigation versus browser-fetch redirect semantics', async () => {
    const fetchMock = stubFetch(vi.fn(async () => new Response('{}')))
    const handler = await loadHandler()

    await handler(event('GET', undefined, { 'sec-fetch-mode': 'navigate' }))
    await handler(event('GET', undefined, { 'sec-fetch-mode': 'cors' }))
    await handler(event())

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ mode: 'same-origin' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ mode: 'cors' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.objectContaining({ mode: 'same-origin' }),
    )
  })

  it('denies a poisoned Host with a matching attacker Origin before upstream delivery', async () => {
    const fetchMock = stubFetch(vi.fn(async () => new Response('{}')))

    const handler = await loadHandler()

    await expect(
      handler(
        event('GET', undefined, {
          host: 'attacker.example.test',
          origin: 'https://attacker.example.test',
          'x-forwarded-host': 'attacker.example.test',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).rejects.toMatchObject({
      status: 403,
      data: { code: 'BCN_AUTH_PROXY_ORIGIN_BLOCKED' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when the configured public origin is missing', async () => {
    const configured = mocks.config()
    mocks.config.mockReturnValue({
      ...configured,
      auth: { ...configured.auth, origin: '' },
    })
    const fetchMock = stubFetch(vi.fn(async () => new Response('{}')))

    const handler = await loadHandler()
    await expect(handler(event())).rejects.toMatchObject({
      status: 500,
      data: { code: 'BCN_AUTH_PROXY_PUBLIC_ORIGIN_MISSING' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    undefined,
    '203.0.113.10, 10.0.0.1',
    '203.0.113.10 forwarded',
    '999.0.0.1',
    'not-an-ip',
  ])(
    'rejects a missing or invalid trusted client IP before upstream delivery: %s',
    async (clientIp) => {
      const fetchMock = stubFetch(vi.fn(async () => new Response('{}')))
      const headers =
        clientIp === undefined ? { 'cf-connecting-ip': '' } : { 'cf-connecting-ip': clientIp }

      const handler = await loadHandler()
      await expect(handler(event('GET', undefined, headers))).rejects.toMatchObject({
        status: 400,
        data: { code: 'BCN_AUTH_PROXY_CLIENT_IP_INVALID' },
      })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each([undefined, 'short'])(
    'reports a missing or weak proxy secret as configuration before upstream delivery: %s',
    async (secret) => {
      vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', secret)
      const fetchMock = stubFetch(vi.fn(async () => new Response('{}')))

      const handler = await loadHandler()
      await expect(handler(event())).rejects.toMatchObject({
        status: 500,
        data: { code: 'BCN_AUTH_PROXY_IP_SECRET_INVALID' },
      })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  // Catches a development diagnostics failure (devtools registry unavailable)
  // turning a successful sign-in response into a 502.
  it('keeps successful auth responses independent from development diagnostics storage', async () => {
    mocks.recordAuthProxyRequest.mockRejectedValue(new Error('diagnostics unavailable'))
    stubFetch(vi.fn(async () => new Response('{}')))

    const handler = await loadHandler()
    const response = await inDevelopment(() => handler(event()))

    expect(mocks.recordAuthProxyRequest).toHaveBeenCalledOnce()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{}')
  })

  it('traces proxy state transitions without request or response credentials', async () => {
    const configured = mocks.config()
    mocks.config.mockReturnValue({
      ...configured,
      logging: 'debug',
    })
    const requestSentinel = 'BCN_PROXY_REQUEST_SECRET_SENTINEL'
    const responseSentinel = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcm94eS1zZW50aW5lbCJ9.signature'
    const requestBody = new TextEncoder().encode(`password=${requestSentinel}`)
    stubFetch(vi.fn(async () => new Response(JSON.stringify({ token: responseSentinel }))))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const handler = await loadHandler()
      await handler(
        event(
          'POST',
          requestBody,
          {
            'content-length': String(requestBody.byteLength),
            'content-type': 'application/x-www-form-urlencoded',
          },
          '/api/auth/sign-in/email',
        ),
      )

      const output = JSON.stringify(log.mock.calls)
      expect(output).toContain('auth-proxy.request.started')
      expect(output).toContain('auth-proxy.request.completed')
      expect(output).toContain('requestBodyBytes')
      expect(output).toContain('responseBodyBytes')
      expect(output).toContain('requestId')
      expect(output).not.toContain(requestSentinel)
      expect(output).not.toContain(responseSentinel)
    } finally {
      log.mockRestore()
    }
  })

  it('preserves bytes, regenerates framing, and drops proxy controls', async () => {
    const bytes = new Uint8Array([255, 0, 97])
    let forwarded: RequestInit | undefined
    stubFetch(
      vi.fn(async (_url: string, init?: RequestInit) => {
        forwarded = init
        return new Response('{}')
      }),
    )
    const handler = await loadHandler()
    await handler(
      event(
        'POST',
        bytes,
        {
          'content-length': '3',
          'content-type': 'application/octet-stream',
          'x-forwarded-for': '10.0.0.1',
          'x-better-auth-forwarded-host': 'evil.test',
        },
        '/api/auth/plugin/binary',
      ),
    )
    expect(new Uint8Array(forwarded?.body as ArrayBuffer)).toEqual(bytes)
    const headers = forwarded?.headers as Record<string, string>
    expect(headers['content-length']).toBeUndefined()
    expect(headers['x-forwarded-for']).toBeUndefined()
    expect(headers['x-better-auth-forwarded-host']).toBeUndefined()
    expect(headers['x-better-auth-forwarded-proto']).toBeUndefined()
  })

  it('forwards independent cookies, removes unsafe response framing, and forces no-store', async () => {
    const responseHeaders = new Headers({
      'cache-control': 'public, max-age=86400',
      'cdn-cache-control': 'public, s-maxage=86400',
      'content-length': '999',
      'content-encoding': 'gzip',
      'content-type': 'application/json',
      connection: 'keep-alive, x-hop',
      'surrogate-control': 'max-age=86400',
      'vercel-cdn-cache-control': 'public, s-maxage=86400',
      'x-hop': 'must-not-forward',
    })
    responseHeaders.append('set-cookie', 'better-auth.session_token=one; Path=/; HttpOnly')
    responseHeaders.append('set-cookie', 'better-auth.callback=two; Path=/; HttpOnly')
    stubFetch(vi.fn(async () => new Response('{}', { headers: responseHeaders })))
    const handler = await loadHandler()
    const response = await handler(event())
    expect(response.headers.getSetCookie()).toEqual([
      'better-auth.session_token=one; Path=/; HttpOnly',
      'better-auth.callback=two; Path=/; HttpOnly',
    ])
    // The framing describes the bytes the proxy sends, not the upstream's.
    expect(response.headers.get('content-length')).toBe('2')
    expect(response.headers.get('content-encoding')).toBeNull()
    for (const header of [
      'cdn-cache-control',
      'surrogate-control',
      'vercel-cdn-cache-control',
      'x-hop',
    ]) {
      expect(response.headers.get(header), header).toBeNull()
    }
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).toBe('{}')
  })

  it('rejects Domain-scoped Better Auth cookies and cancels the upstream body', async () => {
    const cancel = vi.fn()
    const responseHeaders = new Headers()
    responseHeaders.append(
      'set-cookie',
      'better-auth.session_token=one; Domain=.example.test; Path=/; Secure; HttpOnly',
    )
    stubFetch(
      vi.fn(
        async () =>
          new Response(new ReadableStream({ start() {}, cancel }), { headers: responseHeaders }),
      ),
    )
    const handler = await loadHandler()
    const proxyEvent = event()

    await expect(handler(proxyEvent)).rejects.toMatchObject({
      status: 502,
      data: { code: 'BCN_AUTH_PROXY_COOKIE_DOMAIN_UNSUPPORTED' },
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(proxyEvent.res.getHeader('set-cookie')).toBeUndefined()
  })

  it('rejects unsupported upstream cookie names and cancels the upstream body', async () => {
    const cancel = vi.fn()
    const responseHeaders = new Headers()
    responseHeaders.append('set-cookie', 'custom.session_token=one; Path=/; Secure; HttpOnly')
    stubFetch(
      vi.fn(
        async () =>
          new Response(new ReadableStream({ start() {}, cancel }), { headers: responseHeaders }),
      ),
    )
    const handler = await loadHandler()
    const proxyEvent = event()

    await expect(handler(proxyEvent)).rejects.toMatchObject({
      status: 502,
      data: { code: 'BCN_AUTH_PROXY_COOKIE_NAME_UNSUPPORTED' },
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(proxyEvent.res.getHeader('set-cookie')).toBeUndefined()
  })

  it('rejects weak session-cookie flags and cancels the upstream body', async () => {
    const cancel = vi.fn()
    const responseHeaders = new Headers()
    responseHeaders.append(
      'set-cookie',
      '__Secure-better-auth.session_token=one; Path=/; HttpOnly; SameSite=Lax',
    )
    stubFetch(
      vi.fn(
        async () =>
          new Response(new ReadableStream({ start() {}, cancel }), { headers: responseHeaders }),
      ),
    )
    const handler = await loadHandler()
    const proxyEvent = event()

    await expect(handler(proxyEvent)).rejects.toMatchObject({
      status: 502,
      data: { code: 'BCN_AUTH_PROXY_COOKIE_FLAGS_UNSUPPORTED', violation: 'secure-missing' },
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(proxyEvent.res.getHeader('set-cookie')).toBeUndefined()
  })

  it('forwards only the final upstream value for a duplicate cookie name', async () => {
    const responseHeaders = new Headers()
    responseHeaders.append(
      'set-cookie',
      'better-auth.session_token=old; Path=/; HttpOnly; SameSite=Lax',
    )
    responseHeaders.append(
      'set-cookie',
      'better-auth.session_token=new; Path=/; HttpOnly; SameSite=Lax',
    )
    stubFetch(vi.fn(async () => new Response('{}', { headers: responseHeaders })))
    const handler = await loadHandler()

    const response = await handler(event())

    expect(response.headers.getSetCookie()).toEqual([
      'better-auth.session_token=new; Path=/; HttpOnly; SameSite=Lax',
    ])
  })

  it('rejects cross-origin and non-GET/POST requests before fetch', async () => {
    const fetchMock = stubFetch(vi.fn())
    const handler = await loadHandler()
    await expect(handler(event('OPTIONS'))).rejects.toMatchObject({ status: 405 })
    await expect(
      handler(event('GET', undefined, { origin: 'https://evil.example' })),
    ).rejects.toMatchObject({ status: 403 })
    const hostileReferer = rawProxyEvent({
      method: 'POST',
      headers: {
        'cf-connecting-ip': DEFAULT_HEADERS['cf-connecting-ip'],
        referer: 'https://evil.example/form',
      },
    })
    await expect(handler(hostileReferer)).rejects.toMatchObject({ status: 403 })
    expect(hostileReferer.res.shouldKeepAlive).toBe(false)
    expect(hostileReferer.res.getHeader('connection')).toBe('close')
    const sameSite = event('POST', undefined, {
      origin: 'https://app.example.test',
      'sec-fetch-site': 'same-site',
    })
    await expect(handler(sameSite)).rejects.toMatchObject({ status: 403 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sameSite.res.getHeader('cache-control')).toBe('private, no-store')
  })

  it('proxies only a credential-free cross-origin public-client token form', async () => {
    let forwardedInit: RequestInit | undefined
    const fetchMock = stubFetch(
      vi.fn(async (_target: string, init?: RequestInit) => {
        forwardedInit = init
        return new Response('{"error":"invalid_grant"}', {
          headers: {
            'access-control-allow-credentials': 'true',
            'access-control-allow-origin': 'https://upstream.example.test',
            'content-type': 'application/json',
          },
          status: 400,
        })
      }),
    )
    const handler = await loadHandler()
    const body = new TextEncoder().encode(
      'grant_type=authorization_code&client_id=public-client&code=opaque',
    )
    const tokenRequest = event(
      'POST',
      body,
      {
        'content-length': String(body.byteLength),
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        origin: 'http://127.0.0.1:6274',
        referer: 'http://127.0.0.1:6274/oauth/callback',
        'sec-fetch-site': 'cross-site',
      },
      '/api/auth/oauth2/token',
    )

    const response = await handler(tokenRequest)

    expect(fetchMock).toHaveBeenCalledOnce()
    if (!forwardedInit) throw new Error('Expected the public token request to be forwarded')
    const init = forwardedInit
    const forwarded = init.headers as Record<string, string>
    expect(forwarded.origin).toBe('https://app.example.test')
    expect(forwarded.referer).toBeUndefined()
    expect(forwarded['sec-fetch-site']).toBeUndefined()
    expect(forwarded.cookie).toBeUndefined()
    expect(forwarded.authorization).toBeUndefined()
    expect(response.status).toBe(400)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    expect(response.headers.getSetCookie()).toEqual([])
    // An error the server renders after this point keeps the public CORS header.
    expect(tokenRequest.res.getHeader('access-control-allow-origin')).toBe('*')
    expect(tokenRequest.res.getHeader('access-control-allow-credentials')).toBeUndefined()
  })

  it('answers only the exact public-client token preflight without upstream traffic', async () => {
    const fetchMock = stubFetch(vi.fn())
    const handler = await loadHandler()
    const preflight = event(
      'OPTIONS',
      undefined,
      {
        'access-control-request-headers': 'content-type',
        'access-control-request-method': 'POST',
        origin: 'http://127.0.0.1:6274',
      },
      '/api/auth/oauth2/token',
    )

    const response = await handler(preflight)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
    expect(Object.fromEntries(response.headers)).toEqual({
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST',
      'access-control-allow-origin': '*',
      'access-control-max-age': '300',
      'cache-control': 'private, no-store',
    })
  })

  it('rejects credential, media, header, method, path, query, and preflight expansion', async () => {
    const fetchMock = stubFetch(vi.fn())
    const handler = await loadHandler()
    const base = {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'http://127.0.0.1:6274',
    }

    for (const headers of [
      { ...base, cookie: 'better-auth.session_token=secret' },
      { ...base, authorization: 'Basic secret' },
      { ...base, dpop: 'proof' },
      { ...base, 'content-type': 'application/json' },
    ]) {
      await expect(
        handler(event('POST', undefined, headers, '/api/auth/oauth2/token')),
      ).rejects.toMatchObject({ status: 403 })
    }

    for (const path of [
      '/api/auth/oauth2/token?tenant=attacker',
      '/api/auth/oauth2/revoke',
      '/api/auth/oauth2/authorize',
      '/api/auth/get-session',
      '/api/auth/mcp/admin/provision',
    ]) {
      await expect(handler(event('POST', undefined, base, path))).rejects.toMatchObject({
        status: 403,
      })
    }

    await expect(
      handler(event('GET', undefined, { origin: base.origin }, '/api/auth/oauth2/token')),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      handler(
        event(
          'OPTIONS',
          undefined,
          {
            'access-control-request-headers': 'content-type, authorization',
            'access-control-request-method': 'POST',
            origin: base.origin,
          },
          '/api/auth/oauth2/token',
        ),
      ),
    ).rejects.toMatchObject({ status: 405 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects cookies from the public token upstream instead of exposing them cross-origin', async () => {
    const responseHeaders = new Headers()
    responseHeaders.append('set-cookie', 'better-auth.session_token=secret; Path=/; HttpOnly')
    stubFetch(vi.fn(async () => new Response('{}', { headers: responseHeaders })))
    const handler = await loadHandler()
    const tokenRequest = event(
      'POST',
      new TextEncoder().encode('grant_type=authorization_code'),
      {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'http://127.0.0.1:6274',
      },
      '/api/auth/oauth2/token',
    )

    await expect(handler(tokenRequest)).rejects.toMatchObject({
      status: 502,
      data: { code: 'BCN_AUTH_PROXY_TOKEN_COOKIE_REJECTED' },
    })
    expect(tokenRequest.res.getHeader('set-cookie')).toBeUndefined()
  })

  it('serves authorization-server metadata cross-origin without credentialed CORS', async () => {
    const fetchMock = stubFetch(
      vi.fn(
        async () =>
          new Response('{}', {
            headers: {
              'access-control-allow-credentials': 'true',
              'access-control-allow-origin': 'https://upstream.example.test',
              'content-type': 'application/json',
            },
          }),
      ),
    )
    const handler = await loadHandler('metadata')
    const metadataRequest = event(
      'GET',
      undefined,
      { origin: 'http://127.0.0.1:6274' },
      '/.well-known/oauth-authorization-server/api/auth',
    )

    const response = await handler(metadataRequest)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.convex.site/api/auth/.well-known/oauth-authorization-server',
      expect.anything(),
    )
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    expect(metadataRequest.res.getHeader('access-control-allow-origin')).toBe('*')
  })

  it('serves credential-free JWKS to server verifiers without browser ingress metadata', async () => {
    const fetchMock = stubFetch(vi.fn(async () => new Response('{"keys":[]}')))
    const handler = await loadHandler('jwks')
    const jwksRequest = event(
      'GET',
      undefined,
      { 'cf-connecting-ip': '', origin: '' },
      '/api/auth/jwks',
    )

    const response = await handler(jwksRequest)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.convex.site/api/auth/jwks',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'x-bcn-client-ip': expect.anything(),
          'x-bcn-client-ip-signature': expect.anything(),
        }),
      }),
    )
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(jwksRequest.res.getHeader('access-control-allow-origin')).toBe('*')
  })

  it('serves public JWKS to a browser with cookies and never forwards them', async () => {
    const fetchMock = stubFetch(vi.fn(async () => new Response('{"keys":[]}')))
    const handler = await loadHandler('jwks')

    await handler(
      event(
        'GET',
        undefined,
        {
          'cf-connecting-ip': '',
          // A signed-in developer opening the URL, on a platform that sets its own cookie.
          cookie: 'better-auth.session_token=secret; __vdpl=dpl_123',
        },
        '/api/auth/jwks',
      ),
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.convex.site/api/auth/jwks',
      expect.objectContaining({
        headers: expect.not.objectContaining({ cookie: expect.anything() }),
      }),
    )
  })

  it('rejects credentials entering or leaving public authorization-server metadata', async () => {
    const metadataPath = '/.well-known/oauth-authorization-server/api/auth'
    const fetchMock = stubFetch(vi.fn(async () => new Response('{}')))
    const handler = await loadHandler('metadata')

    const credentialHeaders: Record<string, string>[] = [
      { authorization: 'Bearer secret', origin: 'http://127.0.0.1:6274' },
      { dpop: 'proof', origin: 'http://127.0.0.1:6274' },
      { 'proxy-authorization': 'Basic secret', origin: 'http://127.0.0.1:6274' },
    ]
    for (const headers of credentialHeaders) {
      await expect(handler(event('GET', undefined, headers, metadataPath))).rejects.toMatchObject({
        status: 403,
        data: { code: 'BCN_AUTH_PROXY_METADATA_CREDENTIAL_REJECTED' },
      })
    }
    expect(fetchMock).not.toHaveBeenCalled()

    const responseHeaders = new Headers({
      'access-control-allow-credentials': 'true',
      'access-control-allow-origin': 'https://upstream.example.test',
    })
    responseHeaders.append('set-cookie', 'better-auth.session_token=secret; Path=/; HttpOnly')
    fetchMock.mockResolvedValueOnce(new Response('{}', { headers: responseHeaders }))
    const metadataRequest = event(
      'GET',
      undefined,
      { origin: 'http://127.0.0.1:6274' },
      metadataPath,
    )
    await expect(handler(metadataRequest)).rejects.toMatchObject({
      status: 502,
      data: { code: 'BCN_AUTH_PROXY_METADATA_COOKIE_REJECTED' },
    })
    expect(metadataRequest.res.getHeader('set-cookie')).toBeUndefined()
    expect(metadataRequest.res.getHeader('access-control-allow-origin')).toBe('*')
    expect(metadataRequest.res.getHeader('access-control-allow-credentials')).toBeUndefined()
  })

  it('rejects framed GET and encoded POST bodies before fetch and closes the connection', async () => {
    const fetchMock = stubFetch(vi.fn())
    const handler = await loadHandler()

    const framedGet = rawProxyEvent({
      headers: { ...DEFAULT_HEADERS, 'content-length': '1' },
      open: true,
      complete: false,
    })
    await expect(handler(framedGet)).rejects.toMatchObject({
      status: 400,
      data: { code: 'BCN_AUTH_PROXY_GET_BODY_REJECTED' },
    })
    expect(framedGet.res.shouldKeepAlive).toBe(false)
    expect(framedGet.res.getHeader('connection')).toBe('close')

    const encodedPost = event(
      'POST',
      new Uint8Array([1]),
      { 'content-encoding': 'gzip' },
      '/api/auth/plugin/action',
    )
    await expect(handler(encodedPost)).rejects.toMatchObject({
      status: 415,
      data: { code: 'BCN_AUTH_PROXY_REQUEST_ENCODING_UNSUPPORTED' },
    })
    expect(encodedPost.res.shouldKeepAlive).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(framedGet.res.getHeader('cache-control')).toBe('private, no-store')
    expect(encodedPost.res.getHeader('cache-control')).toBe('private, no-store')
  })

  // Catches the size error and the proxy's catch block disagreeing on the
  // status field: a chunked oversize upload (no content-length to reject
  // early) would then answer 502 BCN_AUTH_PROXY_UNREACHABLE and keep the
  // connection open with unread bytes, instead of 413 and `Connection: close`.
  it('answers a chunked POST over the limit with 413 and closes the connection', async () => {
    const fetchMock = stubFetch(vi.fn())
    const handler = await loadHandler()
    const oversize = event(
      'POST',
      new Uint8Array(1_048_577),
      { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' },
      '/api/auth/plugin/upload',
    )

    await expect(handler(oversize)).rejects.toMatchObject({
      status: 413,
      data: { code: 'BCN_AUTH_PROXY_REQUEST_BODY_TOO_LARGE' },
    })
    expect(oversize.res.getHeader('connection')).toBe('close')
    expect(oversize.res.shouldKeepAlive).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels an upstream response with an unsupported content encoding', async () => {
    const cancel = vi.fn()
    stubFetch(
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull() {
                // The unsupported encoding is rejected before reading.
              },
              cancel,
            }),
            { headers: { 'content-encoding': 'zstd' } },
          ),
      ),
    )
    const handler = await loadHandler()
    const proxyEvent = event()

    await expect(handler(proxyEvent)).rejects.toMatchObject({
      status: 502,
      data: { code: 'BCN_AUTH_PROXY_UPSTREAM_ENCODING_UNSUPPORTED' },
    })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    expect(proxyEvent.res.getHeader('cache-control')).toBe('private, no-store')
  })

  it('preserves missing-origin GET callback semantics', async () => {
    const fetchMock = stubFetch(vi.fn(async () => new Response('', { status: 302 })))
    const handler = await loadHandler()
    const callback = rawProxyEvent({
      path: '/api/auth/callback/github?code=opaque&state=opaque',
      headers: {
        'cf-connecting-ip': DEFAULT_HEADERS['cf-connecting-ip'],
        referer: 'https://github.com/',
        'sec-fetch-site': 'cross-site',
      },
    })

    await handler(callback)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.convex.site/api/auth/callback/github?code=opaque&state=opaque',
      expect.anything(),
    )
  })

  it('forwards only the exact core Apple-style form_post callback shape', async () => {
    const fetchMock = stubFetch(vi.fn(async () => new Response('', { status: 302 })))
    const handler = await loadHandler()
    const body = new TextEncoder().encode('code=opaque&state=opaque')
    const callbackHeaders = {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://appleid.apple.com',
      referer: 'https://appleid.apple.com/',
      'sec-fetch-site': 'cross-site',
    }

    await handler(event('POST', body, callbackHeaders, '/api/auth/callback/apple'))

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.convex.site/api/auth/callback/apple',
      expect.objectContaining({
        body: expect.any(ArrayBuffer),
        redirect: 'manual',
      }),
    )

    fetchMock.mockClear()
    await expect(
      handler(event('POST', body, callbackHeaders, '/api/auth/callback/apple/extra')),
    ).rejects.toMatchObject({ status: 403 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the deadline active while the upstream body is stalled', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    stubFetch(
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start() {
                // Headers resolve, but the body intentionally never completes.
              },
              cancel,
            }),
          ),
      ),
    )
    const handler = await loadHandler()
    const response = expect(handler(event())).rejects.toMatchObject({ status: 502 })
    await vi.advanceTimersByTimeAsync(8_001)
    await response
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('does not let continuous response chunks extend the wall-clock deadline', async () => {
    vi.useFakeTimers()
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = vi.fn(() => {
      if (timer) clearTimeout(timer)
    })
    stubFetch(
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                const emit = () => {
                  controller.enqueue(new Uint8Array([1]))
                  timer = setTimeout(emit, 1_000)
                }
                emit()
              },
              cancel,
            }),
          ),
      ),
    )
    const handler = await loadHandler()
    const response = expect(handler(event())).rejects.toMatchObject({ status: 502 })

    await vi.advanceTimersByTimeAsync(8_001)

    await response
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('cancels unread critical-error and declared-oversize upstream bodies', async () => {
    const criticalCancel = vi.fn()
    stubFetch(
      vi.fn(
        async () =>
          new Response(new ReadableStream({ start() {}, cancel: criticalCancel }), {
            status: 500,
          }),
      ),
    )
    const handler = await loadHandler()

    await expect(handler(event())).rejects.toMatchObject({
      status: 502,
      data: { code: 'BCN_AUTH_PROXY_UPSTREAM_STATUS' },
    })
    expect(criticalCancel).toHaveBeenCalledOnce()

    const oversizeCancel = vi.fn()
    stubFetch(
      vi.fn(
        async () =>
          new Response(new ReadableStream({ start() {}, cancel: oversizeCancel }), {
            headers: { 'content-length': '1048577' },
          }),
      ),
    )
    await expect(handler(event())).rejects.toMatchObject({
      status: 502,
      data: { code: 'BCN_AUTH_PROXY_UPSTREAM_BODY_TOO_LARGE' },
    })
    expect(oversizeCancel).toHaveBeenCalledOnce()
  })

  it('propagates browser disconnects during upload and fetch with deterministic cleanup', async () => {
    const uploadCancel = vi.fn()
    const upload = rawProxyEvent({
      method: 'POST',
      headers: DEFAULT_HEADERS,
      open: true,
      complete: false,
    })
    Object.assign(upload.event, {
      _requestBody: new ReadableStream({
        pull() {
          // Keep the upload pending until the browser disconnects.
        },
        cancel: uploadCancel,
      }),
    })
    const fetchMock = stubFetch(vi.fn())
    const handler = await loadHandler()
    const uploadResult = expect(handler(upload)).rejects.toMatchObject({ status: 502 })

    await Promise.resolve()
    upload.req.emit('aborted')
    await uploadResult
    expect(uploadCancel).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upload.res.shouldKeepAlive).toBe(false)
    expect(upload.req.listenerCount('aborted')).toBe(0)
    expect(upload.res.listenerCount('close')).toBe(0)

    let upstreamSignal: AbortSignal | undefined
    stubFetch(
      vi.fn(
        async (_target: string, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            upstreamSignal = init?.signal ?? undefined
            upstreamSignal?.addEventListener('abort', () => reject(upstreamSignal?.reason), {
              once: true,
            })
          }),
      ),
    )
    const duringFetch = event()
    const fetchResult = expect(handler(duringFetch)).rejects.toMatchObject({ status: 502 })
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined())
    duringFetch.res.emit('close')

    await fetchResult
    expect(upstreamSignal?.aborted).toBe(true)
    expect(duringFetch.req.listenerCount('aborted')).toBe(0)
    expect(duringFetch.res.listenerCount('close')).toBe(0)
  })

  // Catches a stalled download holding the socket past the deadline, and
  // leaked listeners or timers once the Node response is done. The handler
  // returns its Response before the server writes it, so the guard must
  // outlive the handler on a network response.
  it.each([
    { name: 'the client disconnects mid-download', end: 'close', destroyed: true },
    { name: 'the deadline passes mid-download', end: 'deadline', destroyed: true },
    { name: 'the response finishes', end: 'finish', destroyed: false },
  ] as const)(
    'keeps the deadline and disconnect signal active until the Node response finishes: $name',
    async ({ end, destroyed }) => {
      vi.useFakeTimers()
      let upstreamSignal: AbortSignal | undefined
      stubFetch(
        vi.fn(async (_target: string, init?: RequestInit) => {
          upstreamSignal = init?.signal ?? undefined
          return new Response('bounded')
        }),
      )
      const download = event()
      Object.defineProperty(download.res, 'socket', { value: new Socket() })
      const destroy = vi.spyOn(download.res, 'destroy').mockImplementation(() => download.res)
      const handler = await loadHandler()

      const response = await handler(download)

      expect(response.status).toBe(200)
      expect(upstreamSignal?.aborted).toBe(false)
      expect(download.res.listenerCount('close')).toBeGreaterThan(0)
      expect(vi.getTimerCount()).toBe(1)

      if (end === 'deadline') {
        await vi.advanceTimersByTimeAsync(8_001)
      } else {
        if (end === 'finish')
          Object.defineProperty(download.res, 'writableFinished', { value: true })
        download.res.emit(end)
        if (end === 'finish') download.res.emit('close')
      }

      expect(upstreamSignal?.aborted).toBe(destroyed)
      expect(destroy).toHaveBeenCalledTimes(destroyed ? 1 : 0)
      expect(download.req.listenerCount('aborted')).toBe(0)
      expect(download.res.listenerCount('close')).toBe(0)
      expect(download.res.listenerCount('finish')).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  // Catches the deferred guard applied to a Nuxt 4 in-process request (a
  // Node response without a socket never emits close): the listeners and
  // the deadline timer would then leak once per `$fetch` from the server.
  it('releases the deadline and listeners of an in-process request when the handler returns', async () => {
    vi.useFakeTimers()
    stubFetch(vi.fn(async () => new Response('{}')))
    const handler = await loadHandler()
    const inProcess = event()

    const response = await handler(inProcess)

    expect(response.status).toBe(200)
    expect(inProcess.res.socket).toBeNull()
    expect(inProcess.req.listenerCount('aborted')).toBe(0)
    expect(inProcess.req.listenerCount('close')).toBe(0)
    expect(inProcess.res.listenerCount('close')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  // Catches the Nuxt 5 path off Node (no `event.node`): reading a body that
  // is not there, or ignoring the request's abort signal.
  it('proxies a web-shaped event without Node objects and follows its abort signal', async () => {
    let forwarded: RequestInit | undefined
    stubFetch(
      vi.fn(async (_target: string, init?: RequestInit) => {
        forwarded = init
        return new Response('{}', { status: 201, statusText: 'Created' })
      }),
    )
    const handler = await loadHandler()
    const body = new TextEncoder().encode('{"email":"a@example.test"}')
    const posted = webEvent({
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
      path: '/api/auth/sign-in/email',
    })

    const response = await handler(posted)

    expect(new Uint8Array(forwarded?.body as ArrayBuffer)).toEqual(body)
    expect(response.status).toBe(201)
    expect(response.statusText).toBe('Created')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(posted.res.headers.get('cache-control')).toBe('private, no-store')

    let upstreamSignal: AbortSignal | undefined
    stubFetch(
      vi.fn(
        async (_target: string, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            upstreamSignal = init?.signal ?? undefined
            upstreamSignal?.addEventListener('abort', () => reject(upstreamSignal?.reason), {
              once: true,
            })
          }),
      ),
    )
    const client = new AbortController()
    const result = expect(handler(webEvent({ signal: client.signal }))).rejects.toMatchObject({
      status: 502,
      data: { code: 'BCN_AUTH_PROXY_UNREACHABLE' },
    })
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined())
    client.abort(new Error('client went away'))

    await result
    expect(upstreamSignal?.reason).toMatchObject({ message: 'client went away' })
  })

  it('drops upstream failure message, cause, and stack from proxy responses', async () => {
    const sentinels = {
      message: 'AUTH_PROXY_MESSAGE_SENTINEL_f7d120',
      cause: 'AUTH_PROXY_CAUSE_SENTINEL_c3550a',
      stack: 'AUTH_PROXY_STACK_SENTINEL_9b70ee',
    }
    const upstreamError = new Error(sentinels.message, { cause: new Error(sentinels.cause) })
    upstreamError.stack = sentinels.stack
    stubFetch(
      vi.fn(async () => {
        throw upstreamError
      }),
    )
    const handler = await loadHandler()
    let rejection: unknown
    try {
      await handler(event())
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({
      status: 502,
      message: expect.stringContaining('configured Convex auth server'),
      data: { code: 'BCN_AUTH_PROXY_UNREACHABLE' },
    })
    const rendered = inspect(rejection, { depth: null })
    for (const sentinel of Object.values(sentinels)) expect(rendered).not.toContain(sentinel)
  })
})
