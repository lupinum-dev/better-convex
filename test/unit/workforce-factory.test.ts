import type { BetterAuthOptions } from 'better-auth'
import { getAuthTables } from 'better-auth/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateAuthSchemaArtifacts } from '../../src/runtime/convex-auth/adapter/generate-schema'
import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'
import { createWorkforceAuthSchemaOptions } from '../../src/runtime/convex-auth/workforce/profile'
import { hasWorkforceSchema } from '../../src/runtime/convex-auth/workforce/schema'

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock('better-auth', async (original) => ({
  ...(await original<typeof import('better-auth')>()),
  betterAuth: (options: BetterAuthOptions) => {
    capture(options)
    return { $context: Promise.resolve(), api: {}, handler: vi.fn() }
  },
}))

const assertProfile = {} as never
const component = { adapter: { assertProfile } } as never
const admission = { beforeUserCreate: () => ({ allowed: true as const }) }
beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
  vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'synthetic-test-secret'.repeat(2)}`)
  capture.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('owned workforce factory', () => {
  it('owns the fixed profile and matches its environment-free build-time schema', async () => {
    const ctx = { runQuery: vi.fn().mockResolvedValue(null) }
    await createBetterConvexAuth(component, { workforce: true, ...admission }).createAuth(
      ctx as never,
    )
    expect(ctx.runQuery).toHaveBeenCalledExactlyOnceWith(assertProfile, { workforce: true })
    const options = capture.mock.calls[0]![0] as BetterAuthOptions
    expect(options.plugins?.map(({ id }) => id)).toEqual([
      'two-factor',
      'bcn-workforce-schema',
      'jwt',
      '@lupinum/better-convex-nuxt',
      'bcn-workforce-policy',
    ])
    expect(options).toMatchObject({
      emailAndPassword: {
        enabled: true,
        autoSignIn: false,
        minPasswordLength: 15,
        requireEmailVerification: true,
        revokeSessionsOnPasswordReset: true,
      },
      session: {
        cookieCache: { enabled: false },
        disableSessionRefresh: true,
        expiresIn: 43200,
        freshAge: 300,
      },
      verification: { storeIdentifier: 'hashed' },
      rateLimit: { enabled: true, storage: 'database' },
    })
    expect(options.databaseHooks?.session?.create?.after).toBeTypeOf('function')
    expect(options.databaseHooks?.user?.create?.before).toBeTypeOf('function')
    const runtime = generateAuthSchemaArtifacts(getAuthTables(options)).metadata
    vi.stubEnv('SITE_URL', '')
    vi.stubEnv('CONVEX_SITE_URL', '')
    vi.stubEnv('BETTER_AUTH_SECRETS', '')
    const build = generateAuthSchemaArtifacts(
      getAuthTables(createWorkforceAuthSchemaOptions()),
    ).metadata
    expect(build).toEqual(runtime)
    expect(hasWorkforceSchema(build)).toBe(true)
    expect(build.models).toHaveProperty('jwks')
    expect(build.models).toHaveProperty('rateLimit')
  })

  it.each([true, false])(
    'fails closed if canonical schema disagrees (workforce=%s)',
    async (workforce) => {
      const ctx = {
        runQuery: vi.fn().mockRejectedValue(new Error('AUTH_WORKFORCE_SCHEMA_MISMATCH')),
      }
      const auth = createBetterConvexAuth(component, {
        ...(workforce ? { workforce: true as const } : {}),
        ...admission,
      })
      await expect(auth.createAuth(ctx as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
      expect(capture).not.toHaveBeenCalled()
      expect(ctx.runQuery).toHaveBeenCalledExactlyOnceWith(assertProfile, { workforce })
    },
  )

  it.each(['twoFactor', 'emailOTP', 'organization', 'oauthProvider', 'socialProviders'])(
    'rejects caller-selected alternate capability %s',
    (key) => {
      expect(() =>
        createBetterConvexAuth(component, { workforce: true, ...admission, [key]: {} } as never),
      ).toThrow(`AUTH_WORKFORCE_UNSUPPORTED_OPTION:${key}`)
    },
  )

  it('rejects a cookie cache that would bypass live session reads', () => {
    expect(() =>
      createBetterConvexAuth(component, {
        workforce: true,
        ...admission,
        session: { cookieCache: { enabled: true } },
      }),
    ).toThrow('AUTH_WORKFORCE_COOKIE_CACHE_FORBIDDEN')
  })

  it.each([false, { requireEmailVerification: false }, { revokeSessionsOnPasswordReset: false }])(
    'rejects weakened password policy %j even from a request factory',
    async (policy) => {
      const auth = createBetterConvexAuth(component, {
        workforce: true,
        ...admission,
        emailAndPassword: async () => policy,
      } as never)
      await expect(auth.createAuth({ runQuery: vi.fn() } as never)).rejects.toThrow(
        'AUTH_CONFIG_INVALID',
      )
      expect(capture).not.toHaveBeenCalled()
    },
  )

  it('requires explicit signup admission or disabled signup', async () => {
    const ctx = { runQuery: vi.fn().mockResolvedValue(null) }
    await expect(
      createBetterConvexAuth(component, { workforce: true }).createAuth(ctx as never),
    ).rejects.toThrow('AUTH_CONFIG_INVALID')
    expect(ctx.runQuery).not.toHaveBeenCalled()
    await expect(
      createBetterConvexAuth(component, {
        workforce: true,
        emailAndPassword: { disableSignUp: true },
      }).createAuth(ctx as never),
    ).resolves.toBeDefined()
  })

  it.each([false, true])(
    'rejects email-link automatic sign-in (requestFactory=%s)',
    async (requestFactory) => {
      const policy = { autoSignInAfterVerification: true }
      const auth = createBetterConvexAuth(component, {
        workforce: true,
        ...admission,
        emailVerification: requestFactory ? async () => policy : policy,
      })
      await expect(auth.createAuth({ runQuery: vi.fn() } as never)).rejects.toThrow(
        'AUTH_CONFIG_INVALID',
      )
      expect(capture).not.toHaveBeenCalled()
    },
  )
})
