import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'
import {
  CLAUDE_MCP_REDIRECT_URI,
  resolveMcpHostRedirectUri,
  resolveMcpProfile,
  resolveMcpResource,
} from '../../src/runtime/convex-auth/mcp-profile'
import { createOAuthOperator } from '../../src/runtime/convex-auth/oauth-operator'
import {
  hasOAuthRenewal,
  validateOAuthProviderProfile,
} from '../../src/runtime/convex-auth/oauth-security'

const scopes = { 'mcp:read': 'Read your projects', 'mcp:write': 'Change your projects' }

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.example.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('MCP OAuth profile', () => {
  it('builds the reviewed pinned provider profile with session-bound renewal by default', () => {
    const profile = resolveMcpProfile({ scopes })
    expect(() => validateOAuthProviderProfile(profile.provider)).not.toThrow()
    expect(hasOAuthRenewal(profile.provider)).toBe(true)
    expect(profile.provider).toMatchObject({
      accessTokenExpiresIn: 600,
      allowDynamicClientRegistration: false,
      allowPublicClientPrelogin: true,
      allowUnauthenticatedClientRegistration: false,
      codeExpiresIn: 120,
      consentPage: '/oauth/consent',
      dpop: { signingAlgorithms: [] },
      enforcePerClientResources: true,
      grantTypes: ['authorization_code', 'refresh_token'],
      loginPage: '/login',
      refreshTokenExpiresIn: 604800,
      refreshTokenReuseInterval: 10,
      scopes: ['mcp:read', 'mcp:write', 'offline_access'],
      storeClientSecret: 'hashed',
      storeTokens: 'hashed',
    })
    expect(profile.scopes).toEqual(scopes)
    expect(resolveMcpResource(profile).href).toBe('https://deployment.example.test/mcp')
  })

  it('B03 validates the final 64-scope limit including renewal', () => {
    const applicationScopes = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [`scope:${index}`, 'Read projects']),
    )
    expect(() => resolveMcpProfile({ scopes: applicationScopes })).toThrow(
      'at most 63 application scopes when renewal is enabled (64 provider scopes including offline_access)',
    )
    delete applicationScopes['scope:63']
    const profile = resolveMcpProfile({ scopes: applicationScopes })
    expect(profile.provider.scopes).toHaveLength(64)
    expect(() => validateOAuthProviderProfile(profile.provider)).not.toThrow()
    applicationScopes['scope:63'] = 'Read projects'
    const withoutRenewal = resolveMcpProfile({ scopes: applicationScopes, renewal: false })
    expect(withoutRenewal.provider.scopes).toHaveLength(64)
    expect(() => validateOAuthProviderProfile(withoutRenewal.provider)).not.toThrow()
  })

  it('omits renewal entirely when disabled', () => {
    const profile = resolveMcpProfile({ scopes, renewal: false, loginPage: '/sign-in' })
    expect(() => validateOAuthProviderProfile(profile.provider)).not.toThrow()
    expect(profile.provider.grantTypes).toEqual(['authorization_code'])
    expect(profile.provider.scopes).toEqual(['mcp:read', 'mcp:write'])
    expect(profile.provider).not.toHaveProperty('refreshTokenExpiresIn')
    expect(profile.provider.loginPage).toBe('/sign-in')
  })

  it('denies client and resource management through Better Auth endpoints', async () => {
    const { provider } = resolveMcpProfile({ scopes })
    const identity = { headers: new Headers(), session: { userId: 'u' }, user: { id: 'u' } }
    await expect(
      (provider.clientPrivileges as (value: unknown) => unknown)(identity),
    ).resolves.toBe(false)
    await expect(
      (provider.resourcePrivileges as (value: unknown) => unknown)(identity),
    ).resolves.toBe(false)
  })

  it('accepts an absolute resource URL', () => {
    const profile = resolveMcpProfile({ scopes, resource: 'https://mcp.example.test/v1/mcp' })
    expect(resolveMcpResource(profile).href).toBe('https://mcp.example.test/v1/mcp')
  })

  it.each([
    ['missing scopes', {}],
    ['empty scopes', { scopes: {} }],
    ['forbidden scope', { scopes: { openid: 'Sign in' } }],
    ['library-owned scope', { scopes: { offline_access: 'Stay signed in' } }],
    ['invalid scope name', { scopes: { 'mcp read': 'Read' } }],
    ['missing description', { scopes: { 'mcp:read': '' } }],
    ['long description', { scopes: { 'mcp:read': 'x'.repeat(201) } }],
    ['unknown option', { scopes, dynamicRegistration: true }],
    ['unknown host', { scopes, hosts: ['cursor'] }],
    ['duplicate host', { scopes, hosts: ['claude', 'claude'] }],
    ['non-boolean renewal', { scopes, renewal: 'yes' }],
    ['root resource', { scopes, resource: '/' }],
    ['protocol-relative resource', { scopes, resource: '//evil.example/mcp' }],
    ['resource with query', { scopes, resource: 'https://mcp.example.test/mcp?tenant=1' }],
    ['plain http resource', { scopes, resource: 'http://mcp.example.test/mcp' }],
    ['resource without path', { scopes, resource: 'https://mcp.example.test' }],
    ['resource with credentials', { scopes, resource: 'https://u:p@mcp.example.test/mcp' }],
    ['external login page', { scopes, loginPage: 'https://evil.example/login' }],
    ['protocol-relative consent page', { scopes, consentPage: '//evil.example/consent' }],
  ])('rejects %s', (_label, options) => {
    expect(() => resolveMcpProfile(options)).toThrow('[better-convex] createBetterConvexAuth')
  })

  it('is exclusive with a hand-written provider profile and requires the mcp key', () => {
    expect(() =>
      createBetterConvexAuth({} as never, {
        oauth: { mcp: { scopes } },
        oauthProvider: resolveMcpProfile({ scopes }).provider,
      }),
    ).toThrow('either "oauth.mcp" or "oauthProvider"')
    expect(() => createBetterConvexAuth({} as never, { oauth: {} as never })).toThrow(
      'requires "oauth.mcp"',
    )
    expect(() =>
      createBetterConvexAuth({} as never, { oauth: { mcp: { scopes }, extra: 1 } as never }),
    ).toThrow('does not support "oauth.extra"')
  })

  it('advertises offline_access only while renewal is on', () => {
    const renewable = createBetterConvexAuth({ adapter: {} } as never, {
      oauth: { mcp: { scopes } },
    })
    expect(renewable.mcp.scopesSupported()).toEqual(['mcp:read', 'mcp:write', 'offline_access'])
    expect(Object.isFrozen(renewable.mcp.scopesSupported())).toBe(true)
    const accessOnly = createBetterConvexAuth({ adapter: {} } as never, {
      oauth: { mcp: { scopes, renewal: false } },
    })
    expect(accessOnly.mcp.scopesSupported()).toEqual(['mcp:read', 'mcp:write'])
  })

  it('reports a missing profile from every MCP accessor', () => {
    const auth = createBetterConvexAuth({ adapter: {} } as never)
    expect(() => auth.mcp.resource()).toThrow('AUTH_OAUTH_MCP_PROFILE_REQUIRED')
    expect(() => auth.mcp.issuer()).toThrow('AUTH_OAUTH_MCP_PROFILE_REQUIRED')
    expect(() => auth.mcp.scopes()).toThrow('AUTH_OAUTH_MCP_PROFILE_REQUIRED')
    expect(() => auth.mcp.scopesSupported()).toThrow('AUTH_OAUTH_MCP_PROFILE_REQUIRED')
    expect(() => auth.createMcpAccessVerifier({ runQuery: vi.fn() } as never)).toThrow(
      'AUTH_OAUTH_MCP_PROFILE_REQUIRED',
    )
  })
})

describe('MCP host redirect presets', () => {
  it('uses the fixed Claude callback', () => {
    expect(resolveMcpHostRedirectUri('claude', undefined)).toBe(CLAUDE_MCP_REDIRECT_URI)
    expect(resolveMcpHostRedirectUri('claude', CLAUDE_MCP_REDIRECT_URI)).toBe(
      'https://claude.ai/api/mcp/auth_callback',
    )
    expect(() => resolveMcpHostRedirectUri('claude', 'https://claude.ai/other')).toThrow(
      'AUTH_OAUTH_CLIENT_REDIRECT_URI_INVALID',
    )
  })

  it.each([
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector/oauth/abc_DEF-123',
  ])('admits the ChatGPT connector callback %s', (uri) => {
    expect(resolveMcpHostRedirectUri('chatgpt', uri)).toBe(uri)
  })

  it.each([
    undefined,
    'https://chatgpt.com.evil.example/connector_platform_oauth_redirect',
    'http://chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector_platform_oauth_redirect?next=https://evil.example',
    'https://chatgpt.com/connector_platform_oauth_redirect#x',
    'https://user@chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector/oauth/../../evil',
    'https://chatgpt.com/connector/oauth/a/b',
    'https://chatgpt.com/other',
    'https://CHATGPT.com/connector_platform_oauth_redirect',
  ])('rejects the ChatGPT callback %s', (uri) => {
    expect(() => resolveMcpHostRedirectUri('chatgpt', uri)).toThrow(
      'AUTH_OAUTH_CLIENT_REDIRECT_URI_INVALID',
    )
  })

  it('provisions a host client only for an enabled host, bound to the MCP resource', async () => {
    const mcp = resolveMcpProfile({ scopes, hosts: ['claude'] })
    const created: Record<string, unknown>[] = []
    const adapter = {
      create: vi.fn(async ({ data, model }: { data: Record<string, unknown>; model: string }) => {
        created.push({ model, ...data })
        return data
      }),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findOne: vi.fn(async () => null),
    }
    const operator = createOAuthOperator({
      appName: 'Example',
      component: {} as never,
      createAuth: async () => ({ $context: Promise.resolve({ adapter }) }),
      mcp,
      resolveProfile: () => mcp.provider,
    })
    await expect(operator.createHostClient({} as never, { host: 'claude' })).resolves.toEqual({
      clientId: expect.any(String),
    })
    expect(created.find((row) => row.model === 'oauthClient')).toMatchObject({
      name: 'Example for Claude',
      redirectUris: [CLAUDE_MCP_REDIRECT_URI],
      requirePKCE: true,
      scopes: ['mcp:read', 'mcp:write', 'offline_access'],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'none',
      skipConsent: false,
    })
    expect(created.find((row) => row.model === 'oauthClientResource')).toMatchObject({
      resourceId: 'https://deployment.example.test/mcp',
    })
    await expect(
      operator.createHostClient({} as never, {
        host: 'chatgpt',
        redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      }),
    ).rejects.toThrow('AUTH_OAUTH_CLIENT_HOST_NOT_ENABLED')
    await expect(
      operator.createHostClient({} as never, { host: 'claude', scopes: ['admin'] }),
    ).rejects.toThrow('AUTH_OAUTH_CLIENT_SCOPE_NOT_ADMITTED')
  })

  it('requires the MCP profile for host clients', async () => {
    const operator = createOAuthOperator({
      component: {} as never,
      createAuth: async () => ({ $context: Promise.resolve({}) }),
      resolveProfile: () => undefined,
    })
    await expect(operator.createHostClient({} as never, { host: 'claude' })).rejects.toThrow(
      'AUTH_OAUTH_MCP_PROFILE_REQUIRED',
    )
  })
})
