import type { BetterAuthOptions } from 'better-auth'
import { makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requireWritableAuthCtx, type AuthCtx } from '../../src/runtime/convex-auth/context'
import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'
import type { PinnedOAuthProviderProfile } from '../../src/runtime/convex-auth/oauth-security'
import { createBetterConvexTestAuth } from '../../src/runtime/convex-auth/test'

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

const assertProfile = makeFunctionReference<'query', { workforce: boolean }, null>(
  'adapter:assertProfile',
)

function profileContext() {
  return { runQuery: vi.fn().mockResolvedValue(null) }
}

function component() {
  const reference = {} as never
  return {
    adapter: {
      assertProfile,
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
      emailOTP: { async sendVerificationOTP() {} },
      organization: {},
      twoFactor: { issuer: 'Example' },
    })

    await auth.createAuth(profileContext() as never)
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

    await auth.createAuth(profileContext() as never)
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
      createBetterConvexAuth(component(), {
        session: { expiresIn: 1 },
      } as never),
    ).toThrow('session.expiresIn')
  })

  it('binds email callbacks to separate concurrent invocations without changing their inputs', async () => {
    const submitMail = makeFunctionReference<'mutation', { email: string; url: string }, null>(
      'authMail:submit',
    )
    const first = { ...profileContext(), runMutation: vi.fn().mockResolvedValue('first-queued') }
    const second = { ...profileContext(), runMutation: vi.fn().mockResolvedValue('second-queued') }
    const onPasswordReset = vi.fn()
    const auth = createBetterConvexAuth(component(), {
      emailAndPassword: async (ctx) => ({
        revokeSessionsOnPasswordReset: true,
        onPasswordReset,
        async sendResetPassword(data) {
          requireWritableAuthCtx(ctx)
          await ctx.runMutation(submitMail, { email: data.user.email, url: data.url })
        },
      }),
      emailVerification: (ctx) => ({
        expiresIn: 300,
        async sendVerificationEmail(data) {
          requireWritableAuthCtx(ctx)
          await ctx.runMutation(submitMail, { email: data.user.email, url: data.url })
        },
      }),
    })
    await Promise.all([auth.createAuth(first as never), auth.createAuth(second as never)])
    expect(first.runQuery).toHaveBeenCalledExactlyOnceWith(assertProfile, { workforce: false })
    expect(second.runQuery).toHaveBeenCalledExactlyOnceWith(assertProfile, { workforce: false })
    const firstOptions = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    const secondOptions = betterAuth.mock.calls[1]![0] as BetterAuthOptions
    const data = {
      user: {
        id: 'user',
        email: 'person@example.test',
        emailVerified: false,
        name: 'Person',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      token: 'synthetic-token',
      url: 'https://app.example.test/recover?token=synthetic-token',
    }
    await firstOptions.emailAndPassword!.sendResetPassword!(data)
    await secondOptions.emailVerification!.sendVerificationEmail!(data)
    expect(first.runMutation).toHaveBeenCalledExactlyOnceWith(submitMail, {
      email: data.user.email,
      url: data.url,
    })
    expect(second.runMutation).toHaveBeenCalledExactlyOnceWith(submitMail, {
      email: data.user.email,
      url: data.url,
    })
    expect(firstOptions.emailAndPassword).toMatchObject({
      enabled: true,
      autoSignIn: false,
      minPasswordLength: 15,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset,
    })
    expect(secondOptions.emailVerification?.expiresIn).toBe(300)
  })

  it('constructs query auth without requiring write access until a sending callback runs', async () => {
    const query = profileContext()
    const auth = createBetterConvexAuth(component(), {
      emailAndPassword: (ctx) => ({
        async sendResetPassword() {
          requireWritableAuthCtx(ctx)
          await ctx.runMutation({} as never, {})
        },
      }),
    })
    await expect(auth.createAuth(query as never)).resolves.toBeDefined()
    const options = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    await expect(options.emailAndPassword!.sendResetPassword!({} as never)).rejects.toThrow(
      'AUTH_WRITE_REQUIRES_MUTATION_OR_ACTION',
    )
    expect(query.runQuery).toHaveBeenCalledExactlyOnceWith(assertProfile, { workforce: false })
  })

  it('retains the callback promise and rejection so submission cannot be fire-and-forget', async () => {
    const submission = Promise.withResolvers<null>()
    const ctx = { ...profileContext(), runMutation: vi.fn(() => submission.promise) }
    const auth = createBetterConvexAuth(component(), {
      emailVerification: (requestCtx) => ({
        async sendVerificationEmail() {
          requireWritableAuthCtx(requestCtx)
          await requestCtx.runMutation({} as never, {})
        },
      }),
    })
    await auth.createAuth(ctx as never)
    const options = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    let settled = false
    const sending = options.emailVerification!.sendVerificationEmail!({} as never)
    const observed = Promise.resolve(sending).finally(() => {
      settled = true
    })
    const rejected = expect(observed).rejects.toThrow('submission failed')
    await Promise.resolve()
    expect(settled).toBe(false)
    submission.reject(new Error('submission failed'))
    await rejected
    expect(settled).toBe(true)
  })

  it('resolves email OTP per invocation and retains its upstream plugin', async () => {
    const query = profileContext()
    const emailOTP = vi.fn((_ctx: AuthCtx) => ({
      expiresIn: 300,
      async sendVerificationOTP() {},
    }))
    const auth = createBetterConvexAuth(component(), { emailOTP })
    await auth.createAuth(query as never)
    expect(emailOTP).toHaveBeenCalledExactlyOnceWith(query)
    expect(query.runQuery).toHaveBeenCalledExactlyOnceWith(assertProfile, { workforce: false })
    const options = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    expect(options.plugins?.map(({ id }) => id)).toContain('email-otp')
  })

  it('allows explicit password and OTP disablement from a factory', async () => {
    const auth = createBetterConvexAuth(component(), {
      emailAndPassword: () => false,
      emailOTP: async () => false as const,
    })
    await auth.createAuth(profileContext() as never)
    const options = betterAuth.mock.calls[0]![0] as BetterAuthOptions
    expect(options.emailAndPassword).toEqual({ enabled: false })
    expect(options.plugins?.map(({ id }) => id)).not.toContain('email-otp')
  })

  it.each(['emailAndPassword', 'emailVerification', 'emailOTP'] as const)(
    'sanitizes %s factory failures',
    async (key) => {
      const auth = createBetterConvexAuth(component(), {
        [key]: async () => {
          throw new Error('private configuration detail')
        },
      })
      await expect(auth.createAuth(profileContext() as never)).rejects.toThrow(
        /^AUTH_CONFIG_INVALID$/,
      )
      expect(betterAuth).not.toHaveBeenCalled()
    },
  )

  it.each([undefined, null, [], 'invalid', 1])(
    'rejects malformed factory output %s',
    async (value) => {
      for (const key of ['emailAndPassword', 'emailVerification', 'emailOTP']) {
        const auth = createBetterConvexAuth(component(), { [key]: () => value } as never)
        await expect(auth.createAuth(profileContext() as never)).rejects.toThrow(
          /^AUTH_CONFIG_INVALID$/,
        )
      }
      expect(betterAuth).not.toHaveBeenCalled()
    },
  )

  it('applies password option admission after resolving a factory', async () => {
    const auth = createBetterConvexAuth(component(), {
      emailAndPassword: () => ({ password: { verify: async () => true } }),
    } as never)
    await expect(auth.createAuth(profileContext() as never)).rejects.toThrow(
      /^AUTH_CONFIG_INVALID$/,
    )
    expect(betterAuth).not.toHaveBeenCalled()
  })

  it('admits a narrow user identity decision without exposing Better Auth hooks', async () => {
    const ctx = profileContext()
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
    await auth.createAuth(profileContext() as never)
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
    expect(ctx.runQuery).toHaveBeenCalledTimes(2)
    expect(ctx.runQuery).toHaveBeenNthCalledWith(1, profileQuery)
    expect(ctx.runQuery).toHaveBeenNthCalledWith(2, assertProfile, { workforce: false })
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
    const ctx = profileContext() as never

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
      auth.oauthOperator.createPublicClient(profileContext() as never, {
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
      auth.oauthOperator.createPublicClient(profileContext() as never, {
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
      auth.oauthOperator.createPublicClient(profileContext() as never, {
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
      auth.oauthOperator.createPublicClient(profileContext() as never, {
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
      auth.oauthOperator.createPublicClient(profileContext() as never, {
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
      auth.oauthOperator.createPublicClient(profileContext() as never, {
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
      auth.oauthOperator.createPublicClient(profileContext() as never, {
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

    await expect(auth.createAuth(profileContext() as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
    await expect(auth.createAuth(profileContext() as never)).rejects.not.toThrow(
      'private policy failure',
    )
  })

  it('reports one sanitized configuration error when required secrets are absent', async () => {
    Reflect.deleteProperty(process.env, 'BETTER_AUTH_SECRETS')
    const auth = createBetterConvexAuth(component())
    await expect(auth.createAuth(profileContext() as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
  })

  it.each([
    '0:short',
    'not-versioned',
    `0:${'a'.repeat(32)},0:${'b'.repeat(32)}`,
    `1:${'a'.repeat(31)},0:${'b'.repeat(32)}`,
  ])('rejects malformed or weak versioned secrets without constructing auth', async (secrets) => {
    process.env.BETTER_AUTH_SECRETS = secrets
    const auth = createBetterConvexAuth(component())

    await expect(auth.createAuth(profileContext() as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
    expect(betterAuth).not.toHaveBeenCalled()
  })

  it('accepts unique versioned secrets when every value meets the minimum', async () => {
    process.env.BETTER_AUTH_SECRETS = `2:${'a'.repeat(32)},1:${'b'.repeat(32)}`
    const auth = createBetterConvexAuth(component())

    await expect(auth.createAuth(profileContext() as never)).resolves.toBeDefined()
    expect(betterAuth).toHaveBeenCalledOnce()
  })

  it('sanitizes OAuth profile failures in the client deletion operator', async () => {
    const privateFailure = new Error('operator-profile-sentinel')
    const auth = createBetterConvexAuth(component(), {
      oauthProvider: () => Promise.reject(privateFailure),
    })

    const failure = await auth.oauthOperator
      .deleteClient(profileContext() as never, { clientId: 'public-client' })
      .catch((error: unknown) => error)

    expect(failure).toEqual(new Error('AUTH_CONFIG_INVALID'))
    expect(failure).not.toBe(privateFailure)
    expect(String(failure)).not.toContain('operator-profile-sentinel')
    expect(JSON.stringify(failure)).not.toContain('operator-profile-sentinel')
  })
})

describe('createBetterConvexTestAuth', () => {
  it('adds only the fixed test-utils plugin on exact loopback origins', async () => {
    process.env.SITE_URL = 'http://localhost:3000'
    process.env.CONVEX_SITE_URL = 'http://127.0.0.1:3211'
    const auth = createBetterConvexTestAuth(component(), {})

    await auth.createAuth(profileContext() as never)
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

    await expect(auth.createAuth(profileContext() as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
    expect(betterAuth).not.toHaveBeenCalled()
  })
})
