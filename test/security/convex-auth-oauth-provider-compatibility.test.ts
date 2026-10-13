import { oauthProvider, type OAuthOptions, type Scope } from '@better-auth/oauth-provider'
import { describe, expect, it } from 'vitest'

import { DISABLED_PINNED_PROVIDER_PATHS } from '../../src/runtime/convex-auth/oauth-provider-compat'
import { convexAuth } from '../../src/runtime/convex-auth/plugin'

const issuer = 'https://deployment.convex.site'

function profile(): OAuthOptions<Scope[]> {
  return {
    accessTokenExpiresIn: 600,
    allowDynamicClientRegistration: false,
    allowPublicClientPrelogin: true,
    allowUnauthenticatedClientRegistration: false,
    clientPrivileges: async () => true,
    codeExpiresIn: 120,
    consentPage: '/oauth/consent',
    customAccessTokenClaims: async () => ({ token_use: 'oauth-access' }),
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
    scopes: ['mcp:read', 'mcp:write'],
    storeClientSecret: 'hashed',
    storeTokens: 'hashed',
  }
}

function createConvexPlugin(oauthProviderProfile: OAuthOptions<Scope[]>) {
  return () =>
    convexAuth({
      authConfig: {
        providers: [
          {
            algorithm: 'RS256',
            applicationID: 'convex',
            issuer,
            type: 'customJwt',
          },
        ],
      },
      oauthProvider: oauthProviderProfile,
      sessionJwt: {
        audience: 'convex',
        expirationTime: '15m',
        issuer,
      },
    })
}

// Every route @better-auth/oauth-provider registers must be disabled over HTTP
// or listed here with the reason it stays reachable. A new upstream route fails
// this test until someone decides.
const ALLOWED_OAUTH_PROVIDER_ROUTES: Record<string, string> = {
  'GET /.well-known/oauth-authorization-server': 'authorization server discovery',
  'GET /oauth2/authorize': 'authorization flow',
  'POST /oauth2/authorize': 'authorization flow',
  'POST /oauth2/consent': 'consent page submits the decision',
  'POST /oauth2/continue': 'login page continues the flow',
  'POST /oauth2/token': 'token endpoint',
  'POST /oauth2/revoke': 'token revocation',
  'GET /oauth2/public-client': 'consent page client display',
  'POST /oauth2/public-client-prelogin': 'login page client display',
  'GET /oauth2/get-consent': "user's own consent management",
  'GET /oauth2/get-consents': "user's own consent management",
  'POST /oauth2/update-consent': "user's own consent management",
  'POST /oauth2/delete-consent': "user's own consent management",
  // disabledPaths matches the exact request path, so parametric routes cannot be
  // listed there. They stay guarded by the deny callbacks and the before hooks.
  'GET /admin/oauth2/resources/:identifier': 'parametric: callbacks deny, hooks guard',
  'PATCH /admin/oauth2/resources/:identifier': 'parametric: callbacks deny, hooks guard',
  'DELETE /admin/oauth2/resources/:identifier': 'parametric: callbacks deny, hooks guard',
  'POST /admin/oauth2/resources/:identifier/clients/:client_id':
    'parametric: callbacks deny, hooks guard',
  'DELETE /admin/oauth2/resources/:identifier/clients/:client_id':
    'parametric: callbacks deny, hooks guard',
}

describe('pinned Better Auth OAuth Provider compatibility firewall', () => {
  it('disables, or deliberately allows, every route the pinned provider registers', () => {
    const routes = Object.values(
      oauthProvider(profile()).endpoints as unknown as Record<
        string,
        { path: string; options: { method: string | string[] } }
      >,
    ).flatMap((endpoint) =>
      [endpoint.options.method].flat().map((method) => ({ method, path: endpoint.path })),
    )
    expect(routes.length).toBeGreaterThan(30)

    const undecided = routes
      .filter(
        ({ method, path }) =>
          !DISABLED_PINNED_PROVIDER_PATHS.has(path) &&
          !(`${method} ${path}` in ALLOWED_OAUTH_PROVIDER_ROUTES),
      )
      .map(({ method, path }) => `${method} ${path}`)
    expect(undecided).toEqual([])

    const registered = new Set(routes.map(({ method, path }) => `${method} ${path}`))
    expect(
      Object.keys(ALLOWED_OAUTH_PROVIDER_ROUTES).filter((key) => !registered.has(key)),
    ).toEqual([])
    // Operator provisioning and the end-session confirmation have no HTTP flow.
    for (const path of [
      '/oauth2/end-session/confirm',
      '/admin/oauth2/create-client',
      '/admin/oauth2/update-client',
      '/admin/oauth2/resources',
    ]) {
      expect(DISABLED_PINNED_PROVIDER_PATHS.has(path)).toBe(true)
    }
  })

  it.each(['clientPrivileges', 'resourcePrivileges', 'customAccessTokenClaims'] as const)(
    'rejects a missing %s callback that the pinned upstream constructor accepts',
    (field) => {
      const unsafe = profile()
      unsafe[field] = undefined

      const upstream = oauthProvider(unsafe)
      expect(upstream.options?.[field]).toBeUndefined()
      expect(createConvexPlugin(unsafe)).toThrow('AUTH_OAUTH_CONFIG_INVALID')
    },
  )

  it('accepts and installs only the exact hardened callback identities', () => {
    const safe = profile()
    const original = {
      clientPrivileges: safe.clientPrivileges,
      customAccessTokenClaims: safe.customAccessTokenClaims,
      resourcePrivileges: safe.resourcePrivileges,
    }

    expect(createConvexPlugin(safe)).not.toThrow()
    expect(safe.clientPrivileges).not.toBe(original.clientPrivileges)
    expect(safe.resourcePrivileges).not.toBe(original.resourcePrivileges)
    expect(safe.customAccessTokenClaims).not.toBe(original.customAccessTokenClaims)

    const installed = oauthProvider(safe)
    expect(installed.options?.clientPrivileges).toBe(safe.clientPrivileges)
    expect(installed.options?.resourcePrivileges).toBe(safe.resourcePrivileges)
    expect(installed.options?.customAccessTokenClaims).toBe(safe.customAccessTokenClaims)
  })

  it('distinguishes internal resource reads from server-only provisioning writes', async () => {
    const plugin = createConvexPlugin(profile())()
    const beforeHooks = (plugin.hooks?.before ?? []) as unknown as Array<{
      handler: (context: {
        body: Record<string, unknown>
        method?: string
        path: string
      }) => Promise<unknown>
      matcher: (context: { body?: unknown; method?: string; path: string }) => boolean
    }>
    const provisioningHook = beforeHooks.find((hook) =>
      hook.matcher({ path: '/admin/oauth2/create-client' }),
    )
    expect(provisioningHook).toBeDefined()

    // Each row: [request context, whether the provisioning guard must run].
    const cases: Array<[{ body?: unknown; method?: string; path: string }, boolean]> = [
      [{ path: '/admin/oauth2/create-client' }, true],
      [{ path: '/admin/oauth2/update-client' }, true],
      [{ path: '/admin/oauth2/resources' }, false],
      [{ path: '/admin/oauth2/resources/:identifier' }, false],
      [{ body: {}, path: '/admin/oauth2/resources' }, true],
      [{ body: {}, path: '/admin/oauth2/resources/:identifier' }, true],
      [{ method: 'GET', path: '/admin/oauth2/resources' }, false],
      [{ method: 'GET', path: '/admin/oauth2/resources/:identifier' }, false],
      [{ method: 'DELETE', path: '/admin/oauth2/resources/:identifier' }, false],
    ]
    expect(
      cases.filter(([context, guarded]) => provisioningHook!.matcher(context) !== guarded),
    ).toEqual([])

    await expect(
      provisioningHook!.handler({
        body: {
          application_type: 'native',
          dpop_bound_access_tokens: false,
          enable_end_session: false,
          grant_types: ['authorization_code'],
          redirect_uris: ['http://127.0.0.1:3334/oauth/callback'],
          require_pkce: true,
          response_types: ['code'],
          scope: 'mcp:read mcp:write',
          skip_consent: false,
          token_endpoint_auth_method: 'none',
        },
        path: '/admin/oauth2/create-client',
      }),
    ).resolves.toBeUndefined()

    await expect(
      provisioningHook!.handler({
        body: {
          accessTokenTtl: 600,
          allowedScopes: ['mcp:read', 'mcp:write'],
          disabled: false,
          dpopBoundAccessTokensRequired: false,
          identifier: 'http://127.0.0.1:3211/mcp',
          name: 'Ginko CMS MCP',
          signingAlgorithm: 'RS256',
        },
        method: ['POST'] as unknown as string,
        path: '/admin/oauth2/resources',
      }),
    ).resolves.toBeUndefined()
  })
})
