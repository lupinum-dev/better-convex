import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  requestUrl: vi.fn(),
  responseCookie: vi.fn(),
  responseHeaders: vi.fn(),
  responseStatus: vi.fn(),
  storage: vi.fn(),
}))

vi.mock('h3', () => ({
  appendResponseHeader: mocks.responseCookie,
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
vi.mock('../../src/runtime/utils/runtime-config', () => ({ getConvexRuntimeConfig: mocks.config }))
vi.mock('nitropack/runtime', () => ({ useStorage: mocks.storage }))

function event() {
  return {
    method: 'GET',
    headers: new Headers({
      'cf-connecting-ip': '203.0.113.10',
      origin: 'https://app.example.test',
    }),
    node: {
      req: Object.assign(new EventEmitter(), { complete: true, pause: vi.fn(), resume: vi.fn() }),
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

async function authProxyHandler() {
  return (await import('../../src/runtime/server/api/auth/[...]')).default as unknown as (
    input: ReturnType<typeof event>,
  ) => Promise<Uint8Array>
}

describe('auth proxy cookie policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', 'proxy-ip-test-secret-with-32-bytes')
    mocks.requestUrl.mockReturnValue(new URL('https://app.example.test/api/auth/get-session'))
    mocks.config.mockReturnValue({
      siteUrl: 'https://demo.convex.site',
      auth: {
        origin: 'https://app.example.test',
        trustedClientIpHeader: 'cf-connecting-ip',
      },
    })
    mocks.storage.mockReturnValue({
      getItem: vi.fn().mockResolvedValue([]),
      setItem: vi.fn().mockResolvedValue(undefined),
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('rejects weak session-cookie flags before forwarding them', async () => {
    const cancel = vi.fn()
    const headers = new Headers()
    headers.append(
      'set-cookie',
      '__Secure-better-auth.session_token=one; Path=/; HttpOnly; SameSite=Lax',
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new ReadableStream({ start() {}, cancel }), { headers })),
    )

    await expect((await authProxyHandler())(event())).rejects.toMatchObject({
      statusCode: 502,
      data: { code: 'BCN_AUTH_PROXY_COOKIE_FLAGS_UNSUPPORTED', violation: 'secure-missing' },
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(mocks.responseCookie).not.toHaveBeenCalled()
  })

  it('forwards only the final upstream value for a duplicate cookie name', async () => {
    const headers = new Headers()
    headers.append('set-cookie', 'better-auth.session_token=old; Path=/; HttpOnly; SameSite=Lax')
    headers.append('set-cookie', 'better-auth.session_token=new; Path=/; HttpOnly; SameSite=Lax')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { headers })),
    )

    await (
      await authProxyHandler()
    )(event())

    expect(mocks.responseCookie).toHaveBeenCalledOnce()
    expect(mocks.responseCookie).toHaveBeenCalledWith(
      expect.anything(),
      'set-cookie',
      'better-auth.session_token=new; Path=/; HttpOnly; SameSite=Lax',
    )
  })
})
