import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { oauthProvider, type OAuthOptions, type Scope } from '@better-auth/oauth-provider'
import { describe, expect, it } from 'vitest'

import { convexAuth } from '../../src/runtime/convex-auth/plugin'

const require = createRequire(import.meta.url)
const providerEntry = pathToFileURL(require.resolve('@better-auth/oauth-provider'))
const providerPackage = JSON.parse(
  readFileSync(new URL('../package.json', providerEntry), 'utf8'),
) as {
  version?: unknown
}
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

describe('pinned Better Auth OAuth Provider compatibility firewall', () => {
  it('binds the differential proof to the exact supported provider bytes', () => {
    expect(providerPackage.version).toBe('1.7.1')
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

  it('routes absent mutating methods into the fail-closed provisioning guard', () => {
    const plugin = createConvexPlugin(profile())()
    const beforeHooks = (plugin.hooks?.before ?? []) as unknown as Array<{
      matcher: (context: { method?: string; path: string }) => boolean
    }>
    const provisioningHook = beforeHooks.find((hook) =>
      hook.matcher({ path: '/admin/oauth2/create-client' }),
    )
    expect(provisioningHook).toBeDefined()

    for (const path of [
      '/admin/oauth2/create-client',
      '/admin/oauth2/update-client',
      '/admin/oauth2/resources',
      '/admin/oauth2/resources/:identifier',
    ]) {
      expect(provisioningHook!.matcher({ path })).toBe(true)
    }
    expect(provisioningHook!.matcher({ method: 'GET', path: '/admin/oauth2/resources' })).toBe(
      false,
    )
    expect(
      provisioningHook!.matcher({
        method: 'GET',
        path: '/admin/oauth2/resources/:identifier',
      }),
    ).toBe(false)
    expect(
      provisioningHook!.matcher({
        method: 'DELETE',
        path: '/admin/oauth2/resources/:identifier',
      }),
    ).toBe(false)
  })
})
