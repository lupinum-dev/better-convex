// Temporary: these behavior tests still mock Better Auth. Each group moves to a convex-test file with real Better Auth; delete this file when it is empty. See test/TESTING.md.
import type { BetterAuthOptions } from 'better-auth'
import { httpRouter, makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthCtx } from '../../src/runtime/convex-auth/context'
import {
  createBetterConvexAuth,
  type BetterConvexAuthEmail,
} from '../../src/runtime/convex-auth/create-better-convex-auth'
import type { BetterConvexPublicOAuthClientInput } from '../../src/runtime/convex-auth/oauth-operator'
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

function beforeUserCreateHook() {
  const options = betterAuth.mock.calls[0]![0] as {
    databaseHooks: {
      user: { create: { before: (user: Record<string, unknown>) => Promise<unknown> } }
    }
  }
  return options.databaseHooks.user.create.before
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

const proofClient: BetterConvexPublicOAuthClientInput = {
  name: 'Proof',
  profile: 'proof',
  redirectUris: ['https://agent.example.test/callback'],
  resource: {
    identifier: 'https://deployment.convex.site/mcp',
    name: 'Proof',
    ownership: 'application',
  },
  scopes: ['cms.read'],
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
    const consume = () =>
      options.rateLimit!.customStorage!.consume('client|/get-session', { max: 100, window: 10 })
    await expect(consume()).resolves.toEqual({ allowed: true, retryAfter: null })
    expect(ctx.runMutation).toHaveBeenCalledTimes(3)
    expect(ctx.runMutation).toHaveBeenLastCalledWith(consumeRateLimit, {
      key: 'client|/get-session',
      max: 100,
      retentionWindow: 60,
      window: 10,
    })

    ctx.runMutation.mockClear()
    ctx.runMutation.mockRejectedValueOnce(new Error('AUTH_RATE_LIMIT_ROW_INVALID'))
    await expect(consume()).rejects.toThrow('AUTH_RATE_LIMIT_ROW_INVALID')
    expect(ctx.runMutation).toHaveBeenCalledTimes(1)

    ctx.runMutation.mockClear()
    ctx.runMutation.mockRejectedValueOnce(new Error('optimistic concurrency control failure'))
    await expect(consume()).rejects.toThrow('optimistic concurrency control failure')
    expect(ctx.runMutation).toHaveBeenCalledTimes(1)

    ctx.runMutation.mockClear()
    ctx.runMutation.mockRejectedValue(systemConflict)
    await expect(consume()).rejects.toThrow(systemConflict.message)
    expect(ctx.runMutation).toHaveBeenCalledTimes(6)

    // Inside a mutation (ctx.db present) a retry cannot help: fail on the first conflict.
    ctx.runMutation.mockClear()
    Object.assign(ctx, { db: {} })
    await expect(consume()).rejects.toThrow(systemConflict.message)
    expect(ctx.runMutation).toHaveBeenCalledTimes(1)
  })

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
    const user = {
      createdAt: new Date(),
      email: '  Owner@Example.test  ',
      emailVerified: false,
      id: 'generated-user-id',
      image: null,
      name: 'Owner',
      updatedAt: new Date(),
    }

    await expect(beforeUserCreateHook()(user)).resolves.toEqual({
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

    await expect(
      beforeUserCreateHook()({
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

  it('provisions a bracketed IPv6 loopback redirect', async () => {
    const adapter = oauthAdapter()
    betterAuth.mockImplementationOnce(authWithAdapter(adapter))
    const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })
    await expect(
      auth.oauthOperator.createPublicClient(queryContext() as never, {
        ...proofClient,
        redirectUris: ['http://[::1]:3000/callback'],
      }),
    ).resolves.toEqual({ clientId: expect.any(String) })
    expect(adapter.create).toHaveBeenCalledWith({
      model: 'oauthClient',
      data: expect.objectContaining({ redirectUris: ['http://[::1]:3000/callback'] }),
    })
  })

  it.each([
    ...[
      'http://localhost/callback',
      'https://localhost/callback',
      'not-a-url',
      'ftp://agent.example.test/callback',
      'http://agent.example.test/callback',
      'https://user:password@agent.example.test/callback',
      'https://agent.example.test/callback#token',
    ].map((uri) => [
      `redirect ${uri}`,
      { redirectUris: [uri] },
      'AUTH_OAUTH_CLIENT_REDIRECT_URI_INVALID',
    ]),
    ...[
      'ftp://deployment.convex.site/mcp',
      'http://deployment.convex.site/mcp',
      'https://user:password@deployment.convex.site/mcp',
      'https://deployment.convex.site/mcp?tenant=private',
      'https://deployment.convex.site/mcp#token',
    ].map((identifier) => [
      `resource identifier ${identifier}`,
      { resource: { ...proofClient.resource, identifier } },
      'AUTH_OAUTH_CLIENT_RESOURCE_INVALID',
    ]),
    [
      'operator resource ownership',
      { resource: { ...proofClient.resource, ownership: 'operator' } },
      'AUTH_OAUTH_CLIENT_RESOURCE_OWNERSHIP_INVALID',
    ],
    [
      'a scope outside the profile',
      { scopes: ['cms.admin'] },
      'AUTH_OAUTH_CLIENT_SCOPE_NOT_ADMITTED',
    ],
  ] as Array<[string, object, string]>)(
    'rejects OAuth operator input with %s before constructing auth',
    async (_name, override, code) => {
      const auth = createBetterConvexAuth(component(), { oauthProvider: oauthProfile() })
      await expect(
        auth.oauthOperator.createPublicClient(
          queryContext() as never,
          {
            ...proofClient,
            ...override,
          } as never,
        ),
      ).rejects.toThrow(code)
      expect(betterAuth).not.toHaveBeenCalled()
    },
  )

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
      auth.oauthOperator.createPublicClient(queryContext() as never, proofClient),
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
      auth.oauthOperator.createPublicClient(queryContext() as never, proofClient),
    ).rejects.toThrow('AUTH_OAUTH_CLIENT_PARTIAL_CLEANUP_FAILED')
    expect(adapter.delete).not.toHaveBeenCalledWith(
      expect.objectContaining({ model: 'oauthResource' }),
    )
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
