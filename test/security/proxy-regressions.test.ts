import { EventEmitter } from 'node:events'
import { inspect } from 'node:util'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  requestUrl: vi.fn(),
  responseStatus: vi.fn(),
  responseHeaders: vi.fn(),
  responseCookie: vi.fn(),
  send: vi.fn((_event: unknown, body: Uint8Array) => body),
  storage: vi.fn(),
}))

vi.mock('h3', () => ({
  appendResponseHeader: mocks.responseCookie,
  createError(input: { statusCode: number; message: string; data?: unknown }) {
    return Object.assign(new Error(input.message), input)
  },
  defineEventHandler: (handler: unknown) => handler,
  getRequestURL: mocks.requestUrl,
  getRequestWebStream(event: { body?: Uint8Array | ReadableStream<Uint8Array> }) {
    if (!event.body) return undefined
    if (event.body instanceof ReadableStream) return event.body
    return new ReadableStream({
      start(controller) {
        controller.enqueue(event.body)
        controller.close()
      },
    })
  },
  send: mocks.send,
  setHeaders: mocks.responseHeaders,
  setResponseStatus: mocks.responseStatus,
}))

vi.mock('../../src/runtime/utils/runtime-config', () => ({ getConvexRuntimeConfig: mocks.config }))

vi.mock('nitropack/runtime', () => ({ useStorage: mocks.storage }))

function event(
  method = 'GET',
  body?: Uint8Array | ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
) {
  return {
    method,
    body,
    headers: new Headers({
      'cf-connecting-ip': '203.0.113.10',
      origin: 'https://app.example.test',
      ...headers,
    }),
    node: {
      req: Object.assign(new EventEmitter(), {
        complete: true,
        pause: vi.fn(),
        resume: vi.fn(),
        socket: undefined,
      }),
      res: Object.assign(new EventEmitter(), {
        destroy: vi.fn(),
        end: vi.fn(),
        headersSent: false,
        shouldKeepAlive: true,
        socket: undefined,
        writableFinished: false,
      }),
    },
  }
}

describe('auth proxy security regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', 'proxy-ip-test-secret-with-32-bytes')
    mocks.requestUrl.mockReturnValue(new URL('https://app.example.test/api/auth/get-session'))
    mocks.config.mockReturnValue({
      url: 'https://demo.convex.cloud',
      siteUrl: 'https://demo.convex.site',
      auth: {
        origin: 'https://app.example.test',
        trustedClientIpHeader: 'cf-connecting-ip',
        redirectTo: '/auth/signin',
      },
    })
    mocks.storage.mockReturnValue({
      getItem: vi.fn().mockResolvedValue([]),
      setItem: vi.fn().mockResolvedValue(undefined),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('makes exactly one manual request and never follows an upstream redirect', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('', {
          status: 302,
          headers: { location: 'http://127.0.0.1/api/auth/get-session' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
    await handler(event())
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.convex.site/api/auth/get-session',
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(mocks.responseStatus).toHaveBeenCalledWith(expect.anything(), 302, '')
    expect(mocks.responseHeaders).toHaveBeenCalledWith(expect.anything(), {
      'cache-control': 'private, no-store',
    })
  })

  it('preserves Better Auth navigation versus browser-fetch redirect semantics', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>

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
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    mocks.requestUrl.mockReturnValue(new URL('https://attacker.example.test/api/auth/get-session'))

    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>

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
      statusCode: 403,
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
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
    await expect(handler(event())).rejects.toMatchObject({
      statusCode: 500,
      data: { code: 'BCN_AUTH_PROXY_PUBLIC_ORIGIN_MISSING' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([undefined, '203.0.113.10, 10.0.0.1', 'not-an-ip'])(
    'rejects a missing or invalid trusted client IP before upstream delivery: %s',
    async (clientIp) => {
      const fetchMock = vi.fn(async () => new Response('{}'))
      vi.stubGlobal('fetch', fetchMock)
      const headers =
        clientIp === undefined ? { 'cf-connecting-ip': '' } : { 'cf-connecting-ip': clientIp }

      const handler = (await import('../../src/runtime/server/api/auth/[...]'))
        .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
      await expect(handler(event('GET', undefined, headers))).rejects.toMatchObject({
        statusCode: 400,
        data: { code: 'BCN_AUTH_PROXY_CLIENT_IP_INVALID' },
      })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('keeps successful auth responses independent from development diagnostics storage', async () => {
    mocks.storage.mockImplementation(() => {
      throw new Error('diagnostics storage unavailable')
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}')),
    )

    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
    const proxyEvent = event()

    await expect(handler(proxyEvent)).resolves.toBeUndefined()
    expect(mocks.send).toHaveBeenCalledWith(proxyEvent, new TextEncoder().encode('{}'))
    expect(mocks.responseStatus).toHaveBeenCalledWith(expect.anything(), 200, '')
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ token: responseSentinel }))),
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    mocks.requestUrl.mockReturnValue(new URL('https://app.example.test/api/auth/sign-in/email'))

    try {
      const handler = (await import('../../src/runtime/server/api/auth/[...]'))
        .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
      await handler(
        event('POST', requestBody, {
          'content-length': String(requestBody.byteLength),
          'content-type': 'application/x-www-form-urlencoded',
        }),
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        forwarded = init
        return new Response('{}')
      }),
    )
    mocks.requestUrl.mockReturnValue(new URL('https://app.example.test/api/auth/plugin/binary'))
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
    await handler(
      event('POST', bytes, {
        'content-length': '3',
        'content-type': 'application/octet-stream',
        'x-forwarded-for': '10.0.0.1',
        'x-better-auth-forwarded-host': 'evil.test',
      }),
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { headers: responseHeaders })),
    )
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
    await handler(event())
    expect(mocks.responseCookie).toHaveBeenCalledTimes(2)
    expect(mocks.responseCookie).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'set-cookie',
      'better-auth.session_token=one; Path=/; HttpOnly',
    )
    expect(mocks.responseCookie).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'set-cookie',
      'better-auth.callback=two; Path=/; HttpOnly',
    )
    expect(mocks.responseHeaders).not.toHaveBeenCalledWith(expect.anything(), {
      'content-length': expect.anything(),
    })
    expect(mocks.responseHeaders).not.toHaveBeenCalledWith(expect.anything(), {
      'content-encoding': expect.anything(),
    })
    for (const header of [
      'cdn-cache-control',
      'surrogate-control',
      'vercel-cdn-cache-control',
      'x-hop',
    ]) {
      expect(mocks.responseHeaders).not.toHaveBeenCalledWith(expect.anything(), {
        [header]: expect.anything(),
      })
    }
    expect(mocks.responseHeaders).toHaveBeenCalledWith(expect.anything(), {
      'cache-control': 'private, no-store',
    })
  })

  it('rejects Domain-scoped Better Auth cookies and cancels the upstream body', async () => {
    const cancel = vi.fn()
    const responseHeaders = new Headers()
    responseHeaders.append(
      'set-cookie',
      'better-auth.session_token=one; Domain=.example.test; Path=/; Secure; HttpOnly',
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new ReadableStream({ start() {}, cancel }), { headers: responseHeaders }),
      ),
    )
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>

    await expect(handler(event())).rejects.toMatchObject({
      statusCode: 502,
      data: { code: 'BCN_AUTH_PROXY_COOKIE_DOMAIN_UNSUPPORTED' },
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(mocks.responseCookie).not.toHaveBeenCalled()
  })

  it('rejects unsupported upstream cookie names and cancels the upstream body', async () => {
    const cancel = vi.fn()
    const responseHeaders = new Headers()
    responseHeaders.append('set-cookie', 'custom.session_token=one; Path=/; Secure; HttpOnly')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new ReadableStream({ start() {}, cancel }), { headers: responseHeaders }),
      ),
    )
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>

    await expect(handler(event())).rejects.toMatchObject({
      statusCode: 502,
      data: { code: 'BCN_AUTH_PROXY_COOKIE_NAME_UNSUPPORTED' },
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(mocks.responseCookie).not.toHaveBeenCalled()
  })

  it('rejects cross-origin and non-GET/POST requests before fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
    await expect(handler(event('OPTIONS'))).rejects.toMatchObject({ statusCode: 405 })
    await expect(
      handler(event('GET', undefined, { origin: 'https://evil.example' })),
    ).rejects.toMatchObject({ statusCode: 403 })
    const hostileReferer = event('POST')
    hostileReferer.headers.delete('origin')
    hostileReferer.headers.set('referer', 'https://evil.example/form')
    await expect(handler(hostileReferer)).rejects.toMatchObject({ statusCode: 403 })
    expect(hostileReferer.node.res.shouldKeepAlive).toBe(false)
    expect(mocks.responseHeaders).toHaveBeenCalledWith(hostileReferer, {
      connection: 'close',
    })
    await expect(
      handler(
        event('POST', undefined, {
          origin: 'https://app.example.test',
          'sec-fetch-site': 'same-site',
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.responseHeaders).toHaveBeenCalledWith(expect.anything(), {
      'cache-control': 'private, no-store',
    })
  })

  it('proxies only a credential-free cross-origin public-client token form', async () => {
    mocks.requestUrl.mockReturnValue(new URL('https://app.example.test/api/auth/oauth2/token'))
    let forwardedInit: RequestInit | undefined
    const fetchMock = vi.fn(async (_target: string, init?: RequestInit) => {
      forwardedInit = init
      return new Response('{"error":"invalid_grant"}', {
        headers: {
          'access-control-allow-credentials': 'true',
          'access-control-allow-origin': 'https://upstream.example.test',
          'content-type': 'application/json',
        },
        status: 400,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
    const body = new TextEncoder().encode(
      'grant_type=authorization_code&client_id=public-client&code=opaque',
    )
    const tokenRequest = event('POST', body, {
      'content-length': String(body.byteLength),
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      origin: 'http://127.0.0.1:6274',
      referer: 'http://127.0.0.1:6274/oauth/callback',
      'sec-fetch-site': 'cross-site',
    })

    await handler(tokenRequest)

    expect(fetchMock).toHaveBeenCalledOnce()
    if (!forwardedInit) throw new Error('Expected the public token request to be forwarded')
    const init = forwardedInit
    const forwarded = init.headers as Record<string, string>
    expect(forwarded.origin).toBe('https://app.example.test')
    expect(forwarded.referer).toBeUndefined()
    expect(forwarded['sec-fetch-site']).toBeUndefined()
    expect(forwarded.cookie).toBeUndefined()
    expect(forwarded.authorization).toBeUndefined()
    expect(mocks.responseHeaders).toHaveBeenCalledWith(tokenRequest, {
      'access-control-allow-origin': '*',
    })
    expect(mocks.responseHeaders).not.toHaveBeenCalledWith(expect.anything(), {
      'access-control-allow-credentials': expect.anything(),
    })
    expect(mocks.responseHeaders).not.toHaveBeenCalledWith(expect.anything(), {
      'access-control-allow-origin': 'https://upstream.example.test',
    })
    expect(mocks.responseCookie).not.toHaveBeenCalled()
  })

  it('answers only the exact public-client token preflight without upstream traffic', async () => {
    mocks.requestUrl.mockReturnValue(new URL('https://app.example.test/api/auth/oauth2/token'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
    const preflight = event('OPTIONS', undefined, {
      'access-control-request-headers': 'content-type',
      'access-control-request-method': 'POST',
      origin: 'http://127.0.0.1:6274',
    })

    await handler(preflight)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.responseStatus).toHaveBeenCalledWith(preflight, 204)
    expect(mocks.responseHeaders).toHaveBeenCalledWith(preflight, {
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST',
      'access-control-allow-origin': '*',
      'access-control-max-age': 300,
    })
    expect(mocks.responseHeaders).not.toHaveBeenCalledWith(expect.anything(), {
      'access-control-allow-credentials': expect.anything(),
    })
    expect(mocks.send).toHaveBeenCalledWith(preflight, '')
  })

  it('rejects credential, media, header, method, path, query, and preflight expansion', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
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
      mocks.requestUrl.mockReturnValue(new URL('https://app.example.test/api/auth/oauth2/token'))
      await expect(handler(event('POST', undefined, headers))).rejects.toMatchObject({
        statusCode: 403,
      })
    }

    for (const requestUrl of [
      'https://app.example.test/api/auth/oauth2/token?tenant=attacker',
      'https://app.example.test/api/auth/oauth2/revoke',
      'https://app.example.test/api/auth/oauth2/authorize',
      'https://app.example.test/api/auth/get-session',
      'https://app.example.test/api/auth/mcp/admin/provision',
    ]) {
      mocks.requestUrl.mockReturnValue(new URL(requestUrl))
      await expect(handler(event('POST', undefined, base))).rejects.toMatchObject({
        statusCode: 403,
      })
    }

    mocks.requestUrl.mockReturnValue(new URL('https://app.example.test/api/auth/oauth2/token'))
    await expect(handler(event('GET', undefined, { origin: base.origin }))).rejects.toMatchObject({
      statusCode: 403,
    })
    await expect(
      handler(
        event('OPTIONS', undefined, {
          'access-control-request-headers': 'content-type, authorization',
          'access-control-request-method': 'POST',
          origin: base.origin,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 405 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects cookies from the public token upstream instead of exposing them cross-origin', async () => {
    mocks.requestUrl.mockReturnValue(new URL('https://app.example.test/api/auth/oauth2/token'))
    const responseHeaders = new Headers()
    responseHeaders.append('set-cookie', 'better-auth.session_token=secret; Path=/; HttpOnly')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { headers: responseHeaders })),
    )
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>

    await expect(
      handler(
        event('POST', new TextEncoder().encode('grant_type=authorization_code'), {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1:6274',
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 502,
      data: { code: 'BCN_AUTH_PROXY_TOKEN_COOKIE_REJECTED' },
    })
    expect(mocks.responseCookie).not.toHaveBeenCalled()
  })

  it('serves authorization-server metadata cross-origin without credentialed CORS', async () => {
    mocks.requestUrl.mockReturnValue(
      new URL('https://app.example.test/.well-known/oauth-authorization-server/api/auth'),
    )
    const fetchMock = vi.fn(
      async () =>
        new Response('{}', {
          headers: {
            'access-control-allow-credentials': 'true',
            'access-control-allow-origin': 'https://upstream.example.test',
            'content-type': 'application/json',
          },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const handler = (
      await import('../../src/runtime/server/api/auth/authorization-server-metadata')
    ).default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
    const metadataRequest = event('GET', undefined, { origin: 'http://127.0.0.1:6274' })

    await handler(metadataRequest)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.convex.site/api/auth/.well-known/oauth-authorization-server',
      expect.anything(),
    )
    expect(mocks.responseHeaders).toHaveBeenCalledWith(metadataRequest, {
      'access-control-allow-origin': '*',
    })
    expect(mocks.responseHeaders).not.toHaveBeenCalledWith(expect.anything(), {
      'access-control-allow-credentials': expect.anything(),
    })
    expect(mocks.responseHeaders).not.toHaveBeenCalledWith(expect.anything(), {
      'access-control-allow-origin': 'https://upstream.example.test',
    })
  })

  it('serves credential-free JWKS to server verifiers without browser ingress metadata', async () => {
    mocks.requestUrl.mockReturnValue(new URL('https://app.example.test/api/auth/jwks'))
    const fetchMock = vi.fn(async () => new Response('{"keys":[]}'))
    vi.stubGlobal('fetch', fetchMock)
    const handler = (await import('../../src/runtime/server/api/auth/jwks')).default as unknown as (
      input: ReturnType<typeof event>,
    ) => Promise<Uint8Array>
    const jwksRequest = event('GET', undefined, {
      'cf-connecting-ip': '',
      origin: '',
    })

    await handler(jwksRequest)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.convex.site/api/auth/jwks',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'x-bcn-client-ip': expect.anything(),
          'x-bcn-client-ip-signature': expect.anything(),
        }),
      }),
    )
    expect(mocks.responseHeaders).toHaveBeenCalledWith(jwksRequest, {
      'access-control-allow-origin': '*',
    })
  })

  it('rejects credentials on the public JWKS route', async () => {
    mocks.requestUrl.mockReturnValue(new URL('https://app.example.test/api/auth/jwks'))
    const fetchMock = vi.fn(async () => new Response('{"keys":[]}'))
    vi.stubGlobal('fetch', fetchMock)
    const handler = (await import('../../src/runtime/server/api/auth/jwks')).default as unknown as (
      input: ReturnType<typeof event>,
    ) => Promise<Uint8Array>

    await expect(
      handler(
        event('GET', undefined, {
          'cf-connecting-ip': '',
          cookie: 'better-auth.session_token=secret',
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'BCN_AUTH_PROXY_METADATA_CREDENTIAL_REJECTED' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects credentials entering or leaving public authorization-server metadata', async () => {
    mocks.requestUrl.mockReturnValue(
      new URL('https://app.example.test/.well-known/oauth-authorization-server/api/auth'),
    )
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const handler = (
      await import('../../src/runtime/server/api/auth/authorization-server-metadata')
    ).default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>

    const credentialHeaders: Record<string, string>[] = [
      { cookie: 'better-auth.session_token=secret' },
      { authorization: 'Bearer secret', origin: 'http://127.0.0.1:6274' },
      { dpop: 'proof', origin: 'http://127.0.0.1:6274' },
      { 'proxy-authorization': 'Basic secret', origin: 'http://127.0.0.1:6274' },
    ]
    for (const headers of credentialHeaders) {
      await expect(handler(event('GET', undefined, headers))).rejects.toMatchObject({
        statusCode: 403,
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
    const metadataRequest = event('GET', undefined, { origin: 'http://127.0.0.1:6274' })
    await expect(handler(metadataRequest)).rejects.toMatchObject({
      statusCode: 502,
      data: { code: 'BCN_AUTH_PROXY_METADATA_COOKIE_REJECTED' },
    })
    expect(mocks.responseCookie).not.toHaveBeenCalled()
    expect(mocks.responseHeaders).toHaveBeenCalledWith(metadataRequest, {
      'access-control-allow-origin': '*',
    })
    expect(mocks.responseHeaders).not.toHaveBeenCalledWith(expect.anything(), {
      'access-control-allow-credentials': expect.anything(),
    })
    expect(mocks.responseHeaders).not.toHaveBeenCalledWith(expect.anything(), {
      'access-control-allow-origin': 'https://upstream.example.test',
    })
  })

  it('rejects framed GET and encoded POST bodies before fetch and closes the connection', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>

    const framedGet = event('GET', undefined, { 'content-length': '1' })
    framedGet.node.req.complete = false
    await expect(handler(framedGet)).rejects.toMatchObject({
      statusCode: 400,
      data: { code: 'BCN_AUTH_PROXY_GET_BODY_REJECTED' },
    })
    expect(framedGet.node.res.shouldKeepAlive).toBe(false)

    mocks.requestUrl.mockReturnValue(new URL('https://app.example.test/api/auth/plugin/action'))
    const encodedPost = event('POST', new Uint8Array([1]), { 'content-encoding': 'gzip' })
    await expect(handler(encodedPost)).rejects.toMatchObject({
      statusCode: 415,
      data: { code: 'BCN_AUTH_PROXY_REQUEST_ENCODING_UNSUPPORTED' },
    })
    expect(encodedPost.node.res.shouldKeepAlive).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.responseHeaders).toHaveBeenCalledWith(framedGet, {
      'cache-control': 'private, no-store',
    })
    expect(mocks.responseHeaders).toHaveBeenCalledWith(encodedPost, {
      'cache-control': 'private, no-store',
    })
  })

  it('cancels an upstream response with an unsupported content encoding', async () => {
    const cancel = vi.fn()
    vi.stubGlobal(
      'fetch',
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
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>

    await expect(handler(event())).rejects.toMatchObject({
      statusCode: 502,
      data: { code: 'BCN_AUTH_PROXY_UPSTREAM_ENCODING_UNSUPPORTED' },
    })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    expect(mocks.responseHeaders).toHaveBeenCalledWith(expect.anything(), {
      'cache-control': 'private, no-store',
    })
  })

  it('preserves missing-origin GET callback semantics', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 302 }))
    vi.stubGlobal('fetch', fetchMock)
    mocks.requestUrl.mockReturnValue(
      new URL('https://app.example.test/api/auth/callback/github?code=opaque&state=opaque'),
    )
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
    const callback = event('GET')
    callback.headers.delete('origin')
    callback.headers.set('referer', 'https://github.com/')
    callback.headers.set('sec-fetch-site', 'cross-site')

    await handler(callback)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.convex.site/api/auth/callback/github?code=opaque&state=opaque',
      expect.anything(),
    )
  })

  it('forwards only the exact core Apple-style form_post callback shape', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 302 }))
    vi.stubGlobal('fetch', fetchMock)
    mocks.requestUrl.mockReturnValue(new URL('https://app.example.test/api/auth/callback/apple'))
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
    const body = new TextEncoder().encode('code=opaque&state=opaque')
    const callbackHeaders = {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://appleid.apple.com',
      referer: 'https://appleid.apple.com/',
      'sec-fetch-site': 'cross-site',
    }

    await handler(event('POST', body, callbackHeaders))

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.convex.site/api/auth/callback/apple',
      expect.objectContaining({
        body: expect.any(ArrayBuffer),
        redirect: 'manual',
      }),
    )

    fetchMock.mockClear()
    mocks.requestUrl.mockReturnValue(
      new URL('https://app.example.test/api/auth/callback/apple/extra'),
    )
    await expect(handler(event('POST', body, callbackHeaders))).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the deadline active while the upstream body is stalled', async () => {
    vi.useFakeTimers()
    try {
      const cancel = vi.fn()
      vi.stubGlobal(
        'fetch',
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
      const handler = (await import('../../src/runtime/server/api/auth/[...]'))
        .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
      const response = expect(handler(event())).rejects.toMatchObject({ statusCode: 502 })
      await vi.advanceTimersByTimeAsync(8_001)
      await response
      expect(cancel).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let continuous response chunks extend the wall-clock deadline', async () => {
    vi.useFakeTimers()
    try {
      let timer: ReturnType<typeof setTimeout> | undefined
      const cancel = vi.fn(() => {
        if (timer) clearTimeout(timer)
      })
      vi.stubGlobal(
        'fetch',
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
      const handler = (await import('../../src/runtime/server/api/auth/[...]'))
        .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
      const response = expect(handler(event())).rejects.toMatchObject({ statusCode: 502 })

      await vi.advanceTimersByTimeAsync(8_001)

      await response
      expect(cancel).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels unread critical-error and declared-oversize upstream bodies', async () => {
    const criticalCancel = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new ReadableStream({ start() {}, cancel: criticalCancel }), {
            status: 500,
          }),
      ),
    )
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>

    await expect(handler(event())).rejects.toMatchObject({
      statusCode: 502,
      data: { code: 'BCN_AUTH_PROXY_UPSTREAM_STATUS' },
    })
    expect(criticalCancel).toHaveBeenCalledOnce()

    const oversizeCancel = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new ReadableStream({ start() {}, cancel: oversizeCancel }), {
            headers: { 'content-length': '1048577' },
          }),
      ),
    )
    await expect(handler(event())).rejects.toMatchObject({
      statusCode: 502,
      data: { code: 'BCN_AUTH_PROXY_UPSTREAM_BODY_TOO_LARGE' },
    })
    expect(oversizeCancel).toHaveBeenCalledOnce()
  })

  it('propagates browser disconnects during upload and fetch with deterministic cleanup', async () => {
    const uploadCancel = vi.fn()
    const upload = event(
      'POST',
      new ReadableStream({
        pull() {
          // Keep the upload pending until the browser disconnects.
        },
        cancel: uploadCancel,
      }),
    )
    upload.node.req.complete = false
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
    const uploadResult = expect(handler(upload)).rejects.toMatchObject({ statusCode: 502 })

    await Promise.resolve()
    upload.node.req.emit('aborted')
    await uploadResult
    expect(uploadCancel).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upload.node.res.shouldKeepAlive).toBe(false)
    expect(upload.node.req.listenerCount('aborted')).toBe(0)
    expect(upload.node.res.listenerCount('close')).toBe(0)

    let upstreamSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
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
    const fetchResult = expect(handler(duringFetch)).rejects.toMatchObject({ statusCode: 502 })
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined())
    duringFetch.node.res.emit('close')

    await fetchResult
    expect(upstreamSignal?.aborted).toBe(true)
    expect(duringFetch.node.req.listenerCount('aborted')).toBe(0)
    expect(duringFetch.node.res.listenerCount('close')).toBe(0)
  })

  it('keeps the deadline and disconnect signal active until the Node response finishes', async () => {
    let upstreamSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_target: string, init?: RequestInit) => {
        upstreamSignal = init?.signal ?? undefined
        return new Response('bounded')
      }),
    )
    const download = event()
    download.node.res.socket = {} as never
    download.node.res.end = vi.fn()
    download.node.res.destroy = vi.fn()
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
    const result = expect(handler(download)).rejects.toMatchObject({ statusCode: 502 })

    await vi.waitFor(() => expect(download.node.res.end).toHaveBeenCalledOnce())
    expect(upstreamSignal?.aborted).toBe(false)
    download.node.res.emit('close')

    await result
    expect(upstreamSignal?.aborted).toBe(true)
    expect(download.node.res.destroy).toHaveBeenCalledOnce()
    expect(download.node.req.listenerCount('aborted')).toBe(0)
    expect(download.node.res.listenerCount('close')).toBe(0)
  })

  it('drops upstream failure message, cause, and stack from proxy responses', async () => {
    const sentinels = {
      message: 'AUTH_PROXY_MESSAGE_SENTINEL_f7d120',
      cause: 'AUTH_PROXY_CAUSE_SENTINEL_c3550a',
      stack: 'AUTH_PROXY_STACK_SENTINEL_9b70ee',
    }
    const upstreamError = new Error(sentinels.message, { cause: new Error(sentinels.cause) })
    upstreamError.stack = sentinels.stack
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw upstreamError
      }),
    )
    const handler = (await import('../../src/runtime/server/api/auth/[...]'))
      .default as unknown as (input: ReturnType<typeof event>) => Promise<Uint8Array>
    let rejection: unknown
    try {
      await handler(event())
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({
      statusCode: 502,
      message: expect.stringContaining('configured Convex auth server'),
      data: { code: 'BCN_AUTH_PROXY_UNREACHABLE' },
    })
    const rendered = inspect(rejection, { depth: null })
    for (const sentinel of Object.values(sentinels)) expect(rendered).not.toContain(sentinel)
  })
})
