import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  defineNuxtPluginMock,
  useRuntimeConfigMock,
  useRequestEventMock,
  useStateMock,
  getConvexRuntimeConfigMock,
  fetchWithTimeoutMock,
  decodeUserFromJwtMock,
  isJwtUsableMock,
} = vi.hoisted(() => ({
  defineNuxtPluginMock: vi.fn((fn: unknown) => fn),
  useRuntimeConfigMock: vi.fn(),
  useRequestEventMock: vi.fn(),
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

function createResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('plugin.server token exchange failure policy', () => {
  const stateStore = new Map<string, { value: unknown }>()
  const setHeaderMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
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
    fetchWithTimeoutMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/auth/get-session')) {
        return createResponse(200, { user: null })
      }
      if (url.endsWith('/api/auth/convex/token')) {
        return createResponse(500, {})
      }
      throw new Error(`Unexpected URL: ${url}`)
    })

    const plugin = (await import('../../src/runtime/plugin.server')).default as () => Promise<void>
    await expect(plugin()).resolves.toBeUndefined()
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

    const plugin = (await import('../../src/runtime/plugin.server')).default as () => Promise<void>
    await expect(plugin()).resolves.toBeUndefined()

    expect(fetchWithTimeoutMock).not.toHaveBeenCalled()
    expect(stateStore.get('convex:authError')?.value).toBe(
      'Authentication is temporarily unavailable',
    )
    expect(stateStore.get('convex:identity')?.value).toEqual({ status: 'anonymous' })
  })

  it('isolates a non-session Better Auth cookie response when siteUrl is missing', async () => {
    const runtimeConfig = getConvexRuntimeConfigMock()
    getConvexRuntimeConfigMock.mockReturnValue({ ...runtimeConfig, siteUrl: undefined })
    useRequestEventMock.mockReturnValue({
      ...useRequestEventMock(),
      headers: new Headers({ cookie: 'better-auth.oauth_state=opaque-state' }),
    })

    const plugin = (await import('../../src/runtime/plugin.server')).default as () => Promise<void>
    await expect(plugin()).resolves.toBeUndefined()

    expect(fetchWithTimeoutMock).not.toHaveBeenCalled()
    expect(setHeaderMock).toHaveBeenCalledWith('Vary', 'Cookie')
    expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
  })

  it('isolates a non-session Better Auth cookie on the normal SSR path', async () => {
    useRequestEventMock.mockReturnValue({
      ...useRequestEventMock(),
      headers: new Headers({ cookie: 'better-auth.oauth_state=opaque-state' }),
    })

    const plugin = (await import('../../src/runtime/plugin.server')).default as () => Promise<void>
    await expect(plugin()).resolves.toBeUndefined()

    expect(fetchWithTimeoutMock).not.toHaveBeenCalled()
    expect(stateStore.get('convex:identity')?.value).toEqual({ status: 'anonymous' })
    expect(setHeaderMock).toHaveBeenCalledWith('Vary', 'Cookie')
    expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
  })

  it('keeps 401 token exchange as graceful unauthenticated (no throw)', async () => {
    fetchWithTimeoutMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/auth/get-session')) {
        return createResponse(200, { user: null })
      }
      if (url.endsWith('/api/auth/convex/token')) {
        return createResponse(401, { error: 'unauthorized' })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })

    const plugin = (await import('../../src/runtime/plugin.server')).default as () => Promise<void>
    await expect(plugin()).resolves.toBeUndefined()

    expect(stateStore.get('convex:authError')?.value).toBeNull()
    expect(stateStore.get('convex:identity')?.value).toEqual({ status: 'anonymous' })
    // Invalid/revoked auth cookies still make the response request-specific.
    expect(setHeaderMock).toHaveBeenCalledWith('Vary', 'Cookie')
    expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
  })

  it('sets Cache-Control: private, no-store when a token is hydrated', async () => {
    decodeUserFromJwtMock.mockReturnValue({ id: 'user-1', email: 'user@example.com' })
    fetchWithTimeoutMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/auth/convex/token')) {
        return createResponse(200, { token: 'jwt-1' })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })

    const plugin = (await import('../../src/runtime/plugin.server')).default as () => Promise<void>
    await expect(plugin()).resolves.toBeUndefined()

    expect(stateStore.get('convex:identity')?.value).toEqual({
      status: 'authenticated',
      token: 'jwt-1',
      user: { id: 'user-1', email: 'user@example.com' },
      key: 'user:user-1',
    })
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

    const plugin = (await import('../../src/runtime/plugin.server')).default as () => Promise<void>
    await expect(plugin()).resolves.toBeUndefined()

    const output = JSON.stringify(log.mock.calls)
    expect(output).toContain('ssr.auth.started')
    expect(output).toContain('ssr.auth.completed')
    expect(output).not.toContain(cookieSentinel)
    expect(output).not.toContain(jwtSentinel)
  })
})
