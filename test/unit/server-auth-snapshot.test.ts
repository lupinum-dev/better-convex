import { inspect } from 'node:util'

import type { H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveServerAuthSnapshot } from '../../src/runtime/server/utils/auth-snapshot'
import { CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER } from '../../src/runtime/shared/client-ip'

const { fetchWithTimeoutMock, decodeUserFromJwtMock, isJwtUsableMock } = vi.hoisted(() => ({
  fetchWithTimeoutMock: vi.fn(),
  decodeUserFromJwtMock: vi.fn(),
  isJwtUsableMock: vi.fn(),
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
  return new Response(JSON.stringify(body), { status })
}

const baseOptions = {
  event: {
    headers: new Headers({ 'cf-connecting-ip': '198.51.100.10' }),
  } as unknown as H3Event,
  siteUrl: 'https://demo.convex.site',
  requestId: 'request-1',
  trackWaterfall: true,
  trustedClientIpHeader: 'cf-connecting-ip',
}

const PROXY_IP_SECRET = 'server-auth-snapshot-test-secret-32-bytes-minimum'

describe('resolveServerAuthSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('BCN_AUTH_PROXY_IP_SECRET', PROXY_IP_SECRET)
    decodeUserFromJwtMock.mockReturnValue(null)
    isJwtUsableMock.mockReturnValue(true)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('returns an unauthenticated snapshot without a session cookie', async () => {
    const snapshot = await resolveServerAuthSnapshot({
      ...baseOptions,
      cookieHeader: null,
    })

    expect(snapshot.token).toBeNull()
    expect(snapshot.user).toBeNull()
    expect(snapshot.authError).toBeNull()
    expect(snapshot.waterfall?.outcome).toBe('unauthenticated')
    expect(snapshot.logEvents.map((event) => [event.phase, event.outcome])).toEqual([
      ['server-init', 'success'],
      ['session-check', 'miss'],
    ])
    expect(fetchWithTimeoutMock).not.toHaveBeenCalled()
  })

  it('exchanges a session cookie for a fresh token on every request', async () => {
    decodeUserFromJwtMock.mockReturnValue({
      id: 'user-2',
      email: 'fresh@example.com',
    })
    fetchWithTimeoutMock.mockResolvedValue(createResponse(200, { token: 'fresh.jwt' }))

    const snapshot = await resolveServerAuthSnapshot({
      ...baseOptions,
      cookieHeader:
        'private_app_cookie=secret; __Secure-better-auth.session_token=session-2; better-auth.callback=state',
    })

    expect(snapshot.token).toBe('fresh.jwt')
    expect(snapshot.user).toEqual({ id: 'user-2', email: 'fresh@example.com' })
    expect(snapshot.authError).toBeNull()
    expect(fetchWithTimeoutMock).toHaveBeenCalledWith(
      'https://demo.convex.site/api/auth/convex/token',
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: '__Secure-better-auth.session_token=session-2; better-auth.callback=state',
          [CLIENT_IP_HEADER]: '198.51.100.10',
          [CLIENT_IP_SIGNATURE_HEADER]: expect.any(String),
        }),
      }),
    )
  })

  it('fails closed before exchange when the configured client IP header is missing', async () => {
    const snapshot = await resolveServerAuthSnapshot({
      ...baseOptions,
      event: { headers: new Headers() } as unknown as H3Event,
      cookieHeader: 'better-auth.session_token=session-bound',
    })

    expect(fetchWithTimeoutMock).not.toHaveBeenCalled()
    expect(snapshot).toMatchObject({
      token: null,
      user: null,
      authError: 'Authentication is temporarily unavailable',
    })
    expect(snapshot.waterfall?.outcome).toBe('error')
    expect(snapshot.logEvents.at(-1)).toEqual({
      phase: 'ssr.jwt.exchange',
      outcome: 'error',
      details: { code: 'AUTH_TOKEN_EXCHANGE_FAILED' },
    })
  })

  it('logs only the hydration outcome, never identity data, on successful exchange', async () => {
    decodeUserFromJwtMock.mockReturnValue({
      id: 'user-abcdefghijklmnop',
      email: 'private-email@example.com',
    })
    fetchWithTimeoutMock.mockResolvedValue(createResponse(200, { token: 'fresh.jwt' }))

    const snapshot = await resolveServerAuthSnapshot({
      ...baseOptions,
      cookieHeader: 'better-auth.session_token=session-log',
    })

    const exchangeEvent = snapshot.logEvents.find(
      (event) => event.phase === 'ssr.jwt.exchange' && event.outcome === 'success',
    )
    expect(exchangeEvent).toBeDefined()
    expect(exchangeEvent?.details).toEqual({ identityHydrated: true })
    expect(JSON.stringify(exchangeEvent)).not.toContain('user-abcdefghijklmnop')
    expect(JSON.stringify(exchangeEvent)).not.toContain('example.com')
    expect(JSON.stringify(exchangeEvent)).not.toContain('private-email')
  })

  it('treats 401 token exchange as graceful unauthenticated state', async () => {
    fetchWithTimeoutMock.mockResolvedValue(createResponse(401, { error: 'unauthorized' }))

    const snapshot = await resolveServerAuthSnapshot({
      ...baseOptions,
      cookieHeader: 'better-auth.session_token=session-3',
    })

    expect(snapshot.token).toBeNull()
    expect(snapshot.user).toBeNull()
    expect(snapshot.authError).toBeNull()
    expect(snapshot.waterfall?.outcome).toBe('unauthenticated')
    expect(snapshot.logEvents.at(-1)).toMatchObject({
      phase: 'ssr.jwt.exchange',
      outcome: 'miss',
      details: { status: 401 },
    })
  })

  it('marks upstream token exchange failures as misconfiguration', async () => {
    fetchWithTimeoutMock.mockResolvedValue(createResponse(500, {}))

    const snapshot = await resolveServerAuthSnapshot({
      ...baseOptions,
      cookieHeader: 'better-auth.session_token=session-4',
    })

    expect(snapshot.token).toBeNull()
    expect(snapshot.user).toBeNull()
    expect(snapshot.authError).toBe('Authentication is temporarily unavailable')
    expect(snapshot.waterfall?.outcome).toBe('error')
    expect(snapshot.logEvents.at(-1)).toMatchObject({
      phase: 'ssr.jwt.exchange',
      outcome: 'error',
      details: { status: 500 },
    })
  })

  it.each([
    { status: 200, body: {}, label: 'a successful response without a token' },
    { status: 429, body: { error: 'rate limited' }, label: 'an upstream rate limit' },
  ])('fails closed on $label', async ({ status, body }) => {
    fetchWithTimeoutMock.mockResolvedValue(createResponse(status, body))

    const snapshot = await resolveServerAuthSnapshot({
      ...baseOptions,
      cookieHeader: 'better-auth.session_token=session-protocol-failure',
    })

    expect(snapshot.token).toBeNull()
    expect(snapshot.user).toBeNull()
    expect(snapshot.authError).toBe('Authentication is temporarily unavailable')
    expect(snapshot.waterfall?.outcome).toBe('error')
    expect(snapshot.logEvents.at(-1)).toMatchObject({
      phase: 'ssr.jwt.exchange',
      outcome: 'error',
      details: expect.objectContaining({ status }),
    })
    expect(JSON.stringify(snapshot)).not.toContain('session-protocol-failure')
  })

  it('never hydrates an unusable token returned by a successful exchange', async () => {
    isJwtUsableMock.mockReturnValue(false)
    fetchWithTimeoutMock.mockResolvedValue(createResponse(200, { token: 'expired.jwt' }))

    const snapshot = await resolveServerAuthSnapshot({
      ...baseOptions,
      cookieHeader: 'better-auth.session_token=session-invalid-jwt',
    })

    expect(snapshot.token).toBeNull()
    expect(snapshot.user).toBeNull()
    expect(snapshot.authError).toBe('Authentication is temporarily unavailable')
    expect(snapshot.waterfall?.outcome).toBe('error')
    expect(decodeUserFromJwtMock).not.toHaveBeenCalled()
    expect(fetchWithTimeoutMock).toHaveBeenCalledOnce()
    expect(String(fetchWithTimeoutMock.mock.calls[0]?.[0])).toMatch(/\/convex\/token$/)
  })

  it('uses only fixed auth-safe diagnostics in hydration, waterfall, and logs', async () => {
    fetchWithTimeoutMock.mockResolvedValue(createResponse(500, {}))

    const snapshot = await resolveServerAuthSnapshot({
      ...baseOptions,
      cookieHeader: 'better-auth.session_token=session-prod',
    })

    expect(snapshot.token).toBeNull()
    expect(snapshot.authError).toBe('Authentication is temporarily unavailable')
    expect(snapshot.authError).not.toMatch(/BETTER_AUTH_SECRET|convex\/http\.ts|convex\/token/i)
    const exchangeLog = snapshot.logEvents.find(
      (event) => event.phase === 'ssr.jwt.exchange' && event.outcome === 'error',
    )
    expect(exchangeLog?.details).toEqual({ code: 'AUTH_TOKEN_EXCHANGE_FAILED', status: 500 })
    expect(snapshot.waterfall?.error).toBe('AUTH_TOKEN_EXCHANGE_FAILED')
  })

  it('drops raw transport message, cause, and stack sentinels at every snapshot boundary', async () => {
    const sentinels = {
      message: 'RAW_AUTH_MESSAGE_SENTINEL_7f2289',
      cause: 'RAW_AUTH_CAUSE_SENTINEL_b83d91',
      stack: 'RAW_AUTH_STACK_SENTINEL_5a71c0',
    }
    const rawCause = new Error(sentinels.cause)
    const rawError = new Error(sentinels.message, { cause: rawCause })
    rawError.stack = sentinels.stack
    fetchWithTimeoutMock.mockRejectedValue(rawError)

    const snapshot = await resolveServerAuthSnapshot({
      ...baseOptions,
      cookieHeader: 'better-auth.session_token=session-error-sentinel',
    })
    const rendered = inspect(snapshot, { depth: null })

    expect(snapshot.authError).toBe('Authentication is temporarily unavailable')
    expect(snapshot.logEvents.at(-1)).toEqual({
      phase: 'ssr.jwt.exchange',
      outcome: 'error',
      details: { code: 'AUTH_TOKEN_EXCHANGE_FAILED' },
    })
    for (const sentinel of Object.values(sentinels)) expect(rendered).not.toContain(sentinel)
  })

  it('never copies the session credential into structured auth logs', async () => {
    const sessionSecret = 'SESSION_SECRET_MUST_NOT_BE_LOGGED'
    fetchWithTimeoutMock.mockResolvedValue(createResponse(500, {}))

    const snapshot = await resolveServerAuthSnapshot({
      ...baseOptions,
      cookieHeader: `private_app_cookie=also-secret; better-auth.session_token=${sessionSecret}`,
    })

    const serializedLogs = JSON.stringify(snapshot.logEvents)
    expect(serializedLogs).not.toContain(sessionSecret)
    expect(serializedLogs).not.toContain('also-secret')
  })
})
