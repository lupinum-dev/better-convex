// Temporary: these behavior tests still mock Better Auth. Each group moves to a convex-test file with real Better Auth; delete this file when it is empty. See test/TESTING.md.
import type { BetterAuthOptions } from 'better-auth'
import { httpRouter } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'
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
