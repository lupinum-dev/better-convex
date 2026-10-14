import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rawH3V1Event } from '../helpers/server-event'

const mocks = vi.hoisted(() => ({ config: vi.fn() }))

vi.mock('../../src/runtime/server/utils/server-config', () => ({
  readServerConvexConfig: mocks.config,
}))

function event(method = 'GET', headers: Record<string, string> = {}, path = '/oauth2/authorize') {
  return rawH3V1Event({
    method,
    path: `/api/auth${path}`,
    headers: {
      origin: 'https://app.example.test',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'document',
      accept: 'text/html,application/xhtml+xml',
      ...headers,
    },
  }).event
}

async function proxy(input: ReturnType<typeof event>) {
  const handler = (await import('../../src/runtime/server/api/auth/[...]')).default
  return handler(input)
}

describe('hosted OAuth navigation response negotiation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.config.mockReturnValue({
      siteUrl: 'https://demo.convex.site',
      auth: { origin: 'https://app.example.test', trustedClientIpHeader: null },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['document', 'iframe'])(
    'preserves the HTTP redirect for a hosted %s navigation',
    async (destination) => {
      const upstream = vi.fn(async (_input: unknown, init?: RequestInit) =>
        init?.mode === 'same-origin'
          ? new Response(null, {
              status: 302,
              headers: { location: 'https://app.example.test/oauth/login' },
            })
          : Response.json({
              redirect: true,
              url: 'https://app.example.test/oauth/login',
            }),
      )
      vi.stubGlobal('fetch', upstream)
      const request = event('GET', { 'sec-fetch-dest': destination })
      const originalHeaders = [...request.headers]

      const response = await proxy(request)

      expect(upstream).toHaveBeenCalledOnce()
      expect(upstream.mock.calls[0]?.[1]).toMatchObject({
        mode: 'same-origin',
        redirect: 'manual',
      })
      expect(response.status).toBe(302)
      expect(response.statusText).toBe('')
      expect(response.headers.get('location')).toBe('https://app.example.test/oauth/login')
      expect([...request.headers]).toEqual(originalHeaders)
    },
  )

  it.each([
    ['GET', '/oauth2/authorize', { 'sec-fetch-dest': 'empty' }],
    ['GET', '/oauth2/authorize', { accept: 'application/json' }],
    ['GET', '/oauth2/authorize', { accept: '*/*' }],
    ['GET', '/oauth2/authorize', { accept: 'text/html;q=0,application/json' }],
    ['GET', '/oauth2/authorize', { accept: 'text/html;q=invalid' }],
    ['GET', '/oauth2/authorize/', {}],
    ['POST', '/oauth2/authorize', {}],
    ['POST', '/oauth2/token', {}],
    ['POST', '/oauth2/consent', {}],
    ['GET', '/get-session', {}],
  ])('keeps fetch negotiation for %s %s %j', async (method, path, headers) => {
    const upstream = vi.fn(async () => Response.json({ redirect: true }))
    vi.stubGlobal('fetch', upstream)
    await proxy(event(method, headers, path))
    expect(upstream).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ mode: 'cors', redirect: 'manual' }),
    )
  })

  it.each([
    ['GET', '/oauth2/authorize'],
    ['POST', '/oauth2/authorize'],
    ['POST', '/oauth2/consent'],
    ['POST', '/sign-in/email'],
  ])(
    'rejects untrusted Origin on %s %s before fetch despite document headers',
    async (method, path) => {
      const upstream = vi.fn()
      vi.stubGlobal('fetch', upstream)
      await expect(
        proxy(event(method, { origin: 'https://evil.example.test' }, path)),
      ).rejects.toMatchObject({
        status: 403,
        data: { code: 'BCN_AUTH_PROXY_ORIGIN_BLOCKED' },
      })
      expect(upstream).not.toHaveBeenCalled()
    },
  )

  // Validation belongs to the OAuth provider; the proxy must neither repair an
  // invalid input nor convert its denial into success when selecting redirects.
  it.each([
    'redirect_uri=https%3A%2F%2Fevil.example.test',
    'scope=unregistered',
    'resource=https%3A%2F%2Fevil.example.test',
  ])('preserves provider denial for %s', async (query) => {
    const upstream = vi.fn(async () => Response.json({ error: 'invalid_request' }, { status: 400 }))
    vi.stubGlobal('fetch', upstream)
    const response = await proxy(event('GET', {}, `/oauth2/authorize?${query}`))
    expect(upstream).toHaveBeenCalledWith(
      `https://demo.convex.site/api/auth/oauth2/authorize?${query}`,
      expect.objectContaining({ mode: 'same-origin', redirect: 'manual' }),
    )
    expect(response.status).toBe(400)
    expect(response.statusText).toBe('')
    expect(response.headers.has('location')).toBe(false)
  })
})
