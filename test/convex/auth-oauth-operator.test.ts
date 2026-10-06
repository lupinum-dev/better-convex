/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, defineSchema } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import { createBetterConvexAuth } from '../../src/runtime/convex-auth/create-better-convex-auth'
import type { BetterConvexPublicOAuthClientInput } from '../../src/runtime/convex-auth/oauth-operator'
import type { PinnedOAuthProviderProfile } from '../../src/runtime/convex-auth/oauth-security'

const rootModules = import.meta.glob('../fixtures/jwks-rotation/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const component = (
  componentsGeneric() as unknown as {
    authRotation: ComponentApi<'authRotation'>
  }
).authRotation

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

const clientInput: BetterConvexPublicOAuthClientInput = {
  name: 'Ginko certification',
  profile: 'ginko-certification-proof',
  redirectUris: ['http://localhost:3000/oauth-proof/callback'],
  resource: {
    identifier: 'https://deployment.convex.site/mcp',
    name: 'Ginko CMS MCP',
    ownership: 'application',
  },
  scopes: ['cms.read', 'cms.entries.edit'],
}

function setup() {
  const test = convexTest(defineSchema({}), rootModules)
  test.registerComponent('authRotation', authSchema, authModules)
  const auth = createBetterConvexAuth(component, { oauthProvider: oauthProfile() })
  const rows = async (model: string) =>
    (
      await test.query(component.adapter.findMany, {
        model,
        paginationOpts: { cursor: null, numItems: 10 },
      })
    ).page
  return { test, auth, rows }
}

describe('OAuth operators with real Better Auth', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_URL', 'https://app.example.test')
    vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.convex.site')
    vi.stubEnv('BETTER_AUTH_SECRETS', `0:${'test-secret'.repeat(4)}`)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('builds one hardened OAuth profile from the request-scoped Convex context', async () => {
    const { test } = setup()
    const response = await test.action(async (ctx) => {
      let resolutions = 0
      const auth = createBetterConvexAuth(component, {
        oauthProvider: async (requestCtx) => {
          resolutions += 1
          expect(requestCtx).toBe(ctx)
          expect(await requestCtx.runQuery(component.adapter.count, { model: 'oauthClient' })).toBe(
            0,
          )
          return oauthProfile()
        },
      })
      const instance = await auth.createAuth(ctx)
      const result = await instance.handler(
        new Request('https://app.example.test/api/auth/.well-known/oauth-authorization-server'),
      )
      expect(resolutions).toBe(1)
      return { status: result.status, body: await result.json() }
    })
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      issuer: 'https://app.example.test/api/auth',
      authorization_endpoint: 'https://app.example.test/api/auth/oauth2/authorize',
      token_endpoint: 'https://app.example.test/api/auth/oauth2/token',
      scopes_supported: ['cms.read', 'cms.entries.edit'],
      grant_types_supported: ['authorization_code'],
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
    })
  })

  it('preregisters and deletes a reviewed public OAuth client without exposing plugin APIs', async () => {
    const { test, auth, rows } = setup()
    const { clientId } = await test.action(async (ctx) =>
      auth.oauthOperator.createPublicClient(ctx, clientInput),
    )
    expect(clientId).toMatch(/^[a-f\d]{32}$/u)
    const clients = await rows('oauthClient')
    expect(clients).toHaveLength(1)
    expect(clients[0]).toMatchObject({
      clientId,
      name: 'Ginko certification',
      applicationType: 'native',
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
      redirectUris: ['http://localhost:3000/oauth-proof/callback'],
      requirePKCE: true,
      scopes: ['cms.read', 'cms.entries.edit'],
      softwareId: 'ginko-certification-proof',
      subjectType: 'public',
      tokenEndpointAuthMethod: 'none',
      skipConsent: false,
      disabled: false,
    })
    expect(clients[0]?.clientSecret).toBeNull()
    const resources = await rows('oauthResource')
    expect(resources).toHaveLength(1)
    expect(resources[0]).toMatchObject({
      accessTokenTtl: 600,
      allowedScopes: ['cms.read', 'cms.entries.edit'],
      disabled: false,
      dpopBoundAccessTokensRequired: false,
      identifier: 'https://deployment.convex.site/mcp',
      name: 'Ginko CMS MCP',
      signingAlgorithm: 'RS256',
    })
    const links = await rows('oauthClientResource')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ clientId, resourceId: 'https://deployment.convex.site/mcp' })

    const managementStatus = await test.action(async (ctx) => {
      const instance = await auth.createAuth(ctx)
      const response = await instance.handler(
        new Request('https://app.example.test/api/auth/oauth2/create-client', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'https://app.example.test' },
          body: JSON.stringify({ client_name: 'Unreviewed client' }),
        }),
      )
      return response.status
    })
    expect(managementStatus).toBe(404)

    await test.action(async (ctx) => auth.oauthOperator.deleteClient(ctx, { clientId }))
    expect(await rows('oauthClient')).toEqual([])
    expect(await rows('oauthClientResource')).toEqual([])
    expect(await rows('oauthResource')).toEqual(resources)
  })

  it('provisions a bracketed IPv6 loopback redirect', async () => {
    const { test, auth, rows } = setup()
    const { clientId } = await test.action(async (ctx) =>
      auth.oauthOperator.createPublicClient(ctx, {
        ...clientInput,
        redirectUris: ['http://[::1]:3000/callback'],
      }),
    )
    const clients = await rows('oauthClient')
    expect(clients).toHaveLength(1)
    expect(clients[0]).toMatchObject({ clientId, redirectUris: ['http://[::1]:3000/callback'] })
  })
})
