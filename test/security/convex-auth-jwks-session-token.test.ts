import { betterAuth } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { jwt, type JwtOptions } from 'better-auth/plugins'
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { INTERNAL_SESSION_HEADER } from '../../src/runtime/convex-auth/internal-session'
import {
  JWKS_GRACE_PERIOD_SECONDS,
  rotateSigningKeyWithOfficialJwt,
} from '../../src/runtime/convex-auth/jwks-rotation'
import { convexAuth, type ConvexAuthOptions } from '../../src/runtime/convex-auth/plugin'
import { createMemoryRateLimitStorage } from '../helpers/memory-rate-limit'

const origin = 'https://app.example.test'
const issuer = `${origin}/api/auth`
const convexSiteUrl = 'https://deployment.convex.site'
const secret = 'jwks-session-token-test-secret-with-at-least-32-random-chars'
const sessionToken = 'persisted-session-token'
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1_000

type DefinePayload = ConvexAuthOptions['sessionJwt']['definePayload']

const defaultClaims: DefinePayload = ({ user }) => ({
  email: user.email,
  emailVerified: user.emailVerified,
  image: user.image ?? null,
  name: user.name,
})

function database(): MemoryDB {
  const now = Date.now()
  return {
    jwks: [],
    rateLimit: [],
    session: [
      {
        createdAt: new Date(now - 1_000),
        expiresAt: new Date(now + sessionLifetimeMs),
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
        image: 'https://cdn.example.test/avatar.png',
        name: 'Test User',
        updatedAt: new Date(now - 1_000),
      },
    ],
  }
}

function createAuth(memory: MemoryDB, definePayload: DefinePayload = defaultClaims) {
  return betterAuth({
    advanced: { ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } },
    basePath: '/api/auth',
    baseURL: origin,
    database: memoryAdapter(memory),
    logger: { disabled: true },
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: {
          disablePrivateKeyEncryption: false,
          gracePeriod: JWKS_GRACE_PERIOD_SECONDS,
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
          definePayload,
          expirationTime: '15m',
          issuer: convexSiteUrl,
        },
      }),
    ],
    rateLimit: {
      customStorage: createMemoryRateLimitStorage(memory),
      enabled: true,
      modelName: 'rateLimit',
      storage: 'database',
    },
    secrets: [{ value: secret, version: 1 }],
  })
}

async function provisionKey(memory: MemoryDB, auth: ReturnType<typeof createAuth>) {
  const context = await auth.$context
  const plugin = context.getPlugin('jwt')
  if (!plugin) throw new Error('Expected the JWT plugin.')
  let kid = ''
  await rotateSigningKeyWithOfficialJwt(
    context as unknown as Parameters<typeof rotateSigningKeyWithOfficialJwt>[0],
    plugin.options as JwtOptions,
    async (next) => {
      const rotatedAt = Date.now()
      for (const key of memory.jwks ?? []) {
        if (!key.expiresAt) key.expiresAt = new Date(rotatedAt)
      }
      memory.jwks = [
        ...(memory.jwks ?? []),
        { ...next, createdAt: new Date(rotatedAt + 1), crv: undefined, expiresAt: undefined },
      ]
      kid = next.id
      return {
        createdAt: rotatedAt + 1,
        newKid: next.id,
        previousKids: [],
        previousVerifyUntil: rotatedAt + JWKS_GRACE_PERIOD_SECONDS * 1_000,
        rotatedAt,
      }
    },
  )
  return kid
}

function tokenRequest(): Request {
  return new Request(`${issuer}/convex/token`, {
    headers: { authorization: `Bearer ${sessionToken}`, [INTERNAL_SESSION_HEADER]: '1' },
  })
}

async function publicJwks(auth: ReturnType<typeof createAuth>) {
  const response = await auth.handler(new Request(`${issuer}/jwks`))
  expect(response.status).toBe(200)
  return createLocalJWKSet((await response.json()) as JSONWebKeySet)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Convex session token signing over the stored JWKS', () => {
  it('signs default display claims next to the session binding claims', async () => {
    const memory = database()
    const auth = createAuth(memory)
    const kid = await provisionKey(memory, auth)

    const response = await auth.handler(tokenRequest())
    expect(response.status).toBe(200)
    const { token } = (await response.json()) as { token: string }
    const { payload, protectedHeader } = await jwtVerify(token, await publicJwks(auth), {
      algorithms: ['RS256'],
      audience: 'convex',
      issuer: convexSiteUrl,
    })

    expect(protectedHeader.kid).toBe(kid)
    expect(payload).toMatchObject({
      email: 'user@example.test',
      emailVerified: true,
      image: 'https://cdn.example.test/avatar.png',
      name: 'Test User',
      sid: 'session-1',
      sub: 'user-1',
      token_use: 'convex-session',
    })
  })

  it('mints a different token for each request in the same second', async () => {
    // Convex schedules its proactive refresh only after it receives a new
    // token; an identical refetch leaves it without a refresh timer.
    const memory = database()
    const auth = createAuth(memory)
    await provisionKey(memory, auth)
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 4, 12, 0, 0))

    const first = (await (await auth.handler(tokenRequest())).json()) as { token: string }
    const second = (await (await auth.handler(tokenRequest())).json()) as { token: string }

    expect(second.token).not.toBe(first.token)
  })

  it.each(['aud', 'exp', 'iat', 'iss', 'jti', 'nbf', 'sid', 'sub', 'token_use'])(
    'rejects a session claim that overrides reserved %s',
    async (claim) => {
      const memory = database()
      const auth = createAuth(memory, () => ({ [claim]: 'forged' }))
      await provisionKey(memory, auth)
      const sign = vi.spyOn((await auth.$context).getPlugin('jwt')!.endpoints, 'signJWT')

      const response = await auth.handler(tokenRequest())

      expect(response.status).toBeGreaterThanOrEqual(500)
      expect(sign).not.toHaveBeenCalled()
    },
  )

  it('rejects non-object session claims', async () => {
    const memory = database()
    const auth = createAuth(memory, (() => ['forged']) as unknown as DefinePayload)
    await provisionKey(memory, auth)

    const response = await auth.handler(tokenRequest())

    expect(response.status).toBeGreaterThanOrEqual(500)
  })

  it('keeps issuing tokens when a retired row is malformed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const memory = database()
    const auth = createAuth(memory)
    await provisionKey(memory, auth)
    const current = await provisionKey(memory, auth)
    const retired = memory.jwks!.find((key) => key.id !== current)!
    retired.id = 'session-token-retired-broken'
    retired.publicKey = '{not json'

    const response = await auth.handler(tokenRequest())
    expect(response.status).toBe(200)
    const { token } = (await response.json()) as { token: string }
    await expect(
      jwtVerify(token, await publicJwks(auth), {
        algorithms: ['RS256'],
        audience: 'convex',
        issuer: convexSiteUrl,
      }),
    ).resolves.toMatchObject({ protectedHeader: { kid: current } })
    expect(warn.mock.calls.map((call) => call.join(' ')).join('\n')).toContain(
      'kid=session-token-retired-broken reason=AUTH_JWKS_PUBLIC_KEY_INVALID',
    )
  })

  it('refuses to issue a token from a malformed current key', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const memory = database()
    const auth = createAuth(memory)
    const current = await provisionKey(memory, auth)
    memory.jwks![0]!.alg = 'none'

    const response = await auth.handler(tokenRequest())

    expect(response.status).toBeGreaterThanOrEqual(500)
    const body = await response.text()
    expect(body).not.toMatch(/eyJ/u)
    expect(error.mock.calls.map((call) => call.join(' ')).join('\n')).toContain(
      `AUTH_JWKS_CURRENT_KEY_INVALID kid=${current} reason=AUTH_JWKS_ALGORITHM_INVALID`,
    )
  })
})
