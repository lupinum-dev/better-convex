/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import {
  componentsGeneric,
  defineSchema,
  getFunctionAddress,
  type GenericDataModel,
  type GenericQueryCtx,
} from 'convex/server'
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

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'provisions an HTTP loopback redirect and resource on %s',
    async (host) => {
      const { test, auth, rows } = setup()
      const redirectUri = `http://${host}:3000/callback`
      const identifier = `http://${host}:3210/mcp`
      const { clientId } = await test.action(async (ctx) =>
        auth.oauthOperator.createPublicClient(ctx, {
          ...clientInput,
          redirectUris: [redirectUri],
          resource: { ...clientInput.resource!, identifier },
        }),
      )
      expect(await rows('oauthClient')).toMatchObject([{ clientId, redirectUris: [redirectUri] }])
      expect(await rows('oauthResource')).toMatchObject([{ identifier }])
      expect(await rows('oauthClientResource')).toMatchObject([
        { clientId, resourceId: identifier },
      ])
    },
  )

  // Every input below is invalid, so the context check must come first to produce this code.
  type Operator = ReturnType<typeof setup>['auth']['oauthOperator']
  type QueryCtx = GenericQueryCtx<GenericDataModel>
  it.each<[string, (operator: Operator, ctx: QueryCtx) => Promise<unknown>]>([
    [
      'createPublicClient',
      // @ts-expect-error A query ctx cannot write OAuth records.
      (operator, ctx) => operator.createPublicClient(ctx, { ...clientInput, name: ' ' }),
    ],
    [
      'deleteClient',
      // @ts-expect-error A query ctx cannot write OAuth records.
      (operator, ctx) => operator.deleteClient(ctx, { clientId: ' ' }),
    ],
    [
      'createHostClient',
      // @ts-expect-error A query ctx cannot write OAuth records.
      (operator, ctx) => operator.createHostClient(ctx, { host: 'claude' }),
    ],
    [
      'setClientDisabled',
      // @ts-expect-error A query ctx cannot write OAuth records.
      (operator, ctx) => operator.setClientDisabled(ctx, { clientId: ' ', disabled: true }),
    ],
  ])('refuses a query ctx in %s before it checks the input', async (_name, call) => {
    const { test, auth } = setup()
    await expect(test.query(async (ctx) => call(auth.oauthOperator, ctx))).rejects.toThrow(
      /^AUTH_WRITE_REQUIRES_MUTATION_OR_ACTION$/u,
    )
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
      'http://[::ffff:127.0.0.1]:3210/mcp',
      'http://127.0.0.2:3210/mcp',
      'https://user:password@deployment.convex.site/mcp',
      'https://deployment.convex.site/mcp?tenant=private',
      'https://deployment.convex.site/mcp#token',
    ].map((identifier) => [
      `resource identifier ${identifier}`,
      { resource: { ...clientInput.resource, identifier } },
      'AUTH_OAUTH_CLIENT_RESOURCE_INVALID',
    ]),
    [
      'operator resource ownership',
      { resource: { ...clientInput.resource, ownership: 'operator' } },
      'AUTH_OAUTH_CLIENT_RESOURCE_OWNERSHIP_INVALID',
    ],
    [
      'a scope outside the profile',
      { scopes: ['cms.admin'] },
      'AUTH_OAUTH_CLIENT_SCOPE_NOT_ADMITTED',
    ],
  ] as Array<[string, object, string]>)(
    'rejects OAuth operator input with %s before provisioning',
    async (_name, override, code) => {
      const { test, auth, rows } = setup()
      await expect(
        test.action(async (ctx) =>
          auth.oauthOperator.createPublicClient(ctx, {
            ...clientInput,
            ...override,
          } as BetterConvexPublicOAuthClientInput),
        ),
      ).rejects.toThrow(new RegExp(`^${code}$`, 'u'))
      expect(await rows('oauthClient')).toEqual([])
      expect(await rows('oauthResource')).toEqual([])
      expect(await rows('oauthClientResource')).toEqual([])
    },
  )

  it('removes a newly created client and resource when resource linking fails', async () => {
    const { test, auth, rows } = setup()
    let rowsBeforeLinkFailure: number[] = []
    await expect(
      test.action(async (ctx) => {
        const runMutation: typeof ctx.runMutation = async (reference, args) => {
          if (
            getFunctionAddress(reference).reference ===
              getFunctionAddress(component.adapter.create).reference &&
            args?.model === 'oauthClientResource'
          ) {
            rowsBeforeLinkFailure = [
              (await rows('oauthClient')).length,
              (await rows('oauthResource')).length,
            ]
            throw new Error('private provider failure')
          }
          return ctx.runMutation(reference, args)
        }
        return auth.oauthOperator.createPublicClient({ ...ctx, runMutation }, clientInput)
      }),
    ).rejects.toThrow(/^AUTH_OAUTH_CLIENT_PROVISION_FAILED$/u)
    expect(rowsBeforeLinkFailure).toEqual([1, 1])
    expect(await rows('oauthClient')).toEqual([])
    expect(await rows('oauthResource')).toEqual([])
    expect(await rows('oauthClientResource')).toEqual([])
  })

  it('reports partial cleanup precisely and preserves the resource when client cleanup fails', async () => {
    const { test, auth, rows } = setup()
    let rowsBeforeLinkFailure: number[] = []
    await expect(
      test.action(async (ctx) => {
        const runMutation: typeof ctx.runMutation = async (reference, args) => {
          const address = getFunctionAddress(reference).reference
          if (
            address === getFunctionAddress(component.adapter.create).reference &&
            args?.model === 'oauthClientResource'
          ) {
            rowsBeforeLinkFailure = [
              (await rows('oauthClient')).length,
              (await rows('oauthResource')).length,
            ]
            throw new Error('private provider failure')
          }
          if (
            address === getFunctionAddress(component.adapter.deleteOne).reference &&
            args?.model === 'oauthClient'
          ) {
            throw new Error('private cleanup failure')
          }
          return ctx.runMutation(reference, args)
        }
        return auth.oauthOperator.createPublicClient({ ...ctx, runMutation }, clientInput)
      }),
    ).rejects.toThrow(/^AUTH_OAUTH_CLIENT_PARTIAL_CLEANUP_FAILED$/u)
    expect(rowsBeforeLinkFailure).toEqual([1, 1])
    const clients = await rows('oauthClient')
    expect(clients).toHaveLength(1)
    expect(clients[0]).toMatchObject({
      name: 'Ginko certification',
      softwareId: 'ginko-certification-proof',
    })
    const resources = await rows('oauthResource')
    expect(resources).toHaveLength(1)
    expect(resources[0]).toMatchObject({
      identifier: 'https://deployment.convex.site/mcp',
      name: 'Ginko CMS MCP',
      allowedScopes: ['cms.read', 'cms.entries.edit'],
      disabled: false,
    })
    expect(await rows('oauthClientResource')).toEqual([])
  })
})
