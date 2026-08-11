import { betterAuth } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { jwt } from 'better-auth/plugins'
import { describe, expect, it, vi } from 'vitest'

import { INTERNAL_SESSION_HEADER } from '../../src/runtime/convex-auth/internal-session'
import { convexAuth } from '../../src/runtime/convex-auth/plugin'

const origin = 'https://app.example.test'
const convexSiteUrl = 'https://deployment.convex.site'
const secret = 'internal-session-test-secret-with-at-least-32-randomish-characters'
const sessionToken = 'persisted-session-token'

function database(): MemoryDB {
  const now = Date.now()
  return {
    rateLimit: [],
    session: [
      {
        createdAt: new Date(now - 1_000),
        expiresAt: new Date(now + 60_000),
        id: 'session-1',
        ipAddress: null,
        token: sessionToken,
        updatedAt: new Date(now - 1_000),
        userAgent: null,
        userId: 'user-1',
      },
    ],
    user: [
      {
        createdAt: new Date(now - 1_000),
        email: 'user@example.test',
        emailVerified: true,
        id: 'user-1',
        image: null,
        name: 'Test User',
        updatedAt: new Date(now - 1_000),
      },
    ],
  }
}

function createAuth(memoryDatabase = database()) {
  const issuer = `${origin}/api/auth`
  return betterAuth({
    advanced: { ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } },
    basePath: '/api/auth',
    baseURL: origin,
    database: memoryAdapter(memoryDatabase),
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: {
          disablePrivateKeyEncryption: false,
          gracePeriod: 21 * 60,
          keyPairConfig: { alg: 'RS256' },
        },
        jwt: { audience: issuer, expirationTime: '10m', issuer },
      }),
      convexAuth({
        authConfig: {
          providers: [
            {
              algorithm: 'RS256',
              applicationID: 'convex',
              issuer: convexSiteUrl,
              jwks: `${issuer}/jwks`,
              type: 'customJwt',
            },
          ],
        },
        sessionJwt: {
          audience: 'convex',
          expirationTime: '15m',
          issuer: convexSiteUrl,
        },
      }),
    ],
    rateLimit: { enabled: true, modelName: 'rateLimit', storage: 'database' },
    secret,
  })
}

function request(marker: boolean, path = '/get-session'): Request {
  return new Request(`${origin}/api/auth${path}`, {
    headers: {
      authorization: `Bearer ${sessionToken}`,
      ...(marker ? { [INTERNAL_SESSION_HEADER]: '1' } : {}),
    },
  })
}

describe('internal Better Auth session bridge', () => {
  it('gives the authenticated token exchange a bounded route-specific allowance', () => {
    const plugin = convexAuth({
      authConfig: {
        providers: [
          {
            algorithm: 'RS256',
            applicationID: 'convex',
            issuer: convexSiteUrl,
            jwks: `${origin}/api/auth/jwks`,
            type: 'customJwt',
          },
        ],
      },
      sessionJwt: {
        audience: 'convex',
        expirationTime: '15m',
        issuer: convexSiteUrl,
      },
    })

    expect(plugin.rateLimit).toHaveLength(1)
    expect(plugin.rateLimit?.[0]).toMatchObject({ max: 300, window: 10 })
    expect(plugin.rateLimit?.[0]?.pathMatcher('/convex/token')).toBe(true)
    expect(plugin.rateLimit?.[0]?.pathMatcher('/sign-in/email')).toBe(false)
    expect(plugin.rateLimit?.[0]?.pathMatcher('/oauth2/token')).toBe(false)
  })

  it('enforces the database-backed token-exchange allowance per client IP and path', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-19T12:00:00.000Z'))
    try {
      const memoryDatabase = database()
      const auth = createAuth(memoryDatabase)
      const exchange = (ip: string) =>
        auth.handler(
          new Request(`${origin}/api/auth/convex/token`, {
            headers: { 'x-bcn-verified-client-ip': ip },
          }),
        )

      for (let requestNumber = 1; requestNumber <= 300; requestNumber += 1) {
        const response = await exchange('192.0.2.10')
        expect(response.status, `request ${requestNumber}`).toBe(200)
        await response.body?.cancel()
      }

      const blocked = await exchange('192.0.2.10')
      expect(blocked.status).toBe(429)
      expect(Number(blocked.headers.get('x-retry-after'))).toBeGreaterThanOrEqual(1)
      await blocked.body?.cancel()

      const otherIp = await exchange('192.0.2.11')
      expect(otherIp.status).toBe(200)
      await otherIp.body?.cancel()

      const unrelatedPath = await auth.handler(
        new Request(`${origin}/api/auth/get-session`, {
          headers: { 'x-bcn-verified-client-ip': '192.0.2.10' },
        }),
      )
      expect(unrelatedPath.status).toBe(200)
      await unrelatedPath.body?.cancel()

      expect(memoryDatabase.rateLimit).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ count: 300, key: '192.0.2.10|/convex/token' }),
          expect.objectContaining({ count: 1, key: '192.0.2.11|/convex/token' }),
          expect.objectContaining({ count: 1, key: '192.0.2.10|/get-session' }),
        ]),
      )

      vi.advanceTimersByTime(10_001)
      const reset = await exchange('192.0.2.10')
      expect(reset.status).toBe(200)
      await reset.body?.cancel()
      expect(memoryDatabase.rateLimit).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ count: 1, key: '192.0.2.10|/convex/token' }),
        ]),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('authenticates a package-owned in-process call with the persisted session token', async () => {
    const response = await createAuth().handler(request(true))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      session: { id: 'session-1', token: sessionToken },
      user: { id: 'user-1' },
    })
    expect(response.headers.has('set-auth-token')).toBe(false)
  })

  it('does not expose bearer-session authentication without the stripped internal marker', async () => {
    const response = await createAuth().handler(request(false))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toBeNull()
    expect(response.headers.has('set-auth-token')).toBe(false)
  })

  it('returns a cache-private nullable success only when no session credential is present', async () => {
    const auth = createAuth()
    const response = await auth.handler(
      new Request(`${origin}/api/auth/convex/token`, {
        headers: { cookie: 'unrelated=value' },
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ token: null })
  })

  it.each(['better-auth.two_factor=pending', '__Secure-better-auth.session_token=invalid'])(
    'rejects a presented Better Auth credential instead of treating it as anonymous (%s)',
    async (cookie) => {
      const response = await createAuth().handler(
        new Request(`${origin}/api/auth/convex/token`, {
          headers: { cookie },
        }),
      )

      expect(response.status).toBe(401)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
    },
  )

  it('does not bypass endpoint method enforcement for a credential-free request', async () => {
    const response = await createAuth().handler(
      new Request(`${origin}/api/auth/convex/token`, { method: 'POST' }),
    )

    expect(response.status).not.toBe(200)
  })

  it.each(['invalid', null])(
    'rejects a presented session cookie that does not authenticate (%s)',
    async (value) => {
      const auth = createAuth()
      const context = await auth.$context
      const cookie = `${context.authCookies.sessionToken.name}${value === null ? '' : `=${value}`}`
      const response = await auth.handler(
        new Request(`${origin}/api/auth/convex/token`, {
          headers: { cookie },
        }),
      )

      expect(response.status).toBe(401)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
    },
  )

  it('rejects unsupported public bearer credentials', async () => {
    const auth = createAuth()
    const rejected = await auth.handler(request(false, '/convex/token'))
    expect(rejected.status).toBe(401)
    expect(rejected.headers.get('cache-control')).toBe('private, no-store')
    await expect(rejected.json()).resolves.toEqual({
      code: 'UNAUTHORIZED',
      message: 'AUTH_SESSION_INVALID',
    })
  })
})
