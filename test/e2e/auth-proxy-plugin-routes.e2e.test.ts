import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { fileURLToPath } from 'node:url'

import { $fetch, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'

type CapturedRequest = {
  body: string
  headers: IncomingMessage['headers']
  method: string | undefined
  url: string | undefined
}

const capturedRequests: CapturedRequest[] = []

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

async function startAuthUpstream() {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readRequestBody(req)
    capturedRequests.push({
      body,
      headers: req.headers,
      method: req.method,
      url: req.url,
    })

    res.statusCode = 201
    res.setHeader('content-type', 'application/json')
    res.setHeader('set-cookie', 'better-auth.session_token=plugin-route; Path=/; HttpOnly')
    res.end(JSON.stringify({ ok: true, route: req.url }))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start auth upstream')
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  }
}

const upstream = await startAuthUpstream()

function requestNitro(
  path: string,
  options: {
    body?: string
    headers?: Record<string, string> | string[]
    method?: string
  } = {},
): Promise<number> {
  const target = new URL(url(path))
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: options.method || 'GET',
        headers: options.headers,
      },
      (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode || 0))
      },
    )
    request.on('error', reject)
    request.end(options.body)
  })
}

describe('auth proxy plugin routes', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/basic', import.meta.url)),
    nuxtConfig: {
      convex: {
        url: 'https://demo.convex.cloud',
        siteUrl: upstream.url,
        auth: { origin: 'http://localhost:3000' },
      },
    },
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      upstream.server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  })

  it('forwards schema-changing Better Auth plugin routes without special-casing core auth endpoints', async () => {
    const response = await $fetch('/api/auth/organization/create?source=e2e', {
      method: 'POST',
      body: {
        name: 'Trellis Labs',
        slug: 'trellis-labs',
      },
      headers: {
        cookie: 'better-auth.session_token=e2e-session; private_app_cookie=secret',
      },
    })

    expect(response).toEqual({
      ok: true,
      route: '/api/auth/organization/create?source=e2e',
    })

    const request = capturedRequests.at(-1)
    expect(request).toMatchObject({
      method: 'POST',
      url: '/api/auth/organization/create?source=e2e',
    })
    expect(request?.headers.cookie).toContain('better-auth.session_token=e2e-session')
    expect(request?.headers.cookie).not.toContain('private_app_cookie')
    expect(JSON.parse(request?.body || '{}')).toEqual({
      name: 'Trellis Labs',
      slug: 'trellis-labs',
    })
  })

  it('rejects cross-origin and unsupported-method requests at the real Nitro boundary', async () => {
    const requestCount = capturedRequests.length
    await expect(
      $fetch('/api/auth/get-session', {
        headers: { origin: 'https://evil.example.test' },
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect($fetch('/api/auth/get-session', { method: 'DELETE' })).rejects.toMatchObject({
      statusCode: 405,
    })
    expect(capturedRequests).toHaveLength(requestCount)
  })

  it('removes attacker forwarding controls before the real upstream request', async () => {
    await $fetch('/api/auth/get-session', {
      headers: {
        'x-forwarded-for': '10.0.0.1',
        'x-forwarded-host': 'evil.example.test',
        'x-better-auth-forwarded-host': 'evil.example.test',
        'x-bcn-client-ip': '10.0.0.2',
        'x-bcn-client-ip-signature': 'forged-signature',
        'x-bcn-verified-client-ip': '10.0.0.3',
      },
    })
    const request = capturedRequests.at(-1)
    expect(request?.headers['x-forwarded-for']).toBeUndefined()
    expect(request?.headers['x-forwarded-host']).toBeUndefined()
    expect(request?.headers['x-better-auth-forwarded-host']).toBeUndefined()
    expect(request?.headers['x-better-auth-forwarded-proto']).toBeUndefined()
    expect(request?.headers['x-bcn-client-ip']).toBeUndefined()
    expect(request?.headers['x-bcn-client-ip-signature']).toBeUndefined()
    expect(request?.headers['x-bcn-verified-client-ip']).toBeUndefined()
  })

  it('removes Connection-nominated and transport-owned request headers', async () => {
    const status = await requestNitro('/api/auth/plugin/action', {
      body: '{}',
      headers: {
        'accept-encoding': 'unknown',
        connection: 'keep-alive, x-hop',
        'content-encoding': 'identity',
        'content-length': '2',
        'content-type': 'application/json',
        'proxy-connection': 'keep-alive',
        'x-hop': 'must-not-forward',
      },
      method: 'POST',
    })
    expect(status).toBe(201)

    const request = capturedRequests.at(-1)
    expect(request?.headers['accept-encoding']).not.toBe('unknown')
    expect(request?.headers['content-encoding']).toBeUndefined()
    expect(request?.headers['proxy-connection']).toBeUndefined()
    expect(request?.headers['x-hop']).toBeUndefined()
    expect(request?.body).toBe('{}')
  })

  it('denies forged or duplicate public-host inputs before upstream delivery', async () => {
    const requestCount = capturedRequests.length
    const firstStatus = await requestNitro('/api/auth/get-session', {
      headers: {
        host: 'evil.example.test',
        origin: 'https://evil.example.test',
        forwarded: 'for=10.0.0.1;host=forwarded.example;proto=http',
        'x-forwarded-for': '10.0.0.2',
        'x-forwarded-host': 'x-forwarded.example',
        'x-forwarded-proto': 'https',
        'x-real-ip': '10.0.0.3',
        'x-original-host': 'original.example',
        'x-vercel-forwarded-host': 'vercel.example',
        'x-better-auth-forwarded-host': 'marker.example',
        'x-better-auth-forwarded-proto': 'http',
      },
    })
    expect(firstStatus).toBe(403)

    const duplicateStatus = await requestNitro('/api/auth/get-session', {
      headers: [
        'Host',
        'first.example.test',
        'Host',
        'second.example.test',
        'Origin',
        'http://first.example.test',
      ],
    })
    expect(duplicateStatus).toBe(403)
    expect(capturedRequests).toHaveLength(requestCount)
  })

  it('blocks cross-site POST evidence but preserves the exact core form_post callback', async () => {
    const start = capturedRequests.length
    const targetOrigin = new URL(url('/')).origin

    expect(
      await requestNitro('/api/auth/sign-in/social', {
        headers: { referer: 'https://evil.example/form' },
        method: 'POST',
      }),
    ).toBe(403)
    expect(
      await requestNitro('/api/auth/sign-in/social', {
        headers: { origin: targetOrigin, 'sec-fetch-site': 'same-site' },
        method: 'POST',
      }),
    ).toBe(403)
    expect(capturedRequests).toHaveLength(start)

    expect(
      await requestNitro('/api/auth/callback/apple', {
        body: 'code=opaque&state=opaque',
        headers: {
          'content-length': '24',
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://appleid.apple.com',
          referer: 'https://appleid.apple.com/',
          'sec-fetch-site': 'cross-site',
        },
        method: 'POST',
      }),
    ).toBe(201)
    expect(capturedRequests.at(-1)?.url).toBe('/api/auth/callback/apple')
  })
})
