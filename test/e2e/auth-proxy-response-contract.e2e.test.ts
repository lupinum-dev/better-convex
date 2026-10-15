import { createServer, request as httpRequest, type IncomingMessage } from 'node:http'
import { fileURLToPath } from 'node:url'

import { setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * The proxy returns a web `Response`. h3 1.x (Nuxt 4) and h3 2.x (Nuxt 5) both
 * send a returned Response, but h3 2.x ignores event-level headers on a
 * returned error status and the server renders thrown errors itself. This
 * suite pins what must reach the browser on both: status, status text,
 * repeated Set-Cookie lines, `private, no-store` (also on error statuses and
 * on a rejected HTML navigation, which the server renders as an error page),
 * content-length framing, and an empty body for 204 and 304.
 */

const SESSION_COOKIES = [
  'better-auth.session_token=a; Path=/; HttpOnly',
  'better-auth.state=b; Path=/; HttpOnly',
]

const upstreamPaths: string[] = []
const upstream = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://upstream.test').pathname
  upstreamPaths.push(path)
  res.setHeader('cache-control', 'public, max-age=60')
  if (path === '/api/auth/_204') {
    res.statusCode = 204
    res.setHeader('set-cookie', SESSION_COOKIES)
    res.end()
  } else if (path === '/api/auth/_304') {
    res.statusCode = 304
    res.setHeader('x-upstream', 'kept')
    res.end()
  } else if (path === '/api/auth/_empty') {
    res.end()
  } else if (path === '/api/auth/_body') {
    res.setHeader('content-type', 'text/plain')
    res.setHeader('set-cookie', SESSION_COOKIES)
    res.end('hello')
  } else if (path === '/api/auth/_invalid-credentials') {
    res.statusCode = 401
    res.statusMessage = 'Invalid Credentials'
    res.setHeader('content-type', 'application/json')
    res.setHeader('set-cookie', SESSION_COOKIES)
    res.end('{"code":"INVALID_EMAIL_OR_PASSWORD"}')
  } else {
    res.statusCode = 500
    res.end('unexpected')
  }
})
await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
const address = upstream.address()
if (!address || typeof address === 'string') throw new Error('Failed to bind auth upstream')

function send(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  const target = new URL(url(path))
  return new Promise<{
    body: string
    headers: IncomingMessage['headers']
    message: string | undefined
    status: number
  }>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: init.method ?? 'GET',
        headers: init.headers,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString(),
            headers: response.headers,
            message: response.statusMessage,
            status: response.statusCode || 0,
          }),
        )
      },
    )
    request.on('error', reject)
    request.end(init.body)
  })
}

describe('auth proxy response contract', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/basic', import.meta.url)),
    nuxtConfig: {
      convex: {
        url: 'https://demo.convex.cloud',
        siteUrl: `http://127.0.0.1:${address.port}`,
        auth: { origin: 'http://localhost:3000' },
      },
    },
  })

  afterAll(() => new Promise<void>((resolve) => upstream.close(() => resolve())))

  it('sends 204 with both cookies, no body and no content-length', async () => {
    const response = await send('/api/auth/_204')
    expect(response.status).toBe(204)
    expect(response.body).toBe('')
    expect(response.headers['content-length']).toBeUndefined()
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.headers['set-cookie']).toEqual(SESSION_COOKIES)
  })

  it('sends 304 with its headers and no body', async () => {
    const response = await send('/api/auth/_304')
    expect(response.status).toBe(304)
    expect(response.body).toBe('')
    expect(response.headers['x-upstream']).toBe('kept')
    expect(response.headers['cache-control']).toBe('private, no-store')
  })

  it('frames an empty 200 and a body response with content-length, never chunked', async () => {
    const empty = await send('/api/auth/_empty')
    expect(empty.status).toBe(200)
    expect(empty.headers['content-length']).toBe('0')
    expect(empty.headers['transfer-encoding']).toBeUndefined()
    expect(empty.headers['cache-control']).toBe('private, no-store')

    const filled = await send('/api/auth/_body')
    expect(filled.body).toBe('hello')
    expect(filled.headers['content-length']).toBe('5')
    expect(filled.headers['transfer-encoding']).toBeUndefined()
    expect(filled.headers['cache-control']).toBe('private, no-store')
    expect(filled.headers['set-cookie']).toEqual(SESSION_COOKIES)
  })

  it('keeps status text, body, cookies and no-store on an upstream error status', async () => {
    const response = await send('/api/auth/_invalid-credentials')
    expect(response.status).toBe(401)
    expect(response.message).toBe('Invalid Credentials')
    expect(response.body).toBe('{"code":"INVALID_EMAIL_OR_PASSWORD"}')
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.headers['set-cookie']).toEqual(SESSION_COOKIES)
  })

  // A cross-site form posting to the proxy is a browser navigation: the
  // server renders the rejection as an HTML error page, which must stay out
  // of shared caches like every other proxy answer.
  it('keeps no-store on a rejected HTML navigation', async () => {
    const before = upstreamPaths.length
    const response = await send('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://evil.example.test',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'cross-site',
      },
      body: 'email=a%40example.test',
    })
    expect(response.status).toBe(403)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(upstreamPaths.length).toBe(before)
  })
})
