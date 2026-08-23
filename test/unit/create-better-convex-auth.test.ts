import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthCtx } from '../../src/runtime/convex-auth/context'
import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'
import type { PinnedOAuthProviderProfile } from '../../src/runtime/convex-auth/oauth-security'

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
      createBetterConvexAuth(component(), {
        session: { expiresIn: 1 },
      } as never),
    ).toThrow('session.expiresIn')
  })

  it('admits a narrow user identity decision without exposing Better Auth hooks', async () => {
    const ctx = { runQuery: vi.fn() }
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
    await auth.createAuth({} as never)
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
    const ctx = { runQuery: vi.fn().mockResolvedValue(oauthProfile()) }
    const createProfile = vi.fn(async (requestCtx: AuthCtx) => requestCtx.runQuery({} as never))
    const auth = createBetterConvexAuth(component(), {
      oauthProvider: createProfile,
    })

    await auth.createAuth(ctx as never)

    expect(createProfile).toHaveBeenCalledOnce()
    expect(createProfile).toHaveBeenCalledWith(ctx)
    expect(ctx.runQuery).toHaveBeenCalledOnce()
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
    const adminCreateOAuthClient = vi.fn(async () => ({ client_id: 'client-proof' }))
    const adminCreateOAuthResource = vi.fn(async ({ body }) => body)
    const adminDeleteOAuthResource = vi.fn(async () => ({ deleted: true }))
    const adminLinkClientResource = vi.fn(async () => ({ linked: true }))
    const adminListOAuthResources = vi.fn(async () => [])
    const deleteOAuthClient = vi.fn(async () => ({ status: true }))
    const authInstance = (options: unknown) =>
      ({
        $context: Promise.resolve(),
        api: {
          adminCreateOAuthClient,
          adminCreateOAuthResource,
          adminDeleteOAuthResource,
          adminLinkClientResource,
          adminListOAuthResources,
          deleteOAuthClient,
        },
        handler: vi.fn(),
        options,
      }) as never
    betterAuth.mockImplementationOnce(authInstance).mockImplementationOnce(authInstance)
    const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })
    const ctx = {} as never

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
    ).resolves.toEqual({ clientId: 'client-proof' })
    expect(adminCreateOAuthClient).toHaveBeenCalledWith({
      body: {
        application_type: 'native',
        client_name: 'Ginko certification',
        dpop_bound_access_tokens: false,
        enable_end_session: false,
        grant_types: ['authorization_code'],
        redirect_uris: ['http://localhost:3000/oauth-proof/callback'],
        require_pkce: true,
        response_types: ['code'],
        scope: 'cms.read cms.entries.edit',
        skip_consent: false,
        software_id: 'ginko-certification-proof',
        subject_type: 'public',
        token_endpoint_auth_method: 'none',
      },
    })
    expect(adminCreateOAuthResource).toHaveBeenCalledWith({
      body: {
        accessTokenTtl: 600,
        allowedScopes: ['cms.read', 'cms.entries.edit'],
        disabled: false,
        dpopBoundAccessTokensRequired: false,
        identifier: 'https://deployment.convex.site/mcp',
        name: 'Ginko CMS MCP',
        signingAlgorithm: 'RS256',
      },
    })
    expect(adminLinkClientResource).toHaveBeenCalledWith({
      params: {
        client_id: 'client-proof',
        identifier: 'https://deployment.convex.site/mcp',
      },
    })

    await auth.oauthOperator.deleteClient(ctx, { clientId: 'client-proof' })
    expect(deleteOAuthClient).toHaveBeenCalledWith({ body: { client_id: 'client-proof' } })
  })

  it('rejects invalid OAuth operator input before constructing auth', async () => {
    const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })

    await expect(
      auth.oauthOperator.createPublicClient({} as never, {
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
      auth.oauthOperator.createPublicClient({} as never, {
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

  it('rejects scopes outside the configured reviewed provider profile', async () => {
    const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })

    await expect(
      auth.oauthOperator.createPublicClient({} as never, {
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
    const deleteOAuthClient = vi.fn(async () => ({ status: true }))
    const adminDeleteOAuthResource = vi.fn(async () => ({ deleted: true }))
    betterAuth.mockImplementationOnce(
      (options: unknown) =>
        ({
          $context: Promise.resolve(),
          api: {
            adminCreateOAuthClient: vi.fn(async () => ({ client_id: 'client-proof' })),
            adminCreateOAuthResource: vi.fn(async ({ body }) => body),
            adminDeleteOAuthResource,
            adminLinkClientResource: vi.fn(async () => {
              throw new Error('private provider failure')
            }),
            adminListOAuthResources: vi.fn(async () => []),
            deleteOAuthClient,
          },
          handler: vi.fn(),
          options,
        }) as never,
    )
    const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })

    await expect(
      auth.oauthOperator.createPublicClient({} as never, {
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
    expect(deleteOAuthClient).toHaveBeenCalledWith({ body: { client_id: 'client-proof' } })
    expect(adminDeleteOAuthResource).toHaveBeenCalledWith({
      params: { identifier: 'https://deployment.convex.site/mcp' },
    })
  })

  it('reports partial cleanup precisely and preserves the resource when client cleanup fails', async () => {
    const adminDeleteOAuthResource = vi.fn(async () => ({ deleted: true }))
    betterAuth.mockImplementationOnce(
      (options: unknown) =>
        ({
          $context: Promise.resolve(),
          api: {
            adminCreateOAuthClient: vi.fn(async () => ({ client_id: 'client-proof' })),
            adminCreateOAuthResource: vi.fn(async ({ body }) => body),
            adminDeleteOAuthResource,
            adminLinkClientResource: vi.fn(async () => {
              throw new Error('private provider failure')
            }),
            adminListOAuthResources: vi.fn(async () => []),
            deleteOAuthClient: vi.fn(async () => {
              throw new Error('private cleanup failure')
            }),
          },
          handler: vi.fn(),
          options,
        }) as never,
    )
    const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })

    await expect(
      auth.oauthOperator.createPublicClient({} as never, {
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
    expect(adminDeleteOAuthResource).not.toHaveBeenCalled()
  })

  it('sanitizes request-scoped OAuth profile failures', async () => {
    const auth = createBetterConvexAuth(component(), {
      oauthProvider: () => {
        throw new Error('private policy failure')
      },
    })

    await expect(auth.createAuth({} as never)).rejects.toThrow('AUTH_CONFIG_INVALID')
    await expect(auth.createAuth({} as never)).rejects.not.toThrow('private policy failure')
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
