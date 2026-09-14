import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  requestUrl: vi.fn(),
  responseHeaders: vi.fn(),
  responseStatus: vi.fn(),
  storage: vi.fn(),
}))

vi.mock('h3', () => ({
  appendResponseHeader: vi.fn(),
  createError(input: { statusCode: number; message: string; data?: unknown }) {
    return Object.assign(new Error(input.message), input)
  },
  defineEventHandler: (handler: unknown) => handler,
  getRequestURL: mocks.requestUrl,
  getRequestWebStream: () => undefined,
  send: (_event: unknown, body: Uint8Array) => body,
  setHeaders: mocks.responseHeaders,
  setResponseStatus: mocks.responseStatus,
}))
vi.mock('../../src/runtime/utils/runtime-config', () => ({
  getConvexRuntimeConfig: mocks.config,
}))
vi.mock('nitropack/runtime', () => ({ useStorage: mocks.storage }))

function event(method = 'GET', headers: Record<string, string> = {}) {
  return {
    method,
    headers: new Headers({
      origin: 'https://app.example.test',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'document',
      accept: 'text/html,application/xhtml+xml',
      ...headers,
    }),
    node: {
      req: Object.assign(new EventEmitter(), {
        complete: true,
        pause: vi.fn(),
        resume: vi.fn(),
      }),
      res: Object.assign(new EventEmitter(), {
        destroy: vi.fn(),
        end: vi.fn(),
        headersSent: false,
        shouldKeepAlive: true,
        writableFinished: false,
      }),
    },
  }
}

async function handler() {
  return (await import('../../src/runtime/server/api/auth/[...]')).default as unknown as (
    input: ReturnType<typeof event>,
  ) => Promise<unknown>
}

describe('hosted OAuth navigation response negotiation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requestUrl.mockReturnValue(new URL('https://app.example.test/api/auth/oauth2/authorize'))
    mocks.config.mockReturnValue({
      siteUrl: 'https://demo.convex.site',
      auth: { origin: 'https://app.example.test', trustedClientIpHeader: null },
    })
    mocks.storage.mockReturnValue({
      getItem: vi.fn().mockResolvedValue([]),
      setItem: vi.fn(),
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

      await (
        await handler()
      )(request)

      expect(upstream).toHaveBeenCalledOnce()
      expect(upstream.mock.calls[0]?.[1]).toMatchObject({
        mode: 'same-origin',
        redirect: 'manual',
      })
      expect(mocks.responseStatus).toHaveBeenCalledWith(request, 302, '')
      expect(mocks.responseHeaders).toHaveBeenCalledWith(request, {
        location: 'https://app.example.test/oauth/login',
      })
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
    mocks.requestUrl.mockReturnValue(new URL(`https://app.example.test/api/auth${path}`))
    const upstream = vi.fn(async () => Response.json({ redirect: true }))
    vi.stubGlobal('fetch', upstream)
    await (
      await handler()
    )(event(method, headers))
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
      mocks.requestUrl.mockReturnValue(new URL(`https://app.example.test/api/auth${path}`))
      const upstream = vi.fn()
      vi.stubGlobal('fetch', upstream)
      await expect(
        (await handler())(event(method, { origin: 'https://evil.example.test' })),
      ).rejects.toMatchObject({
        statusCode: 403,
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
    mocks.requestUrl.mockReturnValue(
      new URL(`https://app.example.test/api/auth/oauth2/authorize?${query}`),
    )
    const upstream = vi.fn(async () => Response.json({ error: 'invalid_request' }, { status: 400 }))
    vi.stubGlobal('fetch', upstream)
    const request = event()
    await (
      await handler()
    )(request)
    expect(upstream).toHaveBeenCalledWith(
      `https://demo.convex.site/api/auth/oauth2/authorize?${query}`,
      expect.objectContaining({ mode: 'same-origin', redirect: 'manual' }),
    )
    expect(mocks.responseStatus).toHaveBeenCalledWith(request, 400, '')
    expect(mocks.responseHeaders.mock.calls.some(([, headers]) => 'location' in headers)).toBe(
      false,
    )
  })
})
