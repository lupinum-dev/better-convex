import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { createJwk, jwt, resolveSigningKey, signJWT, type JwtOptions } from 'better-auth/plugins'
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  JWKS_CACHE_CONTROL,
  JWKS_GRACE_PERIOD_SECONDS,
  rotateSigningKeyWithOfficialJwt,
  type SigningKeyCandidate,
} from '../../src/runtime/convex-auth/jwks-rotation'
import { convexAuth } from '../../src/runtime/convex-auth/plugin'

const origin = 'https://app.example.test'
const issuer = `${origin}/api/auth`
const convexSiteUrl = 'https://deployment.convex.site'
const currentSecret = 'current-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const previousSecret = 'previous-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVW'

function createJwtPlugin(overrides: Partial<JwtOptions['jwks']> = {}) {
  return jwt({
    disableSettingJwtHeader: true,
    jwks: {
      disablePrivateKeyEncryption: false,
      gracePeriod: JWKS_GRACE_PERIOD_SECONDS,
      keyPairConfig: { alg: 'RS256' },
      ...overrides,
    },
    jwt: { audience: issuer, expirationTime: '10m', issuer },
  })
}

function createConvexPlugin() {
  return convexAuth({
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
  })
}

function createAuth(
  database: MemoryDB,
  secrets: { value: string; version: number }[],
  overrides: Partial<JwtOptions['jwks']> = {},
  runtimeOverrides: Partial<Pick<BetterAuthOptions, 'advanced' | 'rateLimit'>> = {},
  jwtPlugin = createJwtPlugin(overrides),
) {
  database.rateLimit ??= []
  const auth = betterAuth({
    advanced:
      runtimeOverrides.advanced ??
      ({ ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } } as const),
    basePath: '/api/auth',
    baseURL: origin,
    database: memoryAdapter(database),
    logger: { disabled: true },
    plugins: [jwtPlugin, createConvexPlugin()],
    rateLimit:
      runtimeOverrides.rateLimit ??
      ({ enabled: true, modelName: 'rateLimit', storage: 'database' } as const),
    secrets,
  })
  return { auth }
}

async function contextAndOptions(value: ReturnType<typeof createAuth>) {
  const context = await value.auth.$context
  const plugin = context.getPlugin('jwt')
  if (!plugin) throw new Error('Expected the JWT plugin.')
  return { context, options: plugin.options as JwtOptions }
}

function endpointContext(context: Awaited<ReturnType<typeof contextAndOptions>>['context']) {
  return { context } as unknown as Parameters<typeof createJwk>[0]
}

async function rotateInMemory(
  database: MemoryDB,
  context: Awaited<ReturnType<typeof contextAndOptions>>['context'],
  options: JwtOptions,
) {
  let keyId = ''
  await rotateSigningKeyWithOfficialJwt(
    context as unknown as Parameters<typeof createJwk>[0]['context'],
    options,
    async (next) => {
      const rotatedAt = Date.now()
      const existing = database.jwks ?? []
      for (const key of existing) {
        if (!key.expiresAt || key.expiresAt.getTime() > rotatedAt) {
          key.expiresAt = new Date(rotatedAt)
        }
      }
      database.jwks = [
        ...existing,
        {
          ...next,
          createdAt: new Date(rotatedAt + 1),
          crv: undefined,
          expiresAt: undefined,
        },
      ]
      keyId = next.id
      return {
        createdAt: rotatedAt + 1,
        newKid: next.id,
        previousKids: existing.map((key) => key.id),
        previousVerifyUntil: rotatedAt + JWKS_GRACE_PERIOD_SECONDS * 1_000,
        rotatedAt,
      }
    },
  )
  const key = database.jwks?.find((candidate) => candidate.id === keyId)
  if (!key) throw new Error('Expected operator-provisioned signing key.')
  return key
}

function recursivelyContainsPrivateMember(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(recursivelyContainsPrivateMember)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(
    ([name, entry]) =>
      ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k', 'privateKey'].includes(name) ||
      recursivelyContainsPrivateMember(entry),
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('official Better Auth JWKS lifecycle hardening', () => {
  it.each([
    ['default IP headers', { advanced: {} }],
    [
      'multiple terminal IP headers',
      {
        advanced: {
          ipAddress: {
            ipAddressHeaders: ['x-bcn-verified-client-ip', 'x-forwarded-for'],
          },
        },
      },
    ],
    [
      'trusted proxy reinterpretation',
      {
        advanced: {
          ipAddress: {
            ipAddressHeaders: ['x-bcn-verified-client-ip'],
            trustedProxies: ['0.0.0.0/0'],
          },
        },
      },
    ],
    [
      'custom IPv6 bucketing',
      {
        advanced: {
          ipAddress: {
            ipAddressHeaders: ['x-bcn-verified-client-ip'],
            ipv6Subnet: 128,
          },
        },
      },
    ],
    [
      'disabled IP tracking',
      {
        advanced: {
          ipAddress: {
            disableIpTracking: true,
            ipAddressHeaders: ['x-bcn-verified-client-ip'],
          },
        },
      },
    ],
    [
      'truthy non-boolean disabled IP tracking',
      {
        advanced: {
          ipAddress: {
            disableIpTracking: 'true' as unknown as boolean,
            ipAddressHeaders: ['x-bcn-verified-client-ip'],
          },
        },
      },
    ],
    [
      'global trusted proxy headers',
      {
        advanced: {
          ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] },
          trustedProxyHeaders: true,
        },
      },
    ],
    [
      'truthy non-boolean global trusted proxy headers',
      {
        advanced: {
          ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] },
          trustedProxyHeaders: 1 as unknown as boolean,
        },
      },
    ],
    [
      'memory rate limiting',
      {
        rateLimit: { enabled: true, modelName: 'rateLimit', storage: 'memory' },
      },
    ],
    [
      'custom rate-limit bypass',
      {
        rateLimit: {
          customRules: { '/sign-in/email': false },
          enabled: true,
          modelName: 'rateLimit',
          storage: 'database',
        },
      },
    ],
    ['disabled rate limiting', { rateLimit: { enabled: false } }],
  ] satisfies [string, Partial<Pick<BetterAuthOptions, 'advanced' | 'rateLimit'>>][])(
    'rejects a non-OAuth runtime with %s',
    async (_label, runtimeOverrides) => {
      const value = createAuth({}, [{ value: currentSecret, version: 1 }], {}, runtimeOverrides)
      await expect(value.auth.$context).rejects.toThrow('AUTH_CONFIG_INVALID')
    },
  )

  it('accepts only terminal IP defaults that preserve /64 IPv6 rate-limit buckets', async () => {
    const value = createAuth(
      {},
      [{ value: currentSecret, version: 1 }],
      {},
      {
        advanced: {
          ipAddress: {
            ipAddressHeaders: ['x-bcn-verified-client-ip'],
            ipv6Subnet: 64,
            trustedProxies: [],
          },
        },
      },
    )
    await expect(value.auth.$context).resolves.toBeDefined()
  })

  it('constructs auth repeatedly over the same reviewed JWT plugin', async () => {
    const sharedJwtPlugin = createJwtPlugin()
    const first = createAuth({}, [{ value: currentSecret, version: 1 }], {}, {}, sharedJwtPlugin)
    await expect(first.auth.$context).resolves.toBeDefined()

    const second = createAuth({}, [{ value: currentSecret, version: 1 }], {}, {}, sharedJwtPlugin)
    await expect(second.auth.$context).resolves.toBeDefined()
  })

  it('rejects a foreign shared JWKS reader', async () => {
    const jwtPlugin = createJwtPlugin()
    const jwtOptions = jwtPlugin.options as JwtOptions
    jwtOptions.adapter = {
      getJwks: async () => [],
    }
    const value = createAuth({}, [{ value: currentSecret, version: 1 }], {}, {}, jwtPlugin)
    await expect(value.auth.$context).rejects.toThrow('AUTH_JWKS_CONFIG_INVALID')
  })

  it('uses official key generation and versioned private-key encryption before commit', async () => {
    const value = createAuth({}, [{ value: currentSecret, version: 7 }])
    const { context, options } = await contextAndOptions(value)
    let captured: SigningKeyCandidate | undefined

    const metadata = await rotateSigningKeyWithOfficialJwt(
      context as unknown as Parameters<typeof createJwk>[0]['context'],
      options,
      async (next) => {
        captured = next
        return {
          createdAt: 12_001,
          newKid: next.id,
          previousKids: ['K1'],
          previousVerifyUntil: 1_272_000,
          rotatedAt: 12_000,
        }
      },
    )

    expect(captured).toMatchObject({ alg: 'RS256', crv: null })
    expect(JSON.parse(captured!.privateKey)).toMatch(/^\$ba\$7\$[0-9a-f]+$/u)
    expect(JSON.parse(captured!.publicKey)).toEqual({
      e: 'AQAB',
      kty: 'RSA',
      n: expect.any(String),
    })
    expect(metadata).toEqual({
      createdAt: 12_001,
      newKid: captured!.id,
      previousKids: ['K1'],
      previousVerifyUntil: 1_272_000,
      rotatedAt: 12_000,
    })
    expect(JSON.stringify(metadata)).not.toContain(captured!.privateKey)
  })

  it('publishes bounded public JWKS with the reviewed cache lifetime and no private row data', async () => {
    const database: MemoryDB = {}
    const value = createAuth(database, [{ value: currentSecret, version: 1 }])
    const { context, options } = await contextAndOptions(value)
    await rotateInMemory(database, context, options)
    const stored = database.jwks?.[0]
    if (!stored) throw new Error('Expected a stored signing key.')
    stored.privateKey = 'PRIVATE_ROW_SENTINEL'

    const response = await value.auth.handler(new Request(`${issuer}/jwks`))
    const raw = await response.text()
    const body = JSON.parse(raw) as unknown

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(JWKS_CACHE_CONTROL)
    expect(raw).not.toContain('PRIVATE_ROW_SENTINEL')
    expect(recursivelyContainsPrivateMember(body)).toBe(false)
  })

  it('keeps anonymous empty and concurrent discovery read-only', async () => {
    const database: MemoryDB = { jwks: [] }
    const value = createAuth(database, [{ value: currentSecret, version: 1 }])
    const { context, options } = await contextAndOptions(value)

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => value.auth.handler(new Request(`${issuer}/jwks`))),
    )

    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(503))
    expect(
      responses.every((response) => response.headers.get('cache-control') === 'private, no-store'),
    ).toBe(true)
    expect(database.jwks ?? []).toHaveLength(0)
    await expect(createJwk(endpointContext(context), options)).rejects.toThrow(
      'AUTH_JWKS_OPERATOR_SETUP_REQUIRED',
    )
    expect(database.jwks ?? []).toHaveLength(0)
  })

  it('keeps HEAD and unsupported JWKS methods read-only', async () => {
    const database: MemoryDB = {}
    const value = createAuth(database, [{ value: currentSecret, version: 1 }])
    const { context, options } = await contextAndOptions(value)
    await rotateInMemory(database, context, options)
    const before = structuredClone(database.jwks)

    const head = await value.auth.handler(new Request(`${issuer}/jwks`, { method: 'HEAD' }))
    const post = await value.auth.handler(new Request(`${issuer}/jwks`, { method: 'POST' }))

    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
    expect(database.jwks).toEqual(before)
  })

  it('fails closed instead of reflecting a recursively embedded private JWK member', async () => {
    const database: MemoryDB = {
      jwks: [
        {
          alg: 'RS256',
          createdAt: new Date(),
          id: 'malicious-public-row',
          privateKey: 'PRIVATE_ROW_SENTINEL',
          publicKey: JSON.stringify({
            e: 'AQAB',
            kty: 'RSA',
            metadata: { nested: [{ d: 'RECURSIVE_PRIVATE_SENTINEL' }] },
            n: 'modulus',
          }),
        },
      ],
    }
    const value = createAuth(database, [{ value: currentSecret, version: 1 }])
    const response = await value.auth.handler(new Request(`${issuer}/jwks`))
    const raw = await response.text()

    expect(response.status).toBe(500)
    expect(raw).not.toContain('PRIVATE_ROW_SENTINEL')
    expect(raw).not.toContain('RECURSIVE_PRIVATE_SENTINEL')
  })

  it('keeps a retired verification key published for exactly the 21-minute overlap', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const database: MemoryDB = {}
    const value = createAuth(database, [{ value: currentSecret, version: 1 }])
    const { context, options } = await contextAndOptions(value)
    const k1 = await rotateInMemory(database, context, options)
    const token = await signJWT(endpointContext(context), {
      options,
      payload: {
        aud: issuer,
        exp: 10_000,
        iat: 10,
        iss: issuer,
        sub: 'subject-1',
      },
    })

    vi.setSystemTime(20_000)
    const k2 = await rotateInMemory(database, context, options)
    const storedK1 = database.jwks?.find((key) => key.id === k1.id)
    if (!storedK1) throw new Error('Expected K1.')
    storedK1.expiresAt = new Date(20_000)

    const currentResponse = await value.auth.handler(new Request(`${issuer}/jwks`))
    const currentJwks = (await currentResponse.json()) as JSONWebKeySet
    expect(currentJwks.keys.map((key) => key.kid).sort()).toEqual([k1.id, k2.id].sort())
    await expect(
      jwtVerify(token, createLocalJWKSet(currentJwks), {
        algorithms: ['RS256'],
        audience: issuer,
        issuer,
      }),
    ).resolves.toMatchObject({ payload: { sub: 'subject-1' } })

    vi.setSystemTime(20_000 + JWKS_GRACE_PERIOD_SECONDS * 1_000 - 1)
    const beforeBoundary = (await (
      await value.auth.handler(new Request(`${issuer}/jwks`))
    ).json()) as JSONWebKeySet
    expect(beforeBoundary.keys.map((key) => key.kid)).toContain(k1.id)

    vi.setSystemTime(20_000 + JWKS_GRACE_PERIOD_SECONDS * 1_000)
    const atBoundary = (await (
      await value.auth.handler(new Request(`${issuer}/jwks`))
    ).json()) as JSONWebKeySet
    expect(atBoundary.keys.map((key) => key.kid)).not.toContain(k1.id)
    expect(atBoundary.keys.map((key) => key.kid)).toContain(k2.id)
  })

  it('decrypts retained keys with a prior secret version and fails without deleting on retirement', async () => {
    const database: MemoryDB = {}
    const first = createAuth(database, [{ value: previousSecret, version: 1 }])
    const firstContext = await contextAndOptions(first)
    const k1 = await rotateInMemory(database, firstContext.context, firstContext.options)

    const retained = createAuth(database, [
      { value: currentSecret, version: 2 },
      { value: previousSecret, version: 1 },
    ])
    const retainedContext = await contextAndOptions(retained)
    await expect(
      resolveSigningKey(endpointContext(retainedContext.context), retainedContext.options, {
        signingKeyId: k1.id,
      }),
    ).resolves.toMatchObject({ alg: 'RS256', kid: k1.id })

    const retired = createAuth(database, [{ value: currentSecret, version: 2 }])
    const retiredContext = await contextAndOptions(retired)
    await expect(
      resolveSigningKey(endpointContext(retiredContext.context), retiredContext.options, {
        signingKeyId: k1.id,
      }),
    ).rejects.toThrow('Failed to decrypt private key')
    expect(database.jwks?.map((key) => key.id)).toEqual([k1.id])
  })

  it('rejects automatic action-timestamp rotation configuration', async () => {
    const value = createAuth({}, [{ value: currentSecret, version: 1 }], {
      rotationInterval: 60,
    })
    await expect(value.auth.$context).rejects.toThrow('AUTH_JWKS_CONFIG_INVALID')
  })

  it('rejects a plugin order that initializes Convex auth before the shared JWT graph', async () => {
    const value = betterAuth({
      advanced: { ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } },
      basePath: '/api/auth',
      baseURL: origin,
      database: memoryAdapter({}),
      logger: { disabled: true },
      plugins: [createConvexPlugin(), createJwtPlugin()],
      rateLimit: { enabled: true, modelName: 'rateLimit', storage: 'database' },
      secrets: [{ value: currentSecret, version: 1 }],
    })
    await expect(value.$context).rejects.toThrow('AUTH_JWKS_CONFIG_INVALID')
  })
})
