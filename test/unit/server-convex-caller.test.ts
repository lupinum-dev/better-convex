import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { inspect } from 'node:util'

import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { createEvent as createH3V1Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConvexCallError } from '../../src/runtime/errors'
import { eventResponseHeaders, type ConvexServerEvent } from '../../src/runtime/server/utils/event'
import {
  applyConvexAuthSsrHeaders,
  mergeVaryCookie,
} from '../../src/runtime/server/utils/ssr-auth-headers'

// ---------------------------------------------------------------------------
// Mocks for the caller's collaborators. ConvexHttpClient, the exchange
// primitive, the SSR auth cache, and runtime config are all replaced so the
// caller-scoped invariants (one client, one token promise, setAuth at most
// once) are observable via call counts.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  ctorCalls: [] as { address: string; options: unknown }[],
  setAuthCalls: [] as string[],
  queryMock: vi.fn(),
  mutationMock: vi.fn(),
  actionMock: vi.fn(),
  exchangeMock: vi.fn(),
  useRuntimeConfigMock: vi.fn(),
}))

vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    constructor(address: string, options: unknown) {
      mocks.ctorCalls.push({ address, options })
    }

    setAuth(token: string) {
      mocks.setAuthCalls.push(token)
    }

    query(...args: unknown[]) {
      return mocks.queryMock(...args)
    }

    mutation(...args: unknown[]) {
      return mocks.mutationMock(...args)
    }

    action(...args: unknown[]) {
      return mocks.actionMock(...args)
    }
  },
}))

vi.mock('../../src/runtime/server/utils/token-exchange', () => ({
  exchangeConvexToken: mocks.exchangeMock,
}))

vi.mock('nuxt/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nuxt/server')>()),
  useRuntimeConfig: mocks.useRuntimeConfigMock,
}))

// Imported after the `vi.mock` calls above for readability (vitest hoists
// `vi.mock` to the top of the module regardless of source position, so this
// ordering has no runtime effect).
// eslint-disable-next-line import/first
import { serverConvex } from '../../src/runtime/server/utils/server-convex-caller'
// eslint-disable-next-line import/first
import { ServerConvexValidationError } from '../../src/runtime/server/utils/server-convex-options'

const SITE_URL = 'https://example.convex.site'
const CONVEX_URL = 'https://example.convex.cloud'
const AUTH_CONFIG = Object.freeze({
  origin: 'http://localhost:3000',
  trustedClientIpHeader: '',
  redirectTo: '/auth/signin',
})

function setConfig(convex: Record<string, unknown>) {
  mocks.useRuntimeConfigMock.mockReturnValue({ public: { convex } })
}

function createEvent(
  cookie?: string,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): ConvexServerEvent {
  return {
    req: new Request('https://app.example.com', {
      headers: { ...headers, ...(cookie ? { cookie } : {}) },
      ...(signal ? { signal } : {}),
    }),
    res: { headers: new Headers() },
    context: {},
  }
}

/** The response headers as lower-case name -> value. */
function responseHeaders(event: ConvexServerEvent): Record<string, string | null> {
  const headers = eventResponseHeaders(event)
  return Object.fromEntries([...new Set(headers.keys())].map((name) => [name, headers.get(name)]))
}

const AUTH_COOKIE = 'better-auth.session_token=session123'

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`
}

/** A display-decodable, unexpired Convex token, as the shared snapshot requires. */
const USER_JWT = makeJwt({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 })

beforeEach(() => {
  mocks.ctorCalls.length = 0
  mocks.setAuthCalls.length = 0
  mocks.queryMock.mockReset()
  mocks.mutationMock.mockReset()
  mocks.actionMock.mockReset()
  mocks.exchangeMock.mockReset()
  setConfig({ url: CONVEX_URL, siteUrl: SITE_URL, auth: AUTH_CONFIG })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type EmptyArgs = Record<string, never>
const queryRef = { _path: 'notes:list' } as unknown as FunctionReference<
  'query',
  'public',
  EmptyArgs,
  unknown
>
const mutationRef = { _path: 'notes:add' } as unknown as FunctionReference<
  'mutation',
  'public',
  EmptyArgs,
  unknown
>
const actionRef = { _path: 'notes:run' } as unknown as FunctionReference<
  'action',
  'public',
  EmptyArgs,
  unknown
>

const serverOperations = [
  ['query', () => mocks.queryMock, (c: ReturnType<typeof serverConvex>) => c.query(queryRef, {})],
  [
    'mutation',
    () => mocks.mutationMock,
    (c: ReturnType<typeof serverConvex>) => c.mutation(mutationRef, {}),
  ],
  [
    'action',
    () => mocks.actionMock,
    (c: ReturnType<typeof serverConvex>) => c.action(actionRef, {}),
  ],
] as const

describe('serverConvex caller-scoped invariants', () => {
  it('creates one token promise, one ConvexHttpClient, and calls setAuth at most once across calls', async () => {
    mocks.exchangeMock.mockResolvedValue({
      token: USER_JWT,
      status: 200,
      error: null,
    })
    mocks.queryMock.mockResolvedValue(['a'])
    mocks.mutationMock.mockResolvedValue('id_1')

    const caller = serverConvex(createEvent(AUTH_COOKIE))
    await caller.query(queryRef, {})
    await caller.mutation(mutationRef, {})
    await caller.query(queryRef, {})

    expect(mocks.exchangeMock).toHaveBeenCalledTimes(1)
    expect(mocks.ctorCalls).toHaveLength(1)
    expect(mocks.ctorCalls[0]?.address).toBe(CONVEX_URL)
    expect(mocks.ctorCalls[0]?.options).toMatchObject({ logger: false })
    expect(mocks.setAuthCalls).toEqual([USER_JWT])
  })

  it('binds Convex response consumption to the incoming request abort signal', async () => {
    const request = new AbortController()
    let upstreamSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input, init) => {
        upstreamSignal = init?.signal ?? undefined
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('partial'))
            },
          }),
        )
      }),
    )
    mocks.queryMock.mockResolvedValue(null)

    await serverConvex(createEvent(undefined, {}, request.signal), { auth: 'none' }).query(
      queryRef,
      {},
    )
    const boundedFetch = (mocks.ctorCalls[0]?.options as { fetch: typeof fetch }).fetch
    const response = await boundedFetch(`${CONVEX_URL}/api/query`)
    expect(upstreamSignal).toBeInstanceOf(AbortSignal)

    const body = response.text()
    request.abort()
    await expect(body).rejects.toMatchObject({
      kind: 'transport',
      code: 'CANCELLED',
      message: 'Convex HTTP request was aborted',
    })
  })

  it('passes the request and normalized trusted client IP header to the exchange', async () => {
    // The header is server-only runtime config, never part of the public config.
    mocks.useRuntimeConfigMock.mockReturnValue({
      public: { convex: { url: CONVEX_URL, siteUrl: SITE_URL, auth: AUTH_CONFIG } },
      convex: { trustedClientIpHeader: 'CF-Connecting-IP' },
    })
    mocks.exchangeMock.mockResolvedValue({ token: USER_JWT, status: 200, error: null })

    const event = createEvent(AUTH_COOKIE, { 'cf-connecting-ip': '198.51.100.10' })
    await serverConvex(event).getToken()

    expect(mocks.exchangeMock).toHaveBeenCalledWith({
      event,
      siteUrl: SITE_URL,
      publicOrigin: 'http://localhost:3000',
      credential: { type: 'cookie', value: AUTH_COOKIE },
      trustedClientIpHeader: 'cf-connecting-ip',
      timeoutMs: 5_000,
      renewsRequestSession: true,
    })
  })

  it('does not attempt cookie exchange when auth is disabled', async () => {
    setConfig({ url: CONVEX_URL, siteUrl: SITE_URL, auth: false })
    mocks.queryMock.mockResolvedValue('anonymous')

    await expect(
      serverConvex(createEvent(AUTH_COOKIE), { auth: 'optional' }).query(queryRef, {}),
    ).resolves.toBe('anonymous')
    await expect(
      serverConvex(createEvent(AUTH_COOKIE), { auth: 'required' }).getToken(),
    ).rejects.toMatchObject({ kind: 'authentication', status: 401 })
    expect(mocks.exchangeMock).not.toHaveBeenCalled()
  })

  it('does not retry a failed token promise; a new caller can retry', async () => {
    mocks.exchangeMock.mockResolvedValue({
      token: null,
      status: 401,
      error: new ConvexCallError({
        kind: 'authentication',
        message: 'nope',
        status: 401,
      }),
    })

    const caller = serverConvex(createEvent(AUTH_COOKIE), { auth: 'required' })
    await expect(caller.query(queryRef, {})).rejects.toBeInstanceOf(ConvexCallError)
    await expect(caller.getToken()).rejects.toBeInstanceOf(ConvexCallError)
    expect(mocks.exchangeMock).toHaveBeenCalledTimes(1)

    const retryCaller = serverConvex(createEvent(AUTH_COOKIE), {
      auth: 'required',
    })
    await expect(retryCaller.getToken()).rejects.toBeInstanceOf(ConvexCallError)
    expect(mocks.exchangeMock).toHaveBeenCalledTimes(2)
  })

  it('explicit token bypasses exchange and is applied via setAuth', async () => {
    mocks.queryMock.mockResolvedValue('ok')

    await serverConvex(createEvent(), { authToken: 'explicit.jwt' }).query(queryRef, {})

    expect(mocks.exchangeMock).not.toHaveBeenCalled()
    expect(mocks.setAuthCalls).toEqual(['explicit.jwt'])
  })

  // Every rejected option combination is listed in server-convex-options.test.ts.
  it('validates options before any network access', () => {
    expect(() =>
      // @ts-expect-error explicit tokens already imply required auth
      serverConvex(createEvent(), { authToken: 'x', auth: 'none' }),
    ).toThrow(ServerConvexValidationError)
    expect(mocks.exchangeMock).not.toHaveBeenCalled()
    expect(mocks.ctorCalls).toHaveLength(0)
  })

  it('forwards omitted args for exact no-argument query, mutation, and action references', async () => {
    mocks.queryMock.mockResolvedValue('query')
    mocks.mutationMock.mockResolvedValue('mutation')
    mocks.actionMock.mockResolvedValue('action')

    const caller = serverConvex(createEvent(), { auth: 'none' })
    await caller.query(queryRef)
    await caller.mutation(mutationRef)
    await caller.action(actionRef)

    expect(mocks.queryMock).toHaveBeenCalledWith(queryRef)
    expect(mocks.mutationMock).toHaveBeenCalledWith(mutationRef)
    expect(mocks.actionMock).toHaveBeenCalledWith(actionRef)
    expect(mocks.exchangeMock).not.toHaveBeenCalled()
  })
})

describe('serverConvex auth-mode resolution', () => {
  it.each(serverOperations)(
    'required anonymous %s throws authentication 401 without calling the client',
    async (_name, getMock, invoke) => {
      await expect(invoke(serverConvex(createEvent(), { auth: 'required' }))).rejects.toMatchObject(
        {
          kind: 'authentication',
          status: 401,
        },
      )
      expect(getMock()).not.toHaveBeenCalled()
      expect(mocks.exchangeMock).not.toHaveBeenCalled()
    },
  )

  it('optional anonymous caller executes without auth', async () => {
    mocks.queryMock.mockResolvedValue('anon')

    const result = await serverConvex(createEvent(), {
      auth: 'optional',
    }).query(queryRef, {})

    expect(result).toBe('anon')
    expect(mocks.setAuthCalls).toEqual([])
    expect(mocks.exchangeMock).not.toHaveBeenCalled()
  })

  it('optional cookie 401/403 executes anonymously', async () => {
    for (const status of [401, 403]) {
      mocks.setAuthCalls.length = 0
      mocks.exchangeMock.mockResolvedValue({
        token: null,
        status,
        error: new ConvexCallError({
          kind: 'authentication',
          message: 'x',
          status,
        }),
      })
      mocks.queryMock.mockResolvedValue('anon')

      const result = await serverConvex(createEvent(AUTH_COOKIE), {
        auth: 'optional',
      }).query(queryRef, {})
      expect(result).toBe('anon')
      expect(mocks.setAuthCalls).toEqual([])
    }
  })

  it('optional transport/5xx/malformed exchange fails as transport', async () => {
    for (const status of [undefined, 500]) {
      mocks.exchangeMock.mockResolvedValue({
        token: null,
        status,
        error: new ConvexCallError({
          kind: 'transport',
          message: 'boom',
          status,
        }),
      })
      await expect(
        serverConvex(createEvent(AUTH_COOKIE), { auth: 'optional' }).query(queryRef, {}),
      ).rejects.toMatchObject({ kind: 'transport' })
    }

    // 2xx with no token = malformed -> transport in optional mode too.
    mocks.exchangeMock.mockResolvedValue({
      token: null,
      status: 200,
      error: new ConvexCallError({
        kind: 'transport',
        message: 'no token',
        status: 200,
      }),
    })
    await expect(
      serverConvex(createEvent(AUTH_COOKIE), { auth: 'optional' }).query(queryRef, {}),
    ).rejects.toMatchObject({ kind: 'transport' })
  })

  it('explicit credential rejected 401/403 throws authentication and never downgrades', async () => {
    mocks.exchangeMock.mockResolvedValue({
      token: null,
      status: 403,
      error: new ConvexCallError({
        kind: 'authentication',
        message: 'x',
        status: 403,
      }),
    })

    const caller = serverConvex(createEvent(), {
      credential: { type: 'cookie', value: AUTH_COOKIE },
    })
    await expect(caller.query(queryRef, {})).rejects.toMatchObject({
      kind: 'authentication',
    })
    expect(mocks.queryMock).not.toHaveBeenCalled()
  })
})

describe('serverConvex boundary error sanitization', () => {
  const SENTINEL = 'SUPER_SECRET_UPSTREAM_BODY_9f8e7d'

  it.each(serverOperations)(
    'keeps a sentinel upstream body out of the public %s error, JSON, and inspect output',
    async (_name, getMock, invoke) => {
      // Simulate ConvexHttpClient placing a raw non-OK upstream body in Error.message.
      getMock().mockRejectedValue(new Error(SENTINEL))

      let caught: unknown
      try {
        await invoke(serverConvex(createEvent(), { auth: 'none' }))
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(ConvexCallError)
      const err = caught as ConvexCallError
      expect(err.kind).toBe('unknown')
      expect(err.message).toBe('Unknown Convex error')
      expect(JSON.stringify(err)).not.toContain(SENTINEL)
      expect(inspect(err)).not.toContain(SENTINEL)
    },
  )

  it.each(serverOperations)(
    'preserves a Convex application error from %s as server with data.code UNAUTHORIZED',
    async (_name, getMock, invoke) => {
      const appError = Object.assign(new Error(`unauthorized ${SENTINEL}\n    at privateFrame`), {
        [Symbol.for('ConvexError')]: true,
        data: { code: 'UNAUTHORIZED', status: 403, detail: 'public detail' },
      })
      getMock().mockRejectedValue(appError)

      await expect(invoke(serverConvex(createEvent(), { auth: 'none' }))).rejects.toMatchObject({
        kind: 'server',
        message: 'Convex application error',
        code: 'UNAUTHORIZED',
        status: 403,
        data: { code: 'UNAUTHORIZED', status: 403, detail: 'public detail' },
      })
    },
  )

  it.each(serverOperations)(
    'passes a classified %s transport error through unchanged',
    async (_name, getMock, invoke) => {
      const transport = new ConvexCallError({
        kind: 'transport',
        message: 'net down',
      })
      getMock().mockRejectedValue(transport)

      await expect(invoke(serverConvex(createEvent(), { auth: 'none' }))).rejects.toBe(transport)
    },
  )
})

describe('serverConvex response cache headers', () => {
  it('marks a response that read the session cookie as Vary: Cookie and private, no-store', async () => {
    mocks.exchangeMock.mockResolvedValue({ token: USER_JWT, status: 200, error: null })
    const event = createEvent(AUTH_COOKIE)

    await serverConvex(event).getToken()

    expect(responseHeaders(event)).toEqual({ vary: 'Cookie', 'cache-control': 'private, no-store' })
  })

  it('still varies by cookie, without private, when the request carries no auth cookie', async () => {
    const event = createEvent()

    await expect(serverConvex(event, { auth: 'optional' }).getToken()).resolves.toBeNull()

    expect(responseHeaders(event)).toEqual({ vary: 'Cookie' })
  })

  it.each([
    ['auth: none', { auth: 'none' as const }],
    ['an explicit token', { authToken: 'explicit.jwt' }],
  ])('leaves the response cacheable when the cookie is never read (%s)', async (_, options) => {
    const event = createEvent(AUTH_COOKIE)

    await serverConvex(event, options).getToken()

    expect(responseHeaders(event)).toEqual({})
  })
})

describe('mergeVaryCookie', () => {
  it('merges Cookie into Vary while preserving existing values', () => {
    expect(mergeVaryCookie(undefined)).toBe('Cookie')
    expect(mergeVaryCookie('Accept-Encoding')).toBe('Accept-Encoding, Cookie')
    expect(mergeVaryCookie('Cookie')).toBe('Cookie')
    expect(mergeVaryCookie('cookie')).toBe('cookie')
    expect(mergeVaryCookie(['Accept-Encoding', 'Cookie'])).toBe('Accept-Encoding, Cookie')
    expect(mergeVaryCookie('*')).toBe('*')
    expect(mergeVaryCookie('Accept-Encoding, *')).toBe('*')
  })
})

// Both event shapes: the raw h3 v1 event keeps its headers on the Node
// response, the web-shaped event (Nuxt 5, Nuxt 4.6 `nuxt/server`) on a live
// web `Headers`, where deleting while iterating would skip entries.
describe.each([
  {
    shape: 'raw h3 v1 event',
    create: (): ConvexServerEvent => {
      const req = new IncomingMessage(new Socket())
      return createH3V1Event(req, new ServerResponse(req))
    },
  },
  {
    shape: 'web-shaped event',
    create: (): ConvexServerEvent => ({
      req: new Request('https://app.example.com'),
      res: { headers: new Headers() },
      context: {},
    }),
  },
])('SSR auth response headers (Vary/Cache-Control) on a $shape', ({ create }) => {
  function applyHeaders(
    initial: Array<[string, string]>,
    options: Parameters<typeof applyConvexAuthSsrHeaders>[1],
  ) {
    const event = create()
    for (const [name, value] of initial) eventResponseHeaders(event).set(name, value)
    applyConvexAuthSsrHeaders(event, options)
    return responseHeaders(event)
  }

  it.each([
    [true, true, { vary: 'Accept-Encoding, Cookie', 'cache-control': 'private, no-store' }],
    [true, false, { vary: 'Accept-Encoding, Cookie', 'cache-control': 'private, no-store' }],
    [false, true, { vary: 'Accept-Encoding, Cookie', 'cache-control': 'private, no-store' }],
    [false, false, { vary: 'Accept-Encoding, Cookie' }],
  ])(
    'cookie=%s rendersUser=%s appends Vary: Cookie and is private only with an auth signal',
    (hasBetterAuthCookie, rendersUser, expected) => {
      expect(
        applyHeaders([['Vary', 'Accept-Encoding']], { hasBetterAuthCookie, rendersUser }),
      ).toEqual(expected)
    },
  )

  it('removes shared-cache overrides before marking a private auth response no-store', () => {
    expect(
      applyHeaders(
        [
          ['Surrogate-Control', 'max-age=86400'],
          ['CDN-Cache-Control', 'public, max-age=86400'],
          ['Cloudflare-CDN-Cache-Control', 'public, s-maxage=86400'],
          ['Vercel-CDN-Cache-Control', 'public, s-maxage=86400'],
          ['Netlify-CDN-Cache-Control', 'public, durable'],
          ['Edge-Control', 'cache-maxage=1d'],
          ['X-Accel-Expires', '86400'],
          ['Content-Language', 'en'],
        ],
        { hasBetterAuthCookie: true, rendersUser: false },
      ),
    ).toEqual({
      'content-language': 'en',
      vary: 'Cookie',
      'cache-control': 'private, no-store',
    })
  })
})

describe('serverConvex configured bounds and error context', () => {
  it('applies the configured response cap and query deadline to its Convex fetch', async () => {
    setConfig({
      url: CONVEX_URL,
      auth: false,
      server: { maxResponseBytes: 16, queryTimeoutMs: 20 },
    })
    let respond: (init?: RequestInit) => Promise<Response> = async () => new Response('')
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => respond(init)),
    )
    mocks.queryMock.mockResolvedValue(null)
    await serverConvex(createEvent(), { auth: 'none' }).query(queryRef, {})
    const boundedFetch = (mocks.ctorCalls[0]?.options as { fetch: typeof fetch }).fetch

    respond = async () => new Response('x'.repeat(32), { headers: { 'content-length': '32' } })
    await expect(boundedFetch(`${CONVEX_URL}/api/query`)).rejects.toMatchObject({
      kind: 'transport',
      code: 'RESPONSE_TOO_LARGE',
      message: 'Convex HTTP response exceeded the size limit',
    })

    respond = (init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
    await expect(boundedFetch(`${CONVEX_URL}/api/query`)).rejects.toMatchObject({
      kind: 'transport',
      code: 'TIMEOUT',
      message: 'Convex HTTP request timed out',
    })
  })

  it('names the failing function and codes a missing identity', async () => {
    const notesList = makeFunctionReference<'query', Record<string, never>, unknown>('notes:list')
    mocks.queryMock.mockRejectedValue(new Error('upstream'))

    await expect(
      serverConvex(createEvent(), { auth: 'none' }).query(notesList),
    ).rejects.toMatchObject({ kind: 'unknown', functionName: 'notes:list' })
    await expect(
      serverConvex(createEvent(), { auth: 'required' }).query(notesList),
    ).rejects.toMatchObject({
      kind: 'authentication',
      code: 'UNAUTHENTICATED',
      status: 401,
      functionName: 'notes:list',
    })
  })

  it('codes library-raised write failures', async () => {
    setConfig({ auth: false })
    await expect(
      serverConvex(createEvent(), { auth: 'none' }).mutation(mutationRef, {}),
    ).rejects.toMatchObject({ kind: 'unknown', code: 'CONVEX_URL_MISSING' })

    setConfig({ url: CONVEX_URL, auth: false })
    let respond: () => Promise<Response> = async () => new Response('', { status: 502 })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => respond()),
    )
    mocks.mutationMock.mockResolvedValue(null)
    await serverConvex(createEvent(), { auth: 'none' }).mutation(mutationRef, {})
    const boundedFetch = (mocks.ctorCalls.at(-1)?.options as { fetch: typeof fetch }).fetch

    await expect(boundedFetch(`${CONVEX_URL}/api/mutation`)).rejects.toMatchObject({
      kind: 'transport',
      code: 'UPSTREAM_ERROR',
      status: 502,
    })
    respond = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(boundedFetch(`${CONVEX_URL}/api/mutation`)).rejects.toMatchObject({
      kind: 'transport',
      code: 'NETWORK_ERROR',
    })
  })

  it('keeps credential contract violations as ServerConvexValidationError', async () => {
    const violation = new ServerConvexValidationError(
      'credential must contain a non-empty supported Better Auth session cookie',
    )
    mocks.exchangeMock.mockImplementation(() => {
      throw violation
    })
    const caller = serverConvex(createEvent(), {
      credential: { type: 'cookie', value: 'unrelated_cookie=value' },
    })

    await expect(caller.query(queryRef, {})).rejects.toBe(violation)
  })
})
