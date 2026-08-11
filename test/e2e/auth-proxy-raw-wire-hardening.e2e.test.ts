import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'

const BODY_LIMIT = 1_048_576
const OAUTH_TOKEN_BODY_LIMIT = 16 * 1024
const PUBLIC_ORIGIN = 'http://localhost:3000'
const redirectDestinations = new Map([
  ['relative', '/redirect-target'],
  ['http', 'http://redirect-target.example.invalid/callback'],
  ['https', 'https://redirect-target.example.invalid/callback'],
  ['link-local', 'http://169.254.169.254/latest/meta-data/iam/security-credentials/'],
  ['protocol-relative', '//redirect-target.example.invalid/callback'],
  ['ftp', 'ftp://redirect-target.example.invalid/callback'],
  ['data', 'data:text/plain,not-followed'],
])

interface CapturedRequest {
  body: Buffer
  headers: IncomingHttpHeaders
  method: string | undefined
  url: string | undefined
}

interface WireResponse {
  body: Buffer
  headers: IncomingHttpHeaders
  rawHeaders: string[]
  status: number
}

const capturedRequests: CapturedRequest[] = []
let activeCriticalResponses = 0
let closedCriticalResponses = 0
let peakCriticalResponses = 0
let closedDomainCookieResponses = 0

function readBody(request: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

async function startUpstream() {
  const server = createServer(async (request, response) => {
    const body = await readBody(request)
    capturedRequests.push({
      body,
      headers: request.headers,
      method: request.method,
      url: request.url,
    })

    const requestUrl = new URL(request.url || '/', 'http://upstream.invalid')
    if (
      requestUrl.pathname === '/api/auth/get-session' &&
      requestUrl.searchParams.get('fault') === 'endless-500'
    ) {
      activeCriticalResponses += 1
      peakCriticalResponses = Math.max(peakCriticalResponses, activeCriticalResponses)
      response.once('close', () => {
        activeCriticalResponses -= 1
        closedCriticalResponses += 1
      })
      response.statusCode = 500
      response.flushHeaders()
      return
    }

    if (requestUrl.pathname === '/redirect-target') {
      response.statusCode = 418
      response.end('redirect-followed')
      return
    }

    if (requestUrl.pathname === '/api/auth/_redirect') {
      const destination = redirectDestinations.get(
        requestUrl.searchParams.get('destinationKey') ?? '',
      )
      if (!destination) {
        response.statusCode = 400
        response.end('unknown redirect destination')
        return
      }
      response.statusCode = Number(requestUrl.searchParams.get('status'))
      response.setHeader('location', destination)
      response.setHeader('set-cookie', [
        'better-auth.redirect_state=one; Path=/; HttpOnly; SameSite=Lax',
        'better-auth.redirect_nonce=two; Path=/; HttpOnly; SameSite=Lax',
      ])
      response.end('redirect')
      return
    }

    if (requestUrl.pathname === '/api/auth/_multiple-cookies') {
      response.setHeader('content-type', 'application/json')
      response.setHeader('set-cookie', [
        'better-auth.session_token=one; Path=/; HttpOnly; SameSite=Lax',
        'better-auth.callback=two; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/; HttpOnly',
        'better-auth.state=three; Max-Age=300; Path=/; Secure; HttpOnly; SameSite=Lax',
      ])
      response.end('{"ok":true}')
      return
    }

    if (requestUrl.pathname === '/api/auth/_domain-cookie') {
      response.once('close', () => {
        closedDomainCookieResponses += 1
      })
      response.setHeader(
        'set-cookie',
        'better-auth.session_token=one; Domain=.example.test; Path=/; Secure; HttpOnly',
      )
      response.flushHeaders()
      return
    }

    if (requestUrl.pathname === '/api/auth/_unsupported-cookie') {
      response.setHeader('set-cookie', 'custom.session_token=one; Path=/; Secure; HttpOnly')
      response.end('unsupported-cookie')
      return
    }

    if (requestUrl.pathname === '/api/auth/_unsafe-response-headers') {
      response.setHeader('cache-control', 'public, max-age=86400')
      response.setHeader('cdn-cache-control', 'public, s-maxage=86400')
      response.setHeader('vercel-cdn-cache-control', 'public, s-maxage=86400')
      response.setHeader('cloudflare-cdn-cache-control', 'public, s-maxage=86400')
      response.setHeader('surrogate-control', 'max-age=86400')
      response.setHeader('edge-control', 'cache-maxage=1d')
      response.setHeader('x-accel-expires', '86400')
      response.setHeader('expires', 'Wed, 21 Oct 2037 07:28:00 GMT')
      response.setHeader('connection', 'keep-alive, x-upstream-hop')
      response.setHeader('x-upstream-hop', 'must-not-survive')
      response.end('private')
      return
    }

    if (requestUrl.pathname === '/api/auth/.well-known/oauth-authorization-server') {
      response.setHeader('access-control-allow-credentials', 'true')
      response.setHeader('access-control-allow-origin', 'https://upstream.example.test')
      if (request.headers['x-test-metadata-cookie'] === '1') {
        response.setHeader(
          'set-cookie',
          'better-auth.session_token=metadata-secret; Path=/; HttpOnly; SameSite=Lax',
        )
      }
      response.setHeader('content-type', 'application/json')
      response.end('{}')
      return
    }

    if (requestUrl.pathname === '/api/auth/_gzip-over-limit') {
      const compressed = gzipSync(Buffer.alloc(BODY_LIMIT * 2, 97))
      expect(compressed.byteLength).toBeLessThan(BODY_LIMIT)
      response.setHeader('content-encoding', 'gzip')
      response.setHeader('content-length', String(compressed.byteLength))
      response.end(compressed)
      return
    }

    response.statusCode = 200
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ length: body.byteLength, url: request.url }))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to bind proxy upstream')

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  }
}

const upstream = await startUpstream()

function requestProxy(
  path: string,
  options: {
    body?: Buffer
    headers?: Record<string, string>
    method?: string
    slowChunks?: Buffer[]
  } = {},
): Promise<WireResponse> {
  const target = new URL(url('/'))
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        method: options.method || 'GET',
        path,
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          resolve({
            body: Buffer.concat(chunks),
            headers: response.headers,
            rawHeaders: response.rawHeaders,
            status: response.statusCode || 0,
          })
        })
      },
    )
    request.on('error', reject)

    if (options.slowChunks) {
      void (async () => {
        for (const chunk of options.slowChunks || []) {
          request.write(chunk)
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 10))
        }
        request.end()
      })()
      return
    }

    request.end(options.body)
  })
}

function requestProxyRaw(payload: string): Promise<Buffer> {
  const target = new URL(url('/'))

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const socket = createConnection({
      host: target.hostname,
      port: Number(target.port),
    })
    socket.setTimeout(5_000, () => socket.destroy(new Error('Raw proxy request timed out')))
    socket.on('connect', () => socket.end(payload))
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('end', () => resolve(Buffer.concat(chunks)))
    socket.on('error', reject)
  })
}

function requestProxyRawIncomplete(payload: string): Promise<Buffer> {
  const target = new URL(url('/'))

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const socket = createConnection({
      host: target.hostname,
      port: Number(target.port),
    })
    socket.setTimeout(5_000, () => socket.destroy(new Error('Raw proxy request timed out')))
    socket.on('connect', () => socket.write(payload))
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('end', () => resolve(Buffer.concat(chunks)))
    socket.on('error', reject)
  })
}

function rawResponseStatus(response: Buffer): number {
  const match = /^HTTP\/1\.[01] (\d{3})/.exec(response.toString('latin1'))
  if (!match) throw new Error(`Raw proxy response had no HTTP status line: ${response.toString()}`)
  return Number(match[1])
}

function responseHeaderValues(response: WireResponse, name: string): string[] {
  const result: string[] = []
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    if (response.rawHeaders[index]?.toLowerCase() === name.toLowerCase()) {
      result.push(response.rawHeaders[index + 1] || '')
    }
  }
  return result
}

function capturedSince(index: number): CapturedRequest[] {
  return capturedRequests.slice(index)
}

describe('auth proxy direct Node/Nitro raw-wire hardening matrix', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/basic', import.meta.url)),
    nuxtConfig: {
      convex: {
        url: 'https://demo.convex.cloud',
        siteUrl: upstream.url,
        auth: { origin: PUBLIC_ORIGIN },
      },
    },
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      upstream.server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  it('exposes only public OAuth metadata and the credential-free browser token exchange', async () => {
    const clientOrigin = 'http://127.0.0.1:6274'
    const metadataStart = capturedRequests.length
    const authorizationMetadata = await requestProxy(
      '/.well-known/oauth-authorization-server/api/auth',
      { headers: { origin: clientOrigin } },
    )
    expect(authorizationMetadata.status).toBe(200)
    expect(authorizationMetadata.headers['access-control-allow-origin']).toBe('*')
    expect(authorizationMetadata.headers['access-control-allow-credentials']).toBeUndefined()
    expect(capturedSince(metadataStart)).toHaveLength(1)
    expect(capturedRequests.at(-1)?.url).toBe('/api/auth/.well-known/oauth-authorization-server')

    const preflightStart = capturedRequests.length
    const preflight = await requestProxy('/api/auth/oauth2/token', {
      headers: {
        'access-control-request-headers': 'content-type',
        'access-control-request-method': 'POST',
        origin: clientOrigin,
      },
      method: 'OPTIONS',
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('*')
    expect(preflight.headers['access-control-allow-methods']).toBe('POST')
    expect(preflight.headers['access-control-allow-headers']).toBe('content-type')
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined()
    expect(capturedRequests).toHaveLength(preflightStart)

    const body = Buffer.from(
      'grant_type=authorization_code&client_id=public-client&code=opaque&code_verifier=' +
        'v'.repeat(43),
    )
    const token = await requestProxy('/api/auth/oauth2/token', {
      body,
      headers: {
        'content-length': String(body.byteLength),
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        origin: clientOrigin,
        referer: `${clientOrigin}/oauth/callback`,
        'sec-fetch-site': 'cross-site',
      },
      method: 'POST',
    })
    expect(token.status).toBe(200)
    expect(token.headers['access-control-allow-origin']).toBe('*')
    expect(token.headers['access-control-allow-credentials']).toBeUndefined()
    expect(token.headers['set-cookie']).toBeUndefined()
    const deliveredToken = capturedRequests.at(-1)
    expect(deliveredToken?.url).toBe('/api/auth/oauth2/token')
    expect(deliveredToken?.body).toEqual(body)
    expect(deliveredToken?.headers.origin).toBe(PUBLIC_ORIGIN)
    expect(deliveredToken?.headers.referer).toBeUndefined()
    expect(deliveredToken?.headers['sec-fetch-site']).toBeUndefined()
    expect(deliveredToken?.headers.cookie).toBeUndefined()
    expect(deliveredToken?.headers.authorization).toBeUndefined()
  })

  it('keeps public authorization metadata credential-free in both directions', async () => {
    const clientOrigin = 'http://127.0.0.1:6274'
    const metadataDeliveries = () =>
      capturedRequests.filter(
        (request) => request.url === '/api/auth/.well-known/oauth-authorization-server',
      ).length
    const start = metadataDeliveries()
    for (const [name, headers] of [
      ['cookie', { cookie: 'better-auth.session_token=secret', origin: clientOrigin }],
      ['authorization', { authorization: 'Bearer secret', origin: clientOrigin }],
      ['dpop', { dpop: 'proof', origin: clientOrigin }],
      ['proxy-authorization', { 'proxy-authorization': 'Basic secret', origin: clientOrigin }],
    ] as const) {
      const before = metadataDeliveries()
      const response = await requestProxy('/.well-known/oauth-authorization-server/api/auth', {
        headers,
      })
      expect(response.status).toBe(403)
      expect(response.headers['access-control-allow-origin']).toBe('*')
      expect(response.headers['access-control-allow-credentials']).toBeUndefined()
      expect(metadataDeliveries(), name).toBe(before)
    }
    expect(metadataDeliveries()).toBe(start)

    const target = new URL(url('/'))
    const duplicateAuthorization = await requestProxyRaw(
      [
        'GET /.well-known/oauth-authorization-server/api/auth HTTP/1.1',
        `Host: ${target.host}`,
        `Origin: ${clientOrigin}`,
        'Authorization: Bearer one',
        'Authorization: Bearer two',
        'Connection: close',
        '',
        '',
      ].join('\r\n'),
    )
    if (duplicateAuthorization.length > 0) {
      expect([400, 403]).toContain(rawResponseStatus(duplicateAuthorization))
    }
    expect(metadataDeliveries()).toBe(start)

    const upstreamCookie = await requestProxy('/.well-known/oauth-authorization-server/api/auth', {
      headers: { origin: clientOrigin, 'x-test-metadata-cookie': '1' },
    })
    expect(upstreamCookie.status).toBe(502)
    expect(upstreamCookie.headers['access-control-allow-origin']).toBe('*')
    expect(upstreamCookie.headers['access-control-allow-credentials']).toBeUndefined()
    expect(upstreamCookie.headers['set-cookie']).toBeUndefined()
    expect(metadataDeliveries()).toBe(start + 1)
  })

  it('rejects every credential, header, method, path, query, and preflight expansion', async () => {
    const clientOrigin = 'http://127.0.0.1:6274'
    const formHeaders = {
      'content-type': 'application/x-www-form-urlencoded',
      origin: clientOrigin,
    }
    const start = capturedRequests.length

    for (const headers of [
      { ...formHeaders, cookie: 'better-auth.session_token=secret' },
      { ...formHeaders, authorization: 'Basic secret' },
      { ...formHeaders, dpop: 'proof' },
      { ...formHeaders, 'content-type': 'application/json' },
    ]) {
      const response = await requestProxy('/api/auth/oauth2/token', {
        body: Buffer.from('grant_type=authorization_code'),
        headers,
        method: 'POST',
      })
      expect(response.status).toBe(403)
      expect(response.headers['access-control-allow-origin']).toBeUndefined()
    }

    for (const path of [
      '/api/auth/oauth2/token?tenant=attacker',
      '/api/auth/oauth2/revoke',
      '/api/auth/oauth2/authorize',
      '/api/auth/get-session',
      '/api/auth/mcp/admin/provision',
    ]) {
      const response = await requestProxy(path, {
        body: Buffer.from('grant_type=authorization_code'),
        headers: formHeaders,
        method: 'POST',
      })
      expect(response.status).toBe(403)
      expect(response.headers['access-control-allow-origin']).toBeUndefined()
    }

    const wrongMethod = await requestProxy('/api/auth/oauth2/token', {
      headers: { origin: clientOrigin },
      method: 'GET',
    })
    expect(wrongMethod.status).toBe(403)

    const hostilePreflight = await requestProxy('/api/auth/oauth2/token', {
      headers: {
        'access-control-request-headers': 'content-type, authorization',
        'access-control-request-method': 'POST',
        origin: clientOrigin,
      },
      method: 'OPTIONS',
    })
    expect(hostilePreflight.status).toBe(405)
    expect(hostilePreflight.headers['access-control-allow-origin']).toBeUndefined()

    const oversizedBody = Buffer.alloc(OAUTH_TOKEN_BODY_LIMIT + 1, 97)
    const oversized = await requestProxy('/api/auth/oauth2/token', {
      body: oversizedBody,
      headers: {
        ...formHeaders,
        'content-length': String(oversizedBody.byteLength),
      },
      method: 'POST',
    })
    expect(oversized.status).toBe(403)
    expect(oversized.headers['access-control-allow-origin']).toBeUndefined()
    expect(oversized.headers['access-control-allow-credentials']).toBeUndefined()
    expect(capturedRequests).toHaveLength(start)
  })

  it('delivers every redirect status and destination once without a server-side replay', async () => {
    const start = capturedRequests.length

    for (const status of [301, 302, 303, 307, 308]) {
      for (const [destinationKey, destination] of redirectDestinations) {
        const response = await requestProxy(
          `/api/auth/_redirect?status=${status}&destinationKey=${destinationKey}`,
          {
            headers: {
              cookie:
                'better-auth.session_token=redirect-secret; application_cookie=must-not-forward',
            },
          },
        )
        expect(response.status).toBe(status)
        expect(response.headers.location).toBe(destination)
        expect(response.headers['cache-control']).toBe('private, no-store')
        expect(responseHeaderValues(response, 'set-cookie')).toHaveLength(2)
      }
    }

    const delivered = capturedSince(start)
    expect(delivered).toHaveLength(35)
    expect(delivered.every((request) => request.url?.startsWith('/api/auth/_redirect'))).toBe(true)
    expect(
      delivered.every(
        (request) => request.headers.cookie === 'better-auth.session_token=redirect-secret',
      ),
    ).toBe(true)
    expect(delivered.some((request) => request.url === '/redirect-target')).toBe(false)
  })

  it('preserves empty, binary, random, content-typed, and slow chunked request bytes', async () => {
    const cases = [
      { contentType: 'application/json', body: Buffer.from('{"value":"π"}') },
      {
        contentType: 'application/x-www-form-urlencoded',
        body: Buffer.from('a=1&a=2&b=%2F'),
      },
      {
        contentType: 'multipart/form-data; boundary=bcn-boundary',
        body: Buffer.from(
          '--bcn-boundary\r\nContent-Disposition: form-data; name="value"\r\n\r\nhello\r\n--bcn-boundary--\r\n',
        ),
      },
      { contentType: 'text/plain', body: Buffer.from('plain\u0000text') },
      {
        contentType: 'application/octet-stream',
        body: Buffer.from([0, 255, 128, 13, 10, 1]),
      },
    ]

    for (const [index, testCase] of cases.entries()) {
      const response = await requestProxy(`/api/auth/_capture?case=${index}`, {
        body: testCase.body,
        headers: {
          'content-length': String(testCase.body.byteLength),
          'content-type': testCase.contentType,
        },
        method: 'POST',
      })
      expect(response.status, response.body.toString()).toBe(200)
      const captured = capturedRequests.at(-1)
      expect(captured?.body).toEqual(testCase.body)
      expect(captured?.headers['content-type']).toBe(testCase.contentType)
      expect(captured?.headers['content-length']).toBe(String(testCase.body.byteLength))
    }

    const emptyResponse = await requestProxy('/api/auth/_capture?case=empty', {
      body: Buffer.alloc(0),
      headers: {
        'content-length': '0',
        'content-type': 'application/octet-stream',
      },
      method: 'POST',
    })
    expect(emptyResponse.status).toBe(200)
    expect(capturedRequests.at(-1)?.body).toEqual(Buffer.alloc(0))

    let state = 1_592_594_996
    const random = Buffer.alloc(2_049)
    for (let index = 0; index < random.length; index += 1) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      random[index] = state & 255
    }
    const randomResponse = await requestProxy('/api/auth/_capture?case=random', {
      body: random,
      headers: { 'content-length': String(random.byteLength) },
      method: 'POST',
    })
    expect(randomResponse.status).toBe(200)
    expect(capturedRequests.at(-1)?.body).toEqual(random)

    const slowChunks = [Buffer.alloc(1_000, 1), Buffer.alloc(1_000, 2), Buffer.alloc(1_000, 3)]
    const slowResponse = await requestProxy('/api/auth/_capture?case=slow', {
      method: 'POST',
      slowChunks,
    })
    expect(slowResponse.status).toBe(200)
    expect(capturedRequests.at(-1)?.body).toEqual(Buffer.concat(slowChunks))
  })

  it('rejects declared and chunked limit-plus-one bodies before upstream delivery', async () => {
    const start = capturedRequests.length
    const overLimit = Buffer.alloc(BODY_LIMIT + 1, 7)

    const declared = await requestProxy('/api/auth/_capture?case=declared-over', {
      body: overLimit,
      headers: { 'content-length': String(overLimit.byteLength) },
      method: 'POST',
    })
    expect(declared.status).toBe(413)
    expect(declared.headers['cache-control']).toBe('private, no-store')

    const chunked = await requestProxy('/api/auth/_capture?case=chunked-over', {
      body: overLimit,
      method: 'POST',
    })
    expect(chunked.status, chunked.body.toString()).toBe(413)
    expect(capturedSince(start)).toHaveLength(0)
  })

  it('registers exact and wildcard routes without matching near-prefix routes', async () => {
    const start = capturedRequests.length
    for (const [path, expected] of [
      ['/api/auth', '/api/auth/'],
      ['/api/auth?base=1', '/api/auth/?base=1'],
      ['/api/auth/', '/api/auth/'],
      ['/api/auth/get-session', '/api/auth/get-session'],
      ['/api/auth/plugin/action', '/api/auth/plugin/action'],
    ] as const) {
      const response = await requestProxy(path)
      expect(response.status).toBe(200)
      expect(capturedRequests.at(-1)?.url).toBe(expected)
    }
    expect(capturedSince(start)).toHaveLength(5)

    for (const path of ['/api/authentication', '/api/authx', '/api/auth.evil']) {
      const count = capturedRequests.length
      await requestProxy(path)
      expect(capturedRequests).toHaveLength(count)
    }
  })

  it('confines encoded path variants and preserves duplicate and unusual query separators', async () => {
    const pathVariants = [
      '/api/auth/%2e%2e/escape?case=encoded-dot-segment',
      '/api/auth/%2E./escape?case=mixed-dot-segment',
      '/api/auth/.%2e/escape?case=partial-dot-segment',
      '/api/auth/plugin%2Faction?case=encoded-slash',
      '/api/auth/plugin%5Caction?case=encoded-backslash',
      '/api/auth/%252e%252e/%252f/%255c?case=double-encoded',
      '/api/auth//plugin;;;action?case=unusual-path-separators',
    ]

    for (const path of pathVariants) {
      const start = capturedRequests.length
      await requestProxy(path)
      const delivered = capturedSince(start)
      expect(delivered.length).toBeLessThanOrEqual(1)
      for (const request of delivered) {
        expect(request.url).toBeTruthy()
        expect(request.url?.startsWith('/api/auth/')).toBe(true)
        expect(new URL(request.url || '/', upstream.url).pathname.startsWith('/api/auth/')).toBe(
          true,
        )
      }
    }

    const query = '?key=one&key=two&&semi=left;right&empty=&=value&encoded=%252F'
    const response = await requestProxy(`/api/auth/plugin/action${query}`)
    expect(response.status).toBe(200)
    expect(capturedRequests.at(-1)?.url).toBe(`/api/auth/plugin/action${query}`)
  })

  it('rejects ambiguous HTTP request framing before any upstream delivery', async () => {
    const target = new URL(url('/'))
    const start = capturedRequests.length
    const requests = [
      [
        'POST /api/auth/_capture HTTP/1.1',
        `Host: ${target.host}`,
        'Content-Length: 0',
        'Transfer-Encoding: chunked',
        'Connection: close',
        '',
        '0',
        '',
        '',
      ].join('\r\n'),
      [
        'POST /api/auth/_capture HTTP/1.1',
        `Host: ${target.host}`,
        'Content-Length: 0',
        'Content-Length: 0',
        'Connection: close',
        '',
        '',
      ].join('\r\n'),
      [
        'POST /api/auth/_capture HTTP/1.1',
        `Host: ${target.host}`,
        'Content-Length: not-a-number',
        'Connection: close',
        '',
        '',
      ].join('\r\n'),
    ]

    for (const request of requests) {
      const response = await requestProxyRaw(request)
      expect(rawResponseStatus(response)).toBe(400)
    }
    expect(capturedSince(start)).toHaveLength(0)
  })

  it('rejects an incomplete framed GET body without retaining the socket or reaching upstream', async () => {
    const target = new URL(url('/'))
    const start = capturedRequests.length
    const response = await requestProxyRawIncomplete(
      [
        'GET /api/auth/get-session HTTP/1.1',
        `Host: ${target.host}`,
        'Content-Length: 1000000',
        'Connection: keep-alive',
        '',
        'x',
      ].join('\r\n'),
    )

    expect(rawResponseStatus(response)).toBe(400)
    expect(response.toString('latin1').toLowerCase()).toContain('connection: close')
    expect(capturedSince(start)).toHaveLength(0)
  })

  it('rejects encoded request bodies before upstream delivery', async () => {
    const start = capturedRequests.length
    const response = await requestProxy('/api/auth/_capture', {
      body: Buffer.from('compressed-looking-bytes'),
      headers: {
        'content-encoding': 'gzip',
        'content-length': '24',
        'content-type': 'application/json',
      },
      method: 'POST',
    })

    expect(response.status).toBe(415)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(capturedSince(start)).toHaveLength(0)
  })

  it('preserves multiple Set-Cookie field lines, including an Expires comma', async () => {
    const response = await requestProxy('/api/auth/_multiple-cookies')
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(responseHeaderValues(response, 'set-cookie')).toEqual([
      'better-auth.session_token=one; Path=/; HttpOnly; SameSite=Lax',
      'better-auth.callback=two; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/; HttpOnly',
      'better-auth.state=three; Max-Age=300; Path=/; Secure; HttpOnly; SameSite=Lax',
    ])
  })

  it('fails closed on unsupported and Domain-scoped upstream cookies', async () => {
    const unsupported = await requestProxy('/api/auth/_unsupported-cookie')
    expect(unsupported.status).toBe(502)
    expect(responseHeaderValues(unsupported, 'set-cookie')).toEqual([])

    const closedBefore = closedDomainCookieResponses
    const response = await requestProxy('/api/auth/_domain-cookie')
    expect(response.status).toBe(502)
    expect(responseHeaderValues(response, 'set-cookie')).toEqual([])
    await expect.poll(() => closedDomainCookieResponses - closedBefore).toBe(1)
  })

  it('drops upstream shared-cache controls and Connection-nominated response fields', async () => {
    const response = await requestProxy('/api/auth/_unsafe-response-headers')
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    for (const header of [
      'cdn-cache-control',
      'vercel-cdn-cache-control',
      'cloudflare-cdn-cache-control',
      'surrogate-control',
      'edge-control',
      'x-accel-expires',
      'expires',
      'x-upstream-hop',
    ]) {
      expect(response.headers[header], header).toBeUndefined()
    }
  })

  it('enforces the decompressed response limit and removes stale compression framing', async () => {
    const response = await requestProxy('/api/auth/_gzip-over-limit')
    expect(response.status).toBe(502)
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers['content-length']).not.toBe(String(BODY_LIMIT * 2))
  })

  it('cancels repeated critical endless bodies without retaining upstream responses', async () => {
    const closedBefore = closedCriticalResponses
    for (let index = 0; index < 12; index += 1) {
      const response = await requestProxy('/api/auth/get-session?fault=endless-500')
      expect(response.status).toBe(502)
    }

    await expect.poll(() => closedCriticalResponses - closedBefore).toBe(12)
    expect(activeCriticalResponses).toBe(0)
    expect(peakCriticalResponses).toBe(1)
  })
})
