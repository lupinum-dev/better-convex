import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NuxtApp } from '#app'

import { readServerConvexToken } from '../../src/runtime/utils/auth-identity-state'

const {
  defineNuxtPluginMock,
  useRuntimeConfigMock,
  useRequestEventMock,
  useNuxtAppMock,
  useStateMock,
  getConvexRuntimeConfigMock,
  fetchWithTimeoutMock,
  decodeUserFromJwtMock,
  isJwtUsableMock,
} = vi.hoisted(() => ({
  defineNuxtPluginMock: vi.fn((fn: unknown) => fn),
  useRuntimeConfigMock: vi.fn(),
  useRequestEventMock: vi.fn(),
  useNuxtAppMock: vi.fn(),
  useStateMock: vi.fn(),
  getConvexRuntimeConfigMock: vi.fn(),
  fetchWithTimeoutMock: vi.fn(),
  decodeUserFromJwtMock: vi.fn(),
  isJwtUsableMock: vi.fn(),
}))

vi.mock('#app', () => ({
  defineNuxtPlugin: defineNuxtPluginMock,
  useRuntimeConfig: useRuntimeConfigMock,
  useRequestEvent: useRequestEventMock,
  useNuxtApp: useNuxtAppMock,
  useState: useStateMock,
}))

vi.mock('#imports', () => ({
  useState: useStateMock,
}))

vi.mock('../../src/runtime/utils/runtime-config', () => ({
  getConvexRuntimeConfig: getConvexRuntimeConfigMock,
}))

vi.mock('../../src/runtime/server/utils/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/runtime/server/utils/http')>()),
  fetchWithTimeout: fetchWithTimeoutMock,
}))

vi.mock('../../src/runtime/utils/convex-shared', () => ({
  decodeUserFromJwt: decodeUserFromJwtMock,
  isJwtUsable: isJwtUsableMock,
}))

const nuxtApp = {} as NuxtApp

function createResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Runs the server plugin, which must settle every auth failure without throwing. */
async function runServerPlugin() {
  const plugin = (await import('../../src/runtime/plugin.server')).default as () => Promise<void>
  await expect(plugin()).resolves.toBeUndefined()
}

function answerTokenExchange(status: number, body: unknown) {
  fetchWithTimeoutMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/auth/get-session')) return createResponse(200, { user: null })
    if (url.endsWith('/api/auth/convex/token')) return createResponse(status, body)
    throw new Error(`Unexpected URL: ${url}`)
  })
}

describe('plugin.server token exchange failure policy', () => {
  const stateStore = new Map<string, { value: unknown }>()
  const setHeaderMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useNuxtAppMock.mockReturnValue(nuxtApp)
    stateStore.clear()
    delete (globalThis as typeof globalThis & { __BCN_AUTH_HEALTHCHECK_DONE__?: Set<string> })
      .__BCN_AUTH_HEALTHCHECK_DONE__

    useRuntimeConfigMock.mockReturnValue({
      public: {
        convex: { logging: false },
      },
    })

    useRequestEventMock.mockReturnValue({
      path: '/dashboard',
      method: 'GET',
      node: {
        req: { url: '/dashboard' },
        res: {
          getHeader: vi.fn().mockReturnValue(undefined),
          getHeaders: vi.fn().mockReturnValue({}),
          removeHeader: vi.fn(),
          setHeader: setHeaderMock,
        },
      },
      headers: new Headers({
        cookie: 'better-auth.session_token=abc',
      }),
    })

    useStateMock.mockImplementation((key: string, init?: (() => unknown) | unknown) => {
      if (!stateStore.has(key)) {
        const value = typeof init === 'function' ? (init as () => unknown)() : (init ?? null)
        stateStore.set(key, { value })
      }
      return stateStore.get(key)
    })

    getConvexRuntimeConfigMock.mockReturnValue({
      url: 'https://demo.convex.cloud',
      siteUrl: 'https://demo.convex.site',
      auth: {
        origin: 'http://localhost:3000',
        trustedClientIpHeader: '',
        redirectTo: '/auth/signin',
      },
    })

    decodeUserFromJwtMock.mockReturnValue(null)
    isJwtUsableMock.mockReturnValue(true)
  })

  it('settles token-exchange failures with the same fixed error in every environment', async () => {
    answerTokenExchange(500, {})

    await runServerPlugin()
    expect(stateStore.get('convex:authError')?.value).toBe(
      'Authentication is temporarily unavailable',
    )
  })

  it.each([
    ['missing', undefined],
    ['malformed', '198.51.100.10, 203.0.113.20'],
  ])('fails closed when the configured ingress client IP header is %s', async (_, value) => {
    const runtimeConfig = getConvexRuntimeConfigMock()
    getConvexRuntimeConfigMock.mockReturnValue({
      ...runtimeConfig,
      auth: {
        ...runtimeConfig.auth,
        trustedClientIpHeader: 'cf-connecting-ip',
      },
    })
    const event = useRequestEventMock()
    useRequestEventMock.mockReturnValue({
      ...event,
      headers: new Headers({
        cookie: 'better-auth.session_token=abc',
        ...(value ? { 'cf-connecting-ip': value } : {}),
      }),
    })

    await runServerPlugin()

    expect(fetchWithTimeoutMock).not.toHaveBeenCalled()
    expect(stateStore.get('convex:authError')?.value).toBe(
      'Authentication is temporarily unavailable',
    )
    expect(stateStore.get('convex:identity')?.value).toEqual({ status: 'anonymous' })
  })

  it.each([
    ['the normal SSR path', {}],
    ['a missing siteUrl', { siteUrl: undefined }],
  ])('isolates a non-session Better Auth cookie response on %s', async (_case, config) => {
    getConvexRuntimeConfigMock.mockReturnValue({ ...getConvexRuntimeConfigMock(), ...config })
    useRequestEventMock.mockReturnValue({
      ...useRequestEventMock(),
      headers: new Headers({ cookie: 'better-auth.oauth_state=opaque-state' }),
    })

    await runServerPlugin()

    expect(fetchWithTimeoutMock).not.toHaveBeenCalled()
    expect(stateStore.get('convex:identity')?.value).toEqual({ status: 'anonymous' })
    expect(setHeaderMock).toHaveBeenCalledWith('Vary', 'Cookie')
    expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
  })

  it('keeps 401 token exchange as graceful unauthenticated (no throw)', async () => {
    answerTokenExchange(401, { error: 'unauthorized' })

    await runServerPlugin()

    expect(stateStore.get('convex:authError')?.value).toBeNull()
    expect(stateStore.get('convex:identity')?.value).toEqual({ status: 'anonymous' })
    // Invalid/revoked auth cookies still make the response request-specific.
    expect(setHeaderMock).toHaveBeenCalledWith('Vary', 'Cookie')
    expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
  })

  it('keeps the exchanged token out of the hydrated state and sets Cache-Control: private, no-store', async () => {
    decodeUserFromJwtMock.mockReturnValue({ id: 'user-1', email: 'user@example.com' })
    fetchWithTimeoutMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/auth/convex/token')) {
        return createResponse(200, { token: 'jwt-1' })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })

    await runServerPlugin()

    expect(stateStore.get('convex:identity')?.value).toEqual({
      status: 'authenticated',
      user: { id: 'user-1', email: 'user@example.com' },
      key: 'user:user-1',
    })
    // useState is serialized into the page payload; SSR queries read the token here.
    expect(JSON.stringify([...stateStore.values()])).not.toContain('jwt-1')
    expect(readServerConvexToken(nuxtApp)).toBe('jwt-1')
    expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
  })

  it('emits correlated server traces without logging the incoming cookie or exchanged JWT', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const cookieSentinel = 'BCN_SSR_COOKIE_SENTINEL'
    const jwtSentinel = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZW50aW5lbCJ9.signature'
    useRuntimeConfigMock.mockReturnValue({ public: { convex: { logging: 'debug' } } })
    useRequestEventMock.mockReturnValue({
      ...useRequestEventMock(),
      headers: new Headers({ cookie: `better-auth.session_token=${cookieSentinel}` }),
    })
    fetchWithTimeoutMock.mockResolvedValueOnce(createResponse(200, { token: jwtSentinel }))

    await runServerPlugin()

    const output = JSON.stringify(log.mock.calls)
    expect(output).toContain('ssr.auth.started')
    expect(output).toContain('ssr.auth.completed')
    expect(output).not.toContain(cookieSentinel)
    expect(output).not.toContain(jwtSentinel)
  })
})
