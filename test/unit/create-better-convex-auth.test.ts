import type { BetterAuthOptions } from 'better-auth'
import { httpRouter, makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthCtx } from '../../src/runtime/convex-auth/context'
import {
  createBetterConvexAuth,
  type BetterConvexAuthEmail,
} from '../../src/runtime/convex-auth/create-better-convex-auth'
import type { PinnedOAuthProviderProfile } from '../../src/runtime/convex-auth/oauth-security'
import { createBetterConvexTestAuth } from '../../src/runtime/convex-auth/test'
import { signClientIp } from '../../src/runtime/shared/client-ip'

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

const { convexAuthOptions } = vi.hoisted(() => ({ convexAuthOptions: [] as unknown[] }))

vi.mock('../../src/runtime/convex-auth/plugin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/runtime/convex-auth/plugin')>()
  return {
    ...actual,
    convexAuth: (options: Parameters<typeof actual.convexAuth>[0]) => {
      convexAuthOptions.push(options)
      return actual.convexAuth(options)
    },
  }
})

type SessionClaimsInput = { session: Record<string, unknown>; user: Record<string, unknown> }

function lastSessionClaims() {
  const options = convexAuthOptions.at(-1) as {
    sessionJwt: { definePayload: (input: SessionClaimsInput) => Promise<Record<string, unknown>> }
  }
  return options.sessionJwt.definePayload
}

const previousEnvironment = {
  BETTER_AUTH_SECRETS: process.env.BETTER_AUTH_SECRETS,
  CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
  SITE_URL: process.env.SITE_URL,
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  process.env.BETTER_AUTH_SECRETS = `0:${'test-secret'.repeat(4)}`
  process.env.CONVEX_SITE_URL = 'https://deployment.convex.site'
  process.env.SITE_URL = 'https://app.example.test'
  betterAuth.mockClear()
  convexAuthOptions.length = 0
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
})

function queryContext() {
  return { runQuery: vi.fn().mockResolvedValue(null) }
}

function writableContext() {
  return { ...queryContext(), runMutation: vi.fn().mockResolvedValue(null) }
}

function loggedSubCodes(): unknown[] {
  return consoleError.mock.calls.map(
    (call: unknown[]) => (call[1] as { subCode?: unknown }).subCode,
  )
}

function loggedText(): string {
  return JSON.stringify(consoleError.mock.calls)
}

const emailUserRow = {
  id: 'user',
  email: 'person@example.test',
  emailVerified: false,
  name: 'Person',
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

function component() {
  const reference = {} as never
  return {
    adapter: {
      consumeOne: reference,
      consumeRateLimit: reference,
      count: reference,
      create: reference,
      deleteMany: reference,
      deleteOne: reference,
      findMany: reference,
      findOne: reference,
      incrementOne: reference,
      rotateSigningKey: reference,
      sessionAdmission: reference,
      updateMany: reference,
      updateOne: reference,
    },
  } as never
}

function oauthProfile(): PinnedOAuthProviderProfile {
  return {
    accessTokenExpiresIn: 600,
    allowDynamicClientRegistration: false,
    allowPublicClientPrelogin: true,
    allowUnauthenticatedClientRegistration: false,
    clientPrivileges: async () => true,
    codeExpiresIn: 120,
    consentPage: '/oauth/consent',
    customAccessTokenClaims: () => ({ token_use: 'oauth-access' }),
    dpop: { signingAlgorithms: [] },
    enforcePerClientResources: true,
    grantTypes: ['authorization_code'],
    loginPage: '/login',
    rateLimit: {
      authorize: { max: 30, window: 60 },
      revoke: { max: 30, window: 60 },
      token: { max: 20, window: 60 },
    },
    resourcePrivileges: async () => true,
    scopes: ['cms.read', 'cms.entries.edit'],
    storeClientSecret: 'hashed',
    storeTokens: 'hashed',
  }
}

function oauthAdapter(
  overrides: {
    create?: (input: {
      data: Record<string, unknown>
      model: string
    }) => Promise<Record<string, unknown>>
    delete?: (input: {
      model: string
      where: Array<{ field: string; value: string }>
    }) => Promise<unknown>
    deleteMany?: (input: {
      model: string
      where: Array<{ field: string; value: string }>
    }) => Promise<unknown>
  } = {},
) {
  const resources = new Map<string, Record<string, unknown>>()
  const create = vi.fn(
    overrides.create ??
      (async ({ data, model }) => {
        if (model === 'oauthResource') resources.set(data.identifier as string, data)
        return data
      }),
  )
  const deleteRecord = vi.fn(overrides.delete ?? (async () => undefined))
  const deleteMany = vi.fn(overrides.deleteMany ?? (async () => undefined))
  const findOne = vi.fn(async ({ where }: { where: Array<{ value: string }> }) => {
    return resources.get(where[0]!.value) ?? null
  })
  return { create, delete: deleteRecord, deleteMany, findOne }
}

function authWithAdapter(adapter: ReturnType<typeof oauthAdapter>) {
  return (options: unknown) =>
    ({
      $context: Promise.resolve({ adapter }),
      api: {},
      handler: vi.fn(),
      options,
    }) as never
}

describe('createBetterConvexAuth', () => {
  it('owns the adapter, hardened defaults, and reviewed plugin order', async () => {
    const auth = createBetterConvexAuth(component(), {
      email: async () => {},
      emailOTP: {},
      organization: {},
      twoFactor: { issuer: 'Example' },
    })

    await auth.createAuth(queryContext() as never)
    const options = betterAuth.mock.calls[0]?.[0] as {
      account: { encryptOAuthTokens: boolean; storeAccountCookie: boolean }
      disabledPaths: string[]
      session: { expiresIn: number; updateAge: number }
      advanced: { ipAddress: { ipAddressHeaders: string[] } }
      plugins: Array<{ id: string }>
      rateLimit: { customStorage: { consume: unknown }; modelName: string; storage: string }
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
      account: {
        encryptOAuthTokens: true,
        storeAccountCookie: false,
        accountLinking: {
          allowDifferentEmails: false,
          allowUnlinkingAll: false,
          disableImplicitLinking: true,
          trustedProviders: [],
        },
      },
      session: { expiresIn: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
      advanced: {
        ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] },
      },
      rateLimit: { modelName: 'rateLimit', storage: 'database' },
      verification: { storeIdentifier: 'hashed' },
    })
    expect(typeof auth.registerRoutes).toBe('function')
    expect(typeof auth.jwksOperatorFunctions).toBe('function')
    expect(typeof auth.oauthOperator.createPublicClient).toBe('function')
    expect(typeof auth.triggerFunctions).toBe('function')
    expect(options.disabledPaths).toEqual(
      expect.arrayContaining(['/token', '/get-access-token', '/refresh-token']),
    )
    expect(options.rateLimit.customStorage.consume).toBeTypeOf('function')
    expect(Object.keys(auth).sort()).toEqual([
      'createAuth',
      'createMcpAccessVerifier',
      'getAuth',
      'getUser',
      'jwksOperatorFunctions',
      'mcp',
      'oauthConnections',
      'oauthOperator',
      'registerRoutes',
      'requireMcpPrincipal',
      'requireUser',
      'sessionHttpAction',
      'triggerFunctions',
      'validateOAuthAccess',
    ])
  })

  it('retries only confirmed uncommitted rate-limit contention with a fixed bound', async () => {
    const consumeRateLimit = { operation: 'consumeRateLimit' }
    const systemConflict = new Error(
      'Documents read from or written to the table "rateLimit" changed while this mutation was being run and on every subsequent retry.',
    )
    const ctx = {
      ...queryContext(),
      runMutation: vi
        .fn()
        .mockRejectedValueOnce(systemConflict)
        .mockRejectedValueOnce(systemConflict)
        .mockResolvedValueOnce({ allowed: true, retryAfter: null }),
    }
    const componentWithRateLimit = component() as unknown as {
      adapter: Record<string, unknown>
    }
    componentWithRateLimit.adapter.consumeRateLimit = consumeRateLimit
    const auth = createBetterConvexAuth(componentWithRateLimit as never)

    await auth.createAuth(ctx as never)
    const options = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    await expect(
      options.rateLimit!.customStorage!.consume('client|/get-session', {
        max: 100,
        window: 10,
      }),
    ).resolves.toEqual({ allowed: true, retryAfter: null })
    expect(ctx.runMutation).toHaveBeenCalledTimes(3)
    expect(ctx.runMutation).toHaveBeenLastCalledWith(consumeRateLimit, {
      key: 'client|/get-session',
      max: 100,
      retentionWindow: 60,
      window: 10,
    })

    ctx.runMutation.mockClear()
    ctx.runMutation.mockRejectedValueOnce(new Error('AUTH_RATE_LIMIT_ROW_INVALID'))
    await expect(
      options.rateLimit!.customStorage!.consume('client|/get-session', {
        max: 100,
        window: 10,
      }),
    ).rejects.toThrow('AUTH_RATE_LIMIT_ROW_INVALID')
    expect(ctx.runMutation).toHaveBeenCalledTimes(1)

    ctx.runMutation.mockClear()
    ctx.runMutation.mockRejectedValueOnce(new Error('optimistic concurrency control failure'))
    await expect(
      options.rateLimit!.customStorage!.consume('client|/get-session', {
        max: 100,
        window: 10,
      }),
    ).rejects.toThrow('optimistic concurrency control failure')
    expect(ctx.runMutation).toHaveBeenCalledTimes(1)

    ctx.runMutation.mockClear()
    ctx.runMutation.mockRejectedValue(systemConflict)
    await expect(
      options.rateLimit!.customStorage!.consume('client|/get-session', {
        max: 100,
        window: 10,
      }),
    ).rejects.toThrow(systemConflict.message)
    expect(ctx.runMutation).toHaveBeenCalledTimes(6)

    ctx.runMutation.mockClear()
    Object.assign(ctx, { db: {} })
    await expect(
      options.rateLimit!.customStorage!.consume('client|/get-session', {
        max: 100,
        window: 10,
      }),
    ).rejects.toThrow(systemConflict.message)
    expect(ctx.runMutation).toHaveBeenCalledTimes(1)
  })

  it.each([
    'plugins',
    'database',
    'databaseHooks',
    'user',
    'advanced',
    'rateLimit',
    'baseURL',
    'basePath',
  ])('rejects an unsafe override of owned option %s', (key) => {
    expect(() => createBetterConvexAuth(component(), { [key]: [] } as never)).toThrow(
      `owns "${key}"`,
    )
  })

  it('keeps password verification and minimum policy factory-owned', async () => {
    expect(() =>
      createBetterConvexAuth(component(), {
        emailAndPassword: { password: { verify: async () => true } },
      } as never),
    ).toThrow('emailAndPassword.password')

    const auth = createBetterConvexAuth(component(), {
      emailAndPassword: { requireEmailVerification: true },
    })

    await auth.createAuth(queryContext() as never)
    expect(betterAuth.mock.calls[0]?.[0]).toMatchObject({
      emailAndPassword: {
        autoSignIn: false,
        enabled: true,
        minPasswordLength: 15,
        requireEmailVerification: true,
      },
    })
  })

  it('rejects session schema overrides and unknown options loudly', () => {
    expect(() =>
      createBetterConvexAuth(component(), {
        session: { additionalFields: { role: { type: 'string' } } },
      } as never),
    ).toThrow('session.additionalFields')
    expect(() =>
      createBetterConvexAuth(component(), {
        session: { freshAge: 0 },
      } as never),
    ).toThrow('session.freshAge')
    expect(() => createBetterConvexAuth(component(), { trustedOrigins: ['*'] } as never)).toThrow(
      '"trustedOrigins"',
    )
  })

  it('applies a bounded session policy in seconds', async () => {
    const auth = createBetterConvexAuth(component(), {
      session: {
        cookieCache: { enabled: true, maxAge: 300, strategy: 'compact' },
        expiresIn: 30 * 24 * 60 * 60,
        updateAge: 60 * 60,
      },
    })
    await auth.createAuth(queryContext() as never)
    expect((betterAuth.mock.calls[0]![0] as BetterAuthOptions).session).toEqual({
      cookieCache: { enabled: true, maxAge: 300, strategy: 'compact' },
      expiresIn: 30 * 24 * 60 * 60,
      updateAge: 60 * 60,
    })

    betterAuth.mockClear()
    await createBetterConvexAuth(component(), { session: { expiresIn: 3600 } }).createAuth(
      queryContext() as never,
    )
    // The 1d default update age never exceeds a shorter lifetime.
    expect((betterAuth.mock.calls[0]![0] as BetterAuthOptions).session).toEqual({
      expiresIn: 3600,
      updateAge: 3600,
    })
  })

  it.each([
    [{ expiresIn: 1 }, 'session.expiresIn'],
    [{ expiresIn: 60 * 60 - 1 }, 'session.expiresIn'],
    [{ expiresIn: 30 * 24 * 60 * 60 + 1 }, 'session.expiresIn'],
    [{ expiresIn: 7200.5 }, 'session.expiresIn'],
    [{ expiresIn: '30d' }, 'session.expiresIn'],
    [{ expiresIn: Number.POSITIVE_INFINITY }, 'session.expiresIn'],
    [{ updateAge: 5 * 60 - 1 }, 'session.updateAge'],
    [{ updateAge: 0 }, 'session.updateAge'],
    [{ expiresIn: 2 * 60 * 60, updateAge: 2 * 60 * 60 + 1 }, 'session.updateAge'],
    [{ updateAge: 8 * 24 * 60 * 60 }, 'session.updateAge'],
    [
      { cookieCache: { enabled: true, maxAge: 10 * 365 * 24 * 60 * 60 } },
      'session.cookieCache.maxAge',
    ],
    [{ cookieCache: { enabled: true, maxAge: 301 } }, 'session.cookieCache.maxAge'],
    [{ cookieCache: { enabled: true, maxAge: 0 } }, 'session.cookieCache.maxAge'],
    [{ cookieCache: { enabled: true, maxAge: 60.5 } }, 'session.cookieCache.maxAge'],
    [{ cookieCache: { enabled: 'yes' } }, 'session.cookieCache.enabled'],
    [{ cookieCache: { enabled: true, strategy: 'plain' } }, 'session.cookieCache.strategy'],
    [{ cookieCache: { enabled: true, refreshCache: true } }, 'session.cookieCache.refreshCache'],
    [{ cookieCache: { enabled: true, version: '2' } }, 'session.cookieCache.version'],
    [{ cookieCache: false }, 'session.cookieCache'],
  ])('rejects session policy %j outside the reviewed bounds', (session, path) => {
    expect(() => createBetterConvexAuth(component(), { session } as never)).toThrow(path)
    expect(betterAuth).not.toHaveBeenCalled()
  })

  it('admits only configured social providers as trusted linking providers', async () => {
    const github = { clientId: 'github-client', clientSecret: 'github-secret' }
    const auth = createBetterConvexAuth(component(), {
      account: { accountLinking: { trustedProviders: ['github'] } },
      socialProviders: { github },
    })
    await auth.createAuth(queryContext() as never)
    expect((betterAuth.mock.calls[0]![0] as BetterAuthOptions).account).toEqual({
      encryptOAuthTokens: true,
      storeAccountCookie: false,
      accountLinking: {
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        disableImplicitLinking: true,
        trustedProviders: ['github'],
      },
    })

    expect(() =>
      createBetterConvexAuth(component(), {
        account: { accountLinking: { trustedProviders: ['google'] } },
        socialProviders: { github },
      }),
    ).toThrow('"google" is not configured')
    expect(() =>
      createBetterConvexAuth(component(), {
        account: { accountLinking: { trustedProviders: ['email-password'] } },
      }),
    ).toThrow('"email-password" is not configured')
    expect(() =>
      createBetterConvexAuth(component(), {
        account: { accountLinking: { trustedProviders: ['github', 'github'] } },
        socialProviders: { github },
      }),
    ).toThrow('unique provider names')
  })

  it('re-validates trusted providers against lazily resolved social providers', async () => {
    const auth = createBetterConvexAuth(component(), {
      account: { accountLinking: { trustedProviders: ['github'] } },
      socialProviders: () => ({}),
    })
    await expect(auth.createAuth(queryContext() as never)).rejects.toThrow(/^AUTH_CONFIG_INVALID$/)
    expect(betterAuth).not.toHaveBeenCalled()
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_OPTIONS_INVALID'])
  })

  it.each([
    { allowDifferentEmails: true },
    { disableImplicitLinking: false },
    { allowUnlinkingAll: true },
    { enabled: false },
  ])('keeps every other account-linking policy factory-owned %j', (accountLinking) => {
    expect(() =>
      createBetterConvexAuth(component(), { account: { accountLinking } } as never),
    ).toThrow('account.accountLinking.')
  })

  it.each([
    { encryptOAuthTokens: false },
    { storeAccountCookie: true },
    { storeStateStrategy: 'cookie' },
  ])('rejects account storage overrides %j', (account) => {
    expect(() => createBetterConvexAuth(component(), { account } as never)).toThrow('account.')
  })

  it.each([
    ['emailAndPassword', { sendResetPassword: async () => {} }],
    ['emailVerification', { sendVerificationEmail: async () => {} }],
    ['emailOTP', { sendVerificationOTP: async () => {} }],
    ['organization', { sendInvitationEmail: async () => {} }],
    ['twoFactor', { otpOptions: { sendOTP: async () => {} } }],
  ])('routes %s delivery only through the typed email hook', (key, value) => {
    expect(() =>
      createBetterConvexAuth(component(), { email: async () => {}, [key]: value } as never),
    ).toThrow('deliver auth email through the "email" option')
  })

  it('requires the email hook before enabling email OTP', () => {
    expect(() => createBetterConvexAuth(component(), { emailOTP: {} })).toThrow(
      'requires the "email" option when "emailOTP" is enabled',
    )
  })

  it.each(['emailAndPassword', 'emailVerification', 'emailOTP'] as const)(
    'no longer accepts a request-scoped %s factory',
    (key) => {
      expect(() =>
        createBetterConvexAuth(component(), {
          email: async () => {},
          [key]: () => ({}),
        } as never),
      ).toThrow(`expected "${key}" to be an object`)
    },
  )

  it('delivers typed email messages with the request writable context', async () => {
    const submitMail = makeFunctionReference<'mutation', { message: BetterConvexAuthEmail }, null>(
      'authMail:submit',
    )
    const first = writableContext()
    const second = writableContext()
    const onPasswordReset = vi.fn()
    const email = vi.fn(async (ctx: { runMutation: unknown }, message: BetterConvexAuthEmail) => {
      expect(Object.isFrozen(message)).toBe(true)
      await (ctx as ReturnType<typeof writableContext>).runMutation(submitMail, { message })
    })
    const auth = createBetterConvexAuth(component(), {
      email,
      emailAndPassword: {
        passwordReset: true,
        revokeSessionsOnPasswordReset: true,
        onPasswordReset,
      },
      emailVerification: { expiresIn: 300 },
    })
    await Promise.all([auth.createAuth(first as never), auth.createAuth(second as never)])
    expect(first.runQuery).not.toHaveBeenCalled()
    const firstOptions = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    const secondOptions = betterAuth.mock.calls[1]![0] as BetterAuthOptions
    const data = {
      user: emailUserRow,
      token: 'synthetic-token',
      url: 'https://app.example.test/recover?token=synthetic-token',
    }
    await firstOptions.emailAndPassword!.sendResetPassword!(data)
    await secondOptions.emailVerification!.sendVerificationEmail!(data)
    const user = { id: 'user', email: 'person@example.test', name: 'Person' }
    expect(first.runMutation).toHaveBeenCalledExactlyOnceWith(submitMail, {
      message: { type: 'reset-password', to: user.email, url: data.url, token: data.token, user },
    })
    expect(second.runMutation).toHaveBeenCalledExactlyOnceWith(submitMail, {
      message: { type: 'verify-email', to: user.email, url: data.url, token: data.token, user },
    })
    expect(email.mock.calls[0]![0]).toBe(first)
    expect(email.mock.calls[1]![0]).toBe(second)
    expect(firstOptions.emailAndPassword).toMatchObject({
      enabled: true,
      autoSignIn: false,
      minPasswordLength: 15,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset,
    })
    expect(firstOptions.emailAndPassword).not.toHaveProperty('passwordReset')
    expect(secondOptions.emailVerification?.expiresIn).toBe(300)
  })

  it('enables password reset only when explicitly requested', async () => {
    await createBetterConvexAuth(component(), {
      email: async () => {},
      emailAndPassword: { requireEmailVerification: true },
    }).createAuth(writableContext() as never)
    const options = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    expect(options.emailAndPassword).not.toHaveProperty('sendResetPassword')
    expect(options.emailAndPassword).not.toHaveProperty('passwordReset')
    // Verification email still flows through the hook.
    expect(options.emailVerification?.sendVerificationEmail).toBeTypeOf('function')
  })

  it.each([
    [{ emailAndPassword: { passwordReset: true } }, 'requires the "email" option'],
    [
      { email: async () => {}, emailAndPassword: { passwordReset: 'yes' } },
      '"emailAndPassword.passwordReset" to be a boolean',
    ],
  ])('rejects password reset configuration %#', (options, message) => {
    expect(() => createBetterConvexAuth(component(), options as never)).toThrow(message)
  })

  it('maps OTP, two-factor, and invitation callbacks to the typed email union', async () => {
    const messages: BetterConvexAuthEmail[] = []
    const auth = createBetterConvexAuth(component(), {
      email: async (_ctx, message) => {
        messages.push(message)
      },
      emailOTP: { expiresIn: 300 },
      organization: {},
      twoFactor: { issuer: 'Example', otpOptions: { period: 3 } },
    })
    await auth.createAuth(writableContext() as never)
    const options = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    const plugin = (id: string) =>
      options.plugins!.find((candidate) => candidate.id === id) as unknown as {
        options: Record<string, never>
      }

    const otp = plugin('email-otp').options as unknown as {
      expiresIn: number
      sendVerificationOTP: (data: unknown) => Promise<void>
    }
    expect(otp.expiresIn).toBe(300)
    await otp.sendVerificationOTP({ email: 'person@example.test', otp: '123456', type: 'sign-in' })

    const twoFactorOptions = plugin('two-factor').options as unknown as {
      otpOptions: { period: number; sendOTP: (data: unknown) => Promise<void> }
    }
    expect(twoFactorOptions.otpOptions.period).toBe(3)
    await twoFactorOptions.otpOptions.sendOTP({ user: emailUserRow, otp: '654321' })

    const organizationOptions = plugin('organization').options as unknown as {
      sendInvitationEmail: (data: unknown) => Promise<void>
    }
    await organizationOptions.sendInvitationEmail({
      id: 'invitation',
      role: 'member',
      email: 'invitee@example.test',
      organization: { id: 'org', name: 'Org', slug: 'org', logo: 'private-logo' },
      invitation: { id: 'invitation' },
      inviter: { id: 'member', role: 'owner', user: emailUserRow },
    })

    expect(messages).toEqual([
      { type: 'email-otp', to: 'person@example.test', otp: '123456', purpose: 'sign-in' },
      {
        type: 'two-factor-otp',
        to: 'person@example.test',
        otp: '654321',
        user: { id: 'user', email: 'person@example.test', name: 'Person' },
      },
      {
        type: 'organization-invitation',
        to: 'invitee@example.test',
        invitationId: 'invitation',
        role: 'member',
        organization: { id: 'org', name: 'Org', slug: 'org' },
        inviter: { id: 'user', email: 'person@example.test', name: 'Person' },
      },
    ])
  })

  it('constructs query auth but refuses email delivery from a query context', async () => {
    const query = queryContext()
    const email = vi.fn(async () => {})
    const auth = createBetterConvexAuth(component(), {
      email,
      emailAndPassword: { passwordReset: true },
    })
    await expect(auth.createAuth(query as never)).resolves.toBeDefined()
    const options = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    await expect(
      options.emailAndPassword!.sendResetPassword!({
        user: emailUserRow,
        token: 'synthetic-token',
        url: 'https://app.example.test/recover',
      }),
    ).rejects.toThrow('AUTH_EMAIL_REQUIRES_WRITABLE_CONTEXT')
    expect(email).not.toHaveBeenCalled()
    expect(query.runQuery).not.toHaveBeenCalled()
  })

  it('retains the delivery promise and rejection so submission cannot be fire-and-forget', async () => {
    const submission = Promise.withResolvers<undefined>()
    const auth = createBetterConvexAuth(component(), { email: () => submission.promise })
    await auth.createAuth(writableContext() as never)
    const options = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    let settled = false
    const sending = options.emailVerification!.sendVerificationEmail!({
      user: emailUserRow,
      token: 'synthetic-token',
      url: 'https://app.example.test/verify',
    })
    const observed = Promise.resolve(sending).finally(() => {
      settled = true
    })
    const rejected = expect(observed).rejects.toThrow(/^AUTH_EMAIL_DELIVERY_FAILED$/)
    await Promise.resolve()
    expect(settled).toBe(false)
    submission.reject(new Error('submission failed'))
    await rejected
    expect(settled).toBe(true)
  })

  it('never hands a raw hook error that echoes credentials to Better Auth or the log', async () => {
    const auth = createBetterConvexAuth(component(), {
      // Stands in for e.g. a Convex argument validation error echoing its args;
      // a synchronous throw must be contained as well.
      email: (_ctx, message) => {
        throw new Error(`ArgumentValidationError: ${JSON.stringify(message)}`)
      },
      emailAndPassword: { passwordReset: true },
      emailOTP: {},
    })
    await auth.createAuth(writableContext() as never)
    const options = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    const reset = options.emailAndPassword!.sendResetPassword!({
      user: emailUserRow,
      token: 'rst',
      url: 'https://app.example.test/api/auth/reset-password/rst?callbackURL=%2F',
    })
    await expect(reset).rejects.toThrow(/^AUTH_EMAIL_DELIVERY_FAILED$/)
    const otp = (
      options.plugins!.find((plugin) => plugin.id === 'email-otp') as unknown as {
        options: { sendVerificationOTP: (data: unknown) => Promise<void> }
      }
    ).options
    await expect(
      otp.sendVerificationOTP({ email: 'person@example.test', otp: '482913', type: 'sign-in' }),
    ).rejects.toThrow(/^AUTH_EMAIL_DELIVERY_FAILED$/)

    const logged = loggedText()
    expect(logged).toContain('AUTH_EMAIL_DELIVERY_FAILED')
    expect(logged).toContain('reset-password')
    expect(logged).toContain('email-otp')
    expect(logged).not.toContain('reset-password/rst')
    expect(logged).not.toContain('482913')
  })

  it('leaves email callbacks unset without an email hook', async () => {
    await createBetterConvexAuth(component(), {
      organization: {},
      emailVerification: { sendOnSignUp: true },
    }).createAuth(queryContext() as never)
    const options = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    expect(options.emailAndPassword).not.toHaveProperty('sendResetPassword')
    expect(options.emailVerification).toEqual({ sendOnSignUp: true })
    expect(options.plugins?.map(({ id }) => id)).not.toContain('email-otp')
  })

  it('allows explicit password and OTP disablement', async () => {
    const auth = createBetterConvexAuth(component(), {
      emailAndPassword: false,
      emailOTP: false,
    })
    await auth.createAuth(queryContext() as never)
    const options = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    expect(options.emailAndPassword).toEqual({ enabled: false })
    expect(options.plugins?.map(({ id }) => id)).not.toContain('email-otp')
  })

  it.each([
    [
      '/token re-enabled',
      (o: BetterAuthOptions) => ({ ...o, disabledPaths: ['/get-access-token', '/refresh-token'] }),
    ],
    [
      '/get-access-token re-enabled',
      (o: BetterAuthOptions) => ({ ...o, disabledPaths: ['/token', '/refresh-token'] }),
    ],
    [
      '/refresh-token re-enabled',
      (o: BetterAuthOptions) => ({ ...o, disabledPaths: ['/token', '/get-access-token'] }),
    ],
    [
      'plaintext OAuth tokens',
      (o: BetterAuthOptions) => ({ ...o, account: { ...o.account, encryptOAuthTokens: false } }),
    ],
    [
      'account cookie',
      (o: BetterAuthOptions) => ({ ...o, account: { ...o.account, storeAccountCookie: true } }),
    ],
    [
      'different-email linking',
      (o: BetterAuthOptions) => ({
        ...o,
        account: {
          ...o.account,
          accountLinking: { ...o.account!.accountLinking, allowDifferentEmails: true },
        },
      }),
    ],
    [
      'unconfigured trusted provider',
      (o: BetterAuthOptions) => ({
        ...o,
        account: {
          ...o.account,
          accountLinking: { ...o.account!.accountLinking, trustedProviders: ['google'] },
        },
      }),
    ],
    [
      'unbounded session',
      (o: BetterAuthOptions) => ({
        ...o,
        session: { expiresIn: 365 * 24 * 60 * 60, updateAge: 60 },
      }),
    ],
    [
      'unbounded session cookie cache',
      (o: BetterAuthOptions) => ({
        ...o,
        session: { ...o.session, cookieCache: { enabled: true, maxAge: 365 * 24 * 60 * 60 } },
      }),
    ],
    [
      'stateless session cookie cache refresh',
      (o: BetterAuthOptions) => ({
        ...o,
        session: { ...o.session, cookieCache: { enabled: true, refreshCache: true } },
      }),
    ],
    [
      'weak password floor',
      (o: BetterAuthOptions) => ({
        ...o,
        emailAndPassword: { ...o.emailAndPassword!, minPasswordLength: 8 },
      }),
    ],
  ] as const)('fails closed when the final Better Auth graph has %s', async (_name, tamper) => {
    betterAuth.mockImplementationOnce(
      (options: unknown) =>
        ({
          $context: Promise.resolve({ options: tamper(options as BetterAuthOptions) }),
          handler: vi.fn(),
          options,
        }) as never,
    )
    const auth = createBetterConvexAuth(component())
    await expect(auth.createAuth(queryContext() as never)).rejects.toThrow(/^AUTH_CONFIG_INVALID$/)
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_CONSTRUCTION_FAILED'])
    expect(loggedText()).toContain('AUTH_OWNED_INVARIANT_VIOLATED')
  })

  it('includes bounded profile claims in the session token by default', async () => {
    await createBetterConvexAuth(component()).createAuth(queryContext() as never)
    const define = lastSessionClaims()
    await expect(
      define({
        session: { id: 'session' },
        user: {
          ...emailUserRow,
          emailVerified: true,
          image: 'https://cdn.example.test/avatar.png',
        },
      }),
    ).resolves.toEqual({
      email: 'person@example.test',
      emailVerified: true,
      image: 'https://cdn.example.test/avatar.png',
      name: 'Person',
    })
    // Inline or oversized values are omitted instead of bloating every token.
    await expect(
      define({
        session: { id: 'session' },
        user: {
          ...emailUserRow,
          image: `data:image/png;base64,${'A'.repeat(64)}`,
          name: 'N'.repeat(257),
        },
      }),
    ).resolves.toEqual({ email: 'person@example.test', emailVerified: false })
  })

  it('lets defineSessionClaims extend and override defaults', async () => {
    await createBetterConvexAuth(component(), {
      defineSessionClaims: ({ user }) => ({ name: `~${user.name}`, role: 'member' }),
    }).createAuth(queryContext() as never)
    await expect(
      lastSessionClaims()({ session: { id: 'session' }, user: emailUserRow }),
    ).resolves.toEqual({
      email: 'person@example.test',
      emailVerified: false,
      name: '~Person',
      role: 'member',
    })
  })

  it.each(['sid', 'token_use'])(
    'keeps library-owned claim %s out of custom claims',
    async (claim) => {
      await createBetterConvexAuth(component(), {
        defineSessionClaims: () => ({ [claim]: 'forged' }),
      }).createAuth(queryContext() as never)
      await expect(
        lastSessionClaims()({ session: { id: 'session' }, user: emailUserRow }),
      ).rejects.toThrow(`AUTH_SESSION_JWT_RESERVED_CLAIM:${claim}`)
    },
  )

  it('bounds the serialized session claims', async () => {
    await createBetterConvexAuth(component(), {
      defineSessionClaims: () => ({ blob: 'x'.repeat(5000) }),
    }).createAuth(queryContext() as never)
    await expect(
      lastSessionClaims()({ session: { id: 'session' }, user: emailUserRow }),
    ).rejects.toThrow('AUTH_SESSION_JWT_CLAIMS_TOO_LARGE')
  })

  it('logs a stable sub-code for each opaque configuration stage without secrets', async () => {
    const secret = `0:${'s3cr3t-value-'.repeat(2)}`
    process.env.BETTER_AUTH_SECRETS = secret
    const weak = createBetterConvexAuth(component())
    await expect(weak.createAuth(queryContext() as never)).rejects.toThrow(/^AUTH_CONFIG_INVALID$/)
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_SECRETS_INVALID'])
    expect(consoleError.mock.calls[0]![0]).toBe('[better-convex] AUTH_CONFIG_INVALID')

    consoleError.mockClear()
    process.env.BETTER_AUTH_SECRETS = `0:${'test-secret'.repeat(4)}`
    process.env.SITE_URL = 'not a url'
    await expect(weak.createAuth(queryContext() as never)).rejects.toThrow(/^AUTH_CONFIG_INVALID$/)
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_SITE_URL_INVALID'])

    consoleError.mockClear()
    process.env.SITE_URL = 'https://app.example.test'
    Reflect.deleteProperty(process.env, 'CONVEX_SITE_URL')
    await expect(weak.createAuth(queryContext() as never)).rejects.toThrow(/^AUTH_CONFIG_INVALID$/)
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_CONVEX_SITE_URL_INVALID'])

    consoleError.mockClear()
    process.env.CONVEX_SITE_URL = 'https://deployment.convex.site'
    const privateToken = 'eyJhbGciOiJSUzI1NiJ9.private-session-token-value'
    betterAuth.mockImplementationOnce(() => {
      throw new Error(`construction failed with token=${privateToken} cookie: a=b`)
    })
    const failure = await Promise.resolve(weak.createAuth(queryContext() as never)).catch(
      (error: unknown) => error,
    )
    expect(failure).toEqual(new Error('AUTH_CONFIG_INVALID'))
    expect(JSON.stringify(failure)).toBe('{}')
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_CONSTRUCTION_FAILED'])
    expect(loggedText()).toContain('construction failed')
    expect(loggedText()).not.toContain(privateToken)
    expect(loggedText()).not.toContain('s3cr3t-value')
    expect(loggedText()).not.toContain('a=b')
  })

  it('admits a narrow user identity decision without exposing Better Auth hooks', async () => {
    const ctx = queryContext()
    const beforeUserCreate = vi.fn(async ({ user }) => {
      expect(Object.isFrozen(user)).toBe(true)
      return {
        allowed: true as const,
        user: {
          email: user.email.trim().toLowerCase(),
          id: 'existing-user-id',
        },
      }
    })
    const auth = createBetterConvexAuth(component(), { beforeUserCreate })

    await auth.createAuth(ctx as never)
    const options = betterAuth.mock.calls[0]?.[0] as {
      databaseHooks: {
        user: {
          create: {
            before: (user: Record<string, unknown>) => Promise<unknown>
          }
        }
      }
    }
    const user = {
      createdAt: new Date(),
      email: '  Owner@Example.test  ',
      emailVerified: false,
      id: 'generated-user-id',
      image: null,
      name: 'Owner',
      updatedAt: new Date(),
    }

    await expect(options.databaseHooks.user.create.before(user)).resolves.toEqual({
      data: {
        ...user,
        email: 'owner@example.test',
        id: 'existing-user-id',
      },
    })
    expect(beforeUserCreate).toHaveBeenCalledWith({
      ctx,
      user: {
        email: user.email,
        emailVerified: false,
        id: 'generated-user-id',
        image: null,
        name: 'Owner',
      },
    })
  })

  it.each([
    {
      name: 'explicit denial',
      callback: async () => ({ allowed: false as const }),
    },
    {
      name: 'private callback failure',
      callback: async () => Promise.reject(new Error('private')),
    },
    {
      name: 'invalid identity replacement',
      callback: async () => ({ allowed: true as const, user: { id: '  ' } }),
    },
  ])('fails closed with one sanitized error for $name', async ({ callback }) => {
    const auth = createBetterConvexAuth(component(), {
      beforeUserCreate: callback,
    })
    await auth.createAuth(queryContext() as never)
    const options = betterAuth.mock.calls[0]?.[0] as {
      databaseHooks: {
        user: {
          create: {
            before: (user: Record<string, unknown>) => Promise<unknown>
          }
        }
      }
    }

    await expect(
      options.databaseHooks.user.create.before({
        email: 'owner@example.test',
        emailVerified: false,
        id: 'generated-user-id',
        image: null,
        name: 'Owner',
      }),
    ).rejects.toThrow('AUTH_USER_CREATE_REJECTED')
  })

  it('builds one hardened OAuth profile from the request-scoped Convex context', async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValueOnce(oauthProfile()).mockResolvedValue(null),
    }
    const profileQuery = makeFunctionReference<'query'>('authPolicy:oauthProfile')
    const createProfile = vi.fn(async (requestCtx: AuthCtx) => requestCtx.runQuery(profileQuery))
    const auth = createBetterConvexAuth(component(), {
      oauthProvider: createProfile,
    })

    await auth.createAuth(ctx as never)

    expect(createProfile).toHaveBeenCalledOnce()
    expect(createProfile).toHaveBeenCalledWith(ctx)
    expect(ctx.runQuery).toHaveBeenCalledExactlyOnceWith(profileQuery)
    const options = betterAuth.mock.calls[0]?.[0] as {
      plugins: Array<{ id: string }>
    }
    expect(options.plugins.map(({ id }) => id)).toEqual([
      'jwt',
      '@lupinum/better-convex-nuxt',
      'oauth-provider',
    ])
  })

  it('preregisters and deletes a reviewed public OAuth client without exposing plugin APIs', async () => {
    const adapter = oauthAdapter()
    const authInstance = authWithAdapter(adapter)
    betterAuth.mockImplementationOnce(authInstance).mockImplementationOnce(authInstance)
    const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })
    const ctx = queryContext() as never

    await expect(
      auth.oauthOperator.createPublicClient(ctx, {
        name: 'Ginko certification',
        profile: 'ginko-certification-proof',
        redirectUris: ['http://localhost:3000/oauth-proof/callback'],
        resource: {
          identifier: 'https://deployment.convex.site/mcp',
          name: 'Ginko CMS MCP',
          ownership: 'application',
        },
        scopes: ['cms.read', 'cms.entries.edit'],
      }),
    ).resolves.toEqual({ clientId: expect.stringMatching(/^[a-f\d]{32}$/u) })
    expect(adapter.create).toHaveBeenCalledWith({
      model: 'oauthResource',
      data: expect.objectContaining({
        accessTokenTtl: 600,
        allowedScopes: ['cms.read', 'cms.entries.edit'],
        disabled: false,
        dpopBoundAccessTokensRequired: false,
        identifier: 'https://deployment.convex.site/mcp',
        name: 'Ginko CMS MCP',
        signingAlgorithm: 'RS256',
      }),
    })
    const clientCreate = adapter.create.mock.calls.find(([input]) => input.model === 'oauthClient')
    expect(clientCreate?.[0].data).toMatchObject({
      applicationType: 'native',
      grantTypes: ['authorization_code'],
      redirectUris: ['http://localhost:3000/oauth-proof/callback'],
      requirePKCE: true,
      scopes: ['cms.read', 'cms.entries.edit'],
      softwareId: 'ginko-certification-proof',
      subjectType: 'public',
      tokenEndpointAuthMethod: 'none',
    })
    expect(clientCreate?.[0].data).not.toHaveProperty('clientSecret')

    const clientId = clientCreate?.[0].data.clientId as string
    await auth.oauthOperator.deleteClient(ctx, { clientId })
    expect(adapter.deleteMany).toHaveBeenCalledWith({
      model: 'oauthClientResource',
      where: [{ field: 'clientId', value: clientId }],
    })
    expect(adapter.delete).toHaveBeenCalledWith({
      model: 'oauthClient',
      where: [{ field: 'clientId', value: clientId }],
    })
    expect(adapter.delete).not.toHaveBeenCalledWith(
      expect.objectContaining({ model: 'oauthResource' }),
    )
  })

  it('rejects invalid OAuth operator input before constructing auth', async () => {
    const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })

    await expect(
      auth.oauthOperator.createPublicClient(queryContext() as never, {
        name: 'Proof',
        profile: 'proof',
        redirectUris: ['not-a-url'],
        resource: {
          identifier: 'https://deployment.convex.site/mcp',
          name: 'Proof',
          ownership: 'application',
        },
        scopes: ['cms.read'],
      }),
    ).rejects.toThrow('AUTH_OAUTH_CLIENT_REDIRECT_URI_INVALID')
    expect(betterAuth).not.toHaveBeenCalled()
  })

  it.each([
    'ftp://agent.example.test/callback',
    'http://agent.example.test/callback',
    'https://user:password@agent.example.test/callback',
    'https://agent.example.test/callback#token',
  ])('rejects unsafe OAuth redirect %s before constructing auth', async (redirectUri) => {
    const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })

    await expect(
      auth.oauthOperator.createPublicClient(queryContext() as never, {
        name: 'Proof',
        profile: 'proof',
        redirectUris: [redirectUri],
        resource: {
          identifier: 'https://deployment.convex.site/mcp',
          name: 'Proof',
          ownership: 'application',
        },
        scopes: ['cms.read'],
      }),
    ).rejects.toThrow('AUTH_OAUTH_CLIENT_REDIRECT_URI_INVALID')
    expect(betterAuth).not.toHaveBeenCalled()
  })

  it.each([
    'ftp://deployment.convex.site/mcp',
    'http://deployment.convex.site/mcp',
    'https://user:password@deployment.convex.site/mcp',
    'https://deployment.convex.site/mcp?tenant=private',
    'https://deployment.convex.site/mcp#token',
  ])('rejects unsafe OAuth resource identifier %s', async (identifier) => {
    const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })

    await expect(
      auth.oauthOperator.createPublicClient(queryContext() as never, {
        name: 'Proof',
        profile: 'proof',
        redirectUris: ['https://agent.example.test/callback'],
        resource: {
          identifier,
          name: 'Proof',
          ownership: 'application',
        },
        scopes: ['cms.read'],
      }),
    ).rejects.toThrow('AUTH_OAUTH_CLIENT_RESOURCE_INVALID')
    expect(betterAuth).not.toHaveBeenCalled()
  })

  it('rejects resource ownership that the operator may not manage', async () => {
    const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })

    await expect(
      auth.oauthOperator.createPublicClient(queryContext() as never, {
        name: 'Proof',
        profile: 'proof',
        redirectUris: ['https://agent.example.test/callback'],
        resource: {
          identifier: 'https://deployment.convex.site/mcp',
          name: 'Proof',
          ownership: 'operator' as never,
        },
        scopes: ['cms.read'],
      }),
    ).rejects.toThrow('AUTH_OAUTH_CLIENT_RESOURCE_OWNERSHIP_INVALID')
    expect(betterAuth).not.toHaveBeenCalled()
  })

  it('rejects scopes outside the configured reviewed provider profile', async () => {
    const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })

    await expect(
      auth.oauthOperator.createPublicClient(queryContext() as never, {
        name: 'Proof',
        profile: 'proof',
        redirectUris: ['https://agent.example.test/callback'],
        resource: {
          identifier: 'https://deployment.convex.site/mcp',
          name: 'Proof',
          ownership: 'application',
        },
        scopes: ['cms.admin'],
      }),
    ).rejects.toThrow('AUTH_OAUTH_CLIENT_SCOPE_NOT_ADMITTED')
    expect(betterAuth).not.toHaveBeenCalled()
  })

  it('removes a newly created client and resource when resource linking fails', async () => {
    const adapter = oauthAdapter({
      create: async ({ data, model }) => {
        if (model === 'oauthClientResource') throw new Error('private provider failure')
        return data
      },
    })
    betterAuth.mockImplementationOnce(authWithAdapter(adapter))
    const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })

    await expect(
      auth.oauthOperator.createPublicClient(queryContext() as never, {
        name: 'Proof',
        profile: 'proof',
        redirectUris: ['https://agent.example.test/callback'],
        resource: {
          identifier: 'https://deployment.convex.site/mcp',
          name: 'Proof',
          ownership: 'application',
        },
        scopes: ['cms.read'],
      }),
    ).rejects.toThrow('AUTH_OAUTH_CLIENT_PROVISION_FAILED')
    expect(adapter.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'oauthClientResource' }),
    )
    expect(adapter.delete).toHaveBeenCalledWith(expect.objectContaining({ model: 'oauthClient' }))
    expect(adapter.delete).toHaveBeenCalledWith(expect.objectContaining({ model: 'oauthResource' }))
  })

  it('reports partial cleanup precisely and preserves the resource when client cleanup fails', async () => {
    const adapter = oauthAdapter({
      create: async ({ data, model }) => {
        if (model === 'oauthClientResource') throw new Error('private provider failure')
        return data
      },
      delete: async ({ model }) => {
        if (model === 'oauthClient') throw new Error('private cleanup failure')
      },
    })
    betterAuth.mockImplementationOnce(authWithAdapter(adapter))
    const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })

    await expect(
      auth.oauthOperator.createPublicClient(queryContext() as never, {
        name: 'Proof',
        profile: 'proof',
        redirectUris: ['https://agent.example.test/callback'],
        resource: {
          identifier: 'https://deployment.convex.site/mcp',
          name: 'Proof',
          ownership: 'application',
        },
        scopes: ['cms.read'],
      }),
    ).rejects.toThrow('AUTH_OAUTH_CLIENT_PARTIAL_CLEANUP_FAILED')
    expect(adapter.delete).not.toHaveBeenCalledWith(
      expect.objectContaining({ model: 'oauthResource' }),
    )
  })

  it('sanitizes request-scoped OAuth profile failures', async () => {
    const auth = createBetterConvexAuth(component(), {
      oauthProvider: () => {
        throw new Error('private policy failure')
      },
    })

    await expect(auth.createAuth(queryContext() as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
    await expect(auth.createAuth(queryContext() as never)).rejects.not.toThrow(
      'private policy failure',
    )
    expect(loggedSubCodes()).toEqual([
      'AUTH_CONFIG_OAUTH_PROFILE_FAILED',
      'AUTH_CONFIG_OAUTH_PROFILE_FAILED',
    ])
  })

  it('reports one sanitized configuration error when required secrets are absent', async () => {
    Reflect.deleteProperty(process.env, 'BETTER_AUTH_SECRETS')
    const auth = createBetterConvexAuth(component())
    await expect(auth.createAuth(queryContext() as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
  })

  it.each([
    '0:short',
    'not-versioned',
    `0:${'a'.repeat(32)},0:${'b'.repeat(32)}`,
    `1:${'a'.repeat(31)},0:${'b'.repeat(32)}`,
  ])('rejects malformed or weak versioned secrets without constructing auth', async (secrets) => {
    process.env.BETTER_AUTH_SECRETS = secrets
    const auth = createBetterConvexAuth(component())

    await expect(auth.createAuth(queryContext() as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
    expect(betterAuth).not.toHaveBeenCalled()
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_SECRETS_INVALID'])
    expect(loggedText()).not.toContain(secrets.slice(2))
  })

  it('accepts unique versioned secrets when every value meets the minimum', async () => {
    process.env.BETTER_AUTH_SECRETS = `2:${'a'.repeat(32)},1:${'b'.repeat(32)}`
    const auth = createBetterConvexAuth(component())

    await expect(auth.createAuth(queryContext() as never)).resolves.toBeDefined()
    expect(betterAuth).toHaveBeenCalledOnce()
  })

  it('sanitizes OAuth profile failures in the client deletion operator', async () => {
    const privateFailure = new Error('operator-profile-sentinel')
    const auth = createBetterConvexAuth(component(), {
      oauthProvider: () => Promise.reject(privateFailure),
    })

    const failure = await auth.oauthOperator
      .deleteClient(queryContext() as never, { clientId: 'public-client' })
      .catch((error: unknown) => error)

    expect(failure).toEqual(new Error('AUTH_CONFIG_INVALID'))
    expect(failure).not.toBe(privateFailure)
    expect(String(failure)).not.toContain('operator-profile-sentinel')
    expect(JSON.stringify(failure)).not.toContain('operator-profile-sentinel')
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_OAUTH_PROFILE_FAILED'])
  })
})

describe('sessionHttpAction', () => {
  const proxySecret = 'proxy-secret-'.repeat(4)
  const previousProxySecret = process.env.BCN_AUTH_PROXY_IP_SECRET

  beforeEach(() => {
    process.env.BCN_AUTH_PROXY_IP_SECRET = proxySecret
  })

  afterEach(() => {
    // Back to the hoisted default implementation for later suites.
    betterAuth.mockReset()
    if (previousProxySecret === undefined)
      Reflect.deleteProperty(process.env, 'BCN_AUTH_PROXY_IP_SECRET')
    else process.env.BCN_AUTH_PROXY_IP_SECRET = previousProxySecret
  })

  function sessionAuth(sessionResponse: () => Response) {
    const handler = vi.fn(async (_request: Request) => sessionResponse())
    betterAuth.mockImplementation(
      (options: unknown) => ({ $context: Promise.resolve(), handler, options }) as never,
    )
    return handler
  }

  async function invoke(
    route: unknown,
    init: { headers?: Record<string, string>; admitted?: unknown } = {},
  ) {
    const ctx = {
      ...writableContext(),
      runQuery: vi.fn().mockResolvedValue(
        'admitted' in init
          ? init.admitted
          : {
              session: { id: 'session-1', token: 'opaque' },
              user: { id: 'user', name: 'Person', bcnSecurityGeneration: 1 },
            },
      ),
      meta: { getRequestMetadata: async () => ({ ip: '198.51.100.7' }) },
    }
    const response = await (
      route as { _handler: (ctx: unknown, request: Request) => Promise<Response> }
    )._handler(
      ctx,
      new Request('https://deployment.convex.site/api/auth/mcp/admin/provision', {
        method: 'POST',
        headers: {
          cookie: 'better-auth.session_token=private-cookie-value',
          origin: 'https://app.example.test',
          ...init.headers,
        },
      }),
    )
    return { ctx, response }
  }

  const liveSession = () => Response.json({ session: { id: 'session-1' }, user: { id: 'user' } })

  it('resolves the session through the rate-limited Better Auth handler and admission', async () => {
    const authHandler = sessionAuth(liveSession)
    const handler = vi.fn(
      async (_ctx: unknown, session: { headers: Headers; user: unknown; sessionId: string }) =>
        Response.json({
          cookie: session.headers.get('cookie'),
          ip: session.headers.get('x-bcn-verified-client-ip'),
          origin: session.headers.get('origin'),
          sessionId: session.sessionId,
          user: session.user,
        }),
    )
    const route = createBetterConvexAuth(component()).sessionHttpAction(handler as never)
    const signature = await signClientIp('203.0.113.9', proxySecret)
    const { ctx, response } = await invoke(route, {
      headers: { 'x-bcn-client-ip': '203.0.113.9', 'x-bcn-client-ip-signature': signature },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      cookie: 'better-auth.session_token=private-cookie-value',
      ip: '203.0.113.9',
      origin: 'https://app.example.test',
      sessionId: 'session-1',
      // Library-owned admission fields never reach the handler.
      user: { id: 'user', name: 'Person' },
    })
    const sessionRequest = authHandler.mock.calls[0]![0]
    expect(sessionRequest.url).toBe(
      'https://app.example.test/api/auth/get-session?disableCookieCache=true',
    )
    expect(sessionRequest.headers.get('x-bcn-verified-client-ip')).toBe('203.0.113.9')
    expect(sessionRequest.headers.get('x-bcn-client-ip-signature')).toBeNull()
    expect(ctx.runQuery).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      sessionId: 'session-1',
      userId: 'user',
    })
  })

  it.each([
    [
      'a forged proxy signature',
      { 'x-bcn-client-ip': '203.0.113.9', 'x-bcn-client-ip-signature': 'forged' },
      500,
    ],
    ['an unsigned forwarded IP', { 'x-bcn-client-ip': '203.0.113.9' }, 500],
    ['a cross-origin request', { origin: 'https://attacker.example.test' }, 403],
    ['a missing origin', { origin: '' }, 403],
  ])('rejects %s before reading the session', async (_name, headers, status) => {
    const authHandler = sessionAuth(liveSession)
    const handler = vi.fn()
    const route = createBetterConvexAuth(component()).sessionHttpAction(handler)
    const { response } = await invoke(route, { headers })
    expect(response.status).toBe(status)
    expect(authHandler).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('denies without a Better Auth session', async () => {
    sessionAuth(() => Response.json(null))
    const handler = vi.fn()
    const route = createBetterConvexAuth(component()).sessionHttpAction(handler)
    const { ctx, response } = await invoke(route)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'UNAUTHENTICATED' })
    expect(ctx.runQuery).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('denies a session that fails admission (revoked, expired, or fenced)', async () => {
    sessionAuth(liveSession)
    const handler = vi.fn()
    const route = createBetterConvexAuth(component()).sessionHttpAction(handler)
    const { response } = await invoke(route, { admitted: null })
    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it("passes Better Auth's rate-limit response through", async () => {
    sessionAuth(() => new Response(null, { status: 429, headers: { 'x-retry-after': '10' } }))
    const handler = vi.fn()
    const route = createBetterConvexAuth(component()).sessionHttpAction(handler)
    const { response } = await invoke(route)
    expect(response.status).toBe(429)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('registered auth route diagnostics', () => {
  async function invokeRoute(auth: {
    registerRoutes: (http: ReturnType<typeof httpRouter>) => void
  }) {
    const http = httpRouter()
    auth.registerRoutes(http)
    const route = http.lookup('/api/auth/get-session', 'GET')
    if (!route) throw new Error('Auth route was not registered')
    const handler = route[0] as (typeof route)[0] & {
      _handler: (ctx: unknown, request: Request) => Promise<Response>
    }
    const ctx = {
      ...writableContext(),
      meta: { getRequestMetadata: async () => ({ ip: '198.51.100.7' }) },
    }
    return handler._handler(
      ctx,
      new Request('https://deployment.convex.site/api/auth/get-session', {
        headers: { cookie: 'better-auth.session_token=private-cookie-value' },
      }),
    )
  }

  it('keeps the public body opaque and logs one stable construction sub-code', async () => {
    Reflect.deleteProperty(process.env, 'BETTER_AUTH_SECRETS')
    const response = await invokeRoute(createBetterConvexAuth(component()))
    expect(response.status).toBe(500)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({ code: 'AUTH_CONFIG_INVALID' })
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_SECRETS_INVALID'])
    expect(loggedText()).not.toContain('private-cookie-value')
  })

  it('logs a route sub-code when the public origin is invalid', async () => {
    process.env.SITE_URL = 'ftp://app.example.test'
    const response = await invokeRoute(createBetterConvexAuth(component()))
    expect(await response.json()).toEqual({ code: 'AUTH_CONFIG_INVALID' })
    expect(loggedSubCodes()).toEqual(['AUTH_CONFIG_ROUTE_SITE_URL_INVALID'])
  })

  it('logs handler failures without request material', async () => {
    betterAuth.mockImplementationOnce(
      () =>
        ({
          $context: Promise.resolve(),
          handler: async () => {
            throw new Error('handler exploded with token=private-session-token')
          },
        }) as never,
    )
    const response = await invokeRoute(createBetterConvexAuth(component()))
    expect(await response.json()).toEqual({ code: 'AUTH_HANDLER_FAILED' })
    expect(loggedSubCodes()).toEqual(['AUTH_HANDLER_THREW'])
    expect(consoleError.mock.calls[0]![0]).toBe('[better-convex] AUTH_HANDLER_FAILED')
    expect(loggedText()).not.toContain('private-session-token')
    expect(loggedText()).not.toContain('private-cookie-value')
  })
})

describe('createBetterConvexTestAuth', () => {
  it('adds only the fixed test-utils plugin on exact loopback origins', async () => {
    process.env.SITE_URL = 'http://localhost:3000'
    process.env.CONVEX_SITE_URL = 'http://127.0.0.1:3211'
    const auth = createBetterConvexTestAuth(component(), {})

    await auth.createAuth(queryContext() as never)
    const options = betterAuth.mock.calls[0]?.[0] as BetterAuthOptions

    expect(options.plugins?.map(({ id }) => id)).toEqual([
      'test-utils',
      'jwt',
      '@lupinum/better-convex-nuxt',
    ])
  })

  it.each([
    ['SITE_URL', 'https://localhost'],
    ['SITE_URL', 'http://example.test'],
    ['SITE_URL', 'http://localhost/path'],
    ['CONVEX_SITE_URL', 'https://127.0.0.1'],
    ['CONVEX_SITE_URL', 'http://user@localhost'],
  ] as const)('rejects non-loopback %s value %s', (name, value) => {
    process.env.SITE_URL = 'http://localhost:3000'
    process.env.CONVEX_SITE_URL = 'http://127.0.0.1:3211'
    process.env[name] = value

    expect(() => createBetterConvexTestAuth(component(), {})).toThrow('AUTH_TEST_LOOPBACK_REQUIRED')
    expect(betterAuth).not.toHaveBeenCalled()
  })

  it('revalidates loopback origins for every auth construction', async () => {
    process.env.SITE_URL = 'http://localhost:3000'
    process.env.CONVEX_SITE_URL = 'http://127.0.0.1:3211'
    const auth = createBetterConvexTestAuth(component(), {})
    process.env.SITE_URL = 'https://app.example.test'

    await expect(auth.createAuth(queryContext() as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
    expect(betterAuth).not.toHaveBeenCalled()
  })
})
