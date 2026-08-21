import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'

const { betterAuth } = vi.hoisted(() => ({
  betterAuth: vi.fn((options: unknown) => ({
    $context: Promise.resolve(),
    handler: vi.fn(),
    options,
  })),
}))

vi.mock('better-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth')>()),
  betterAuth,
}))

const previousEnvironment = {
  BETTER_AUTH_SECRETS: process.env.BETTER_AUTH_SECRETS,
  CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
  SITE_URL: process.env.SITE_URL,
}

beforeEach(() => {
  process.env.BETTER_AUTH_SECRETS = `0:${'test-secret'.repeat(4)}`
  process.env.CONVEX_SITE_URL = 'https://deployment.convex.site'
  process.env.SITE_URL = 'https://app.example.test'
  betterAuth.mockClear()
})

afterEach(() => {
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
})

function component() {
  const reference = {} as never
  return {
    adapter: {
      consumeOne: reference,
      count: reference,
      create: reference,
      deleteMany: reference,
      deleteOne: reference,
      findMany: reference,
      findOne: reference,
      incrementOne: reference,
      rotateSigningKey: reference,
      updateMany: reference,
      updateOne: reference,
    },
  } as never
}

describe('createBetterConvexAuth', () => {
  it('owns the adapter, hardened defaults, and reviewed plugin order', async () => {
    const auth = createBetterConvexAuth(component(), {
      emailOTP: { async sendVerificationOTP() {} },
      organization: {},
      twoFactor: { issuer: 'Example' },
    })

    await auth.createAuth({} as never)
    const options = betterAuth.mock.calls[0]?.[0] as {
      account: { encryptOAuthTokens: boolean; storeAccountCookie: boolean }
      advanced: { ipAddress: { ipAddressHeaders: string[] } }
      plugins: Array<{ id: string }>
      rateLimit: { modelName: string; storage: string }
      verification: { storeIdentifier: string }
    }

    expect(options.plugins.map(({ id }) => id)).toEqual([
      'organization',
      'two-factor',
      'email-otp',
      'jwt',
      '@lupinum/better-convex-nuxt',
    ])
    expect(options).toMatchObject({
      account: { encryptOAuthTokens: true, storeAccountCookie: false },
      advanced: { ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } },
      rateLimit: { modelName: 'rateLimit', storage: 'database' },
      verification: { storeIdentifier: 'hashed' },
    })
    expect(typeof auth.registerRoutes).toBe('function')
    expect(typeof auth.jwksOperatorFunctions).toBe('function')
    expect(typeof auth.triggerFunctions).toBe('function')
  })

  it.each(['plugins', 'database', 'advanced', 'rateLimit', 'baseURL', 'basePath'])(
    'rejects an unsafe override of owned option %s',
    (key) => {
      expect(() => createBetterConvexAuth(component(), { [key]: [] } as never)).toThrow(
        `owns "${key}"`,
      )
    },
  )

  it('keeps password verification and minimum policy factory-owned', async () => {
    expect(() =>
      createBetterConvexAuth(component(), {
        emailAndPassword: { password: { verify: async () => true } },
      } as never),
    ).toThrow('emailAndPassword.password')

    const auth = createBetterConvexAuth(component(), {
      emailAndPassword: { requireEmailVerification: true },
    })

    await auth.createAuth({} as never)
    expect(betterAuth.mock.calls[0]?.[0]).toMatchObject({
      emailAndPassword: {
        autoSignIn: false,
        enabled: true,
        minPasswordLength: 15,
        requireEmailVerification: true,
      },
    })
  })

  it('rejects session schema and policy overrides outside the reviewed cache control', () => {
    expect(() =>
      createBetterConvexAuth(component(), {
        session: { additionalFields: { role: { type: 'string' } } },
      } as never),
    ).toThrow('session.additionalFields')
    expect(() =>
      createBetterConvexAuth(component(), { session: { expiresIn: 1 } } as never),
    ).toThrow('session.expiresIn')
  })

  it('reports one sanitized configuration error when required secrets are absent', async () => {
    Reflect.deleteProperty(process.env, 'BETTER_AUTH_SECRETS')
    const auth = createBetterConvexAuth(component())
    await expect(auth.createAuth({} as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
  })

  it.each([
    '0:short',
    'not-versioned',
    `0:${'a'.repeat(32)},0:${'b'.repeat(32)}`,
    `1:${'a'.repeat(31)},0:${'b'.repeat(32)}`,
  ])('rejects malformed or weak versioned secrets without constructing auth', async (secrets) => {
    process.env.BETTER_AUTH_SECRETS = secrets
    const auth = createBetterConvexAuth(component())

    await expect(auth.createAuth({} as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
    expect(betterAuth).not.toHaveBeenCalled()
  })

  it('accepts unique versioned secrets when every value meets the minimum', async () => {
    process.env.BETTER_AUTH_SECRETS = `2:${'a'.repeat(32)},1:${'b'.repeat(32)}`
    const auth = createBetterConvexAuth(component())

    await expect(auth.createAuth({} as never)).resolves.toBeDefined()
    expect(betterAuth).toHaveBeenCalledOnce()
  })
})
