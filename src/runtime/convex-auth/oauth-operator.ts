import type { GenericDataModel } from 'convex/server'

import type { AuthCtx } from './context'
import { validateOAuthProviderProfile, type PinnedOAuthProviderProfile } from './oauth-security'

export interface BetterConvexPublicOAuthClientInput {
  readonly name: string
  readonly profile: string
  readonly redirectUris: readonly [string, ...string[]]
  readonly resource: {
    readonly identifier: string
    readonly name: string
    readonly ownership: 'application'
  }
  readonly scopes: readonly [string, ...string[]]
}

export interface BetterConvexOAuthOperator<DataModel extends GenericDataModel> {
  readonly createPublicClient: (
    ctx: AuthCtx<DataModel>,
    input: BetterConvexPublicOAuthClientInput,
  ) => Promise<{ readonly clientId: string }>
  readonly deleteClient: (
    ctx: AuthCtx<DataModel>,
    input: { readonly clientId: string },
  ) => Promise<void>
}

interface OAuthOperatorResource {
  accessTokenTtl?: unknown
  allowedScopes?: unknown
  disabled?: unknown
  dpopBoundAccessTokensRequired?: unknown
  identifier?: unknown
  name?: unknown
  signingAlgorithm?: unknown
}

interface OAuthOperatorAdapter {
  create(input: { data: Record<string, unknown>; model: string }): Promise<Record<string, unknown>>
  delete(input: { model: string; where: Array<{ field: string; value: string }> }): Promise<unknown>
  deleteMany(input: {
    model: string
    where: Array<{ field: string; value: string }>
  }): Promise<unknown>
  findOne(input: {
    model: string
    where: Array<{ field: string; value: string }>
  }): Promise<OAuthOperatorResource | null>
}

function requireString(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`AUTH_OAUTH_CLIENT_${name}_INVALID`)
  return normalized
}

function requireValues(values: readonly [string, ...string[]], name: string): string[] {
  const normalized = values.map((value) => requireString(value, name))
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`AUTH_OAUTH_CLIENT_${name}_INVALID`)
  }
  return normalized
}

function requireUrl(value: string, name: 'REDIRECT_URI' | 'RESOURCE'): string {
  const normalized = requireString(value, name)
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error(`AUTH_OAUTH_CLIENT_${name}_INVALID`)
  }
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    (name === 'RESOURCE' && (url.search || url.pathname === '/'))
  ) {
    throw new Error(`AUTH_OAUTH_CLIENT_${name}_INVALID`)
  }
  return url.toString()
}

function requireOperatorAdapter(context: unknown): OAuthOperatorAdapter {
  const candidate = (context as { adapter?: Partial<OAuthOperatorAdapter> } | null)?.adapter
  if (
    typeof candidate?.create !== 'function' ||
    typeof candidate.delete !== 'function' ||
    typeof candidate.deleteMany !== 'function' ||
    typeof candidate.findOne !== 'function'
  ) {
    throw new TypeError('AUTH_OAUTH_PROVIDER_REQUIRED')
  }
  return candidate as OAuthOperatorAdapter
}

function generatePublicClientId(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

function assertResourceProfile(
  resource: OAuthOperatorResource,
  input: { identifier: string; name: string; scopes: readonly string[] },
): void {
  const resourceScopes = Array.isArray(resource.allowedScopes) ? resource.allowedScopes : null
  if (
    resource.identifier !== input.identifier ||
    resource.name !== input.name ||
    resource.accessTokenTtl !== 600 ||
    resource.disabled !== false ||
    resource.dpopBoundAccessTokensRequired !== false ||
    resource.signingAlgorithm !== 'RS256' ||
    resourceScopes === null ||
    resourceScopes.length !== input.scopes.length ||
    input.scopes.some((scope) => !resourceScopes.includes(scope))
  ) {
    throw new Error('AUTH_OAUTH_RESOURCE_PROFILE_INVALID')
  }
}

async function rollbackProvisioning(
  adapter: OAuthOperatorAdapter,
  input: { clientId?: string; resourceCreated: boolean; resourceIdentifier: string },
): Promise<void> {
  let clientRemoved = input.clientId === undefined
  let cleanupFailed = false
  if (input.clientId !== undefined) {
    let linksRemoved = false
    try {
      await adapter.deleteMany({
        model: 'oauthClientResource',
        where: [{ field: 'clientId', value: input.clientId }],
      })
      linksRemoved = true
    } catch {
      cleanupFailed = true
    }
    if (linksRemoved) {
      try {
        await adapter.delete({
          model: 'oauthClient',
          where: [{ field: 'clientId', value: input.clientId }],
        })
        clientRemoved = true
      } catch {
        cleanupFailed = true
      }
    }
  }
  if (input.resourceCreated && clientRemoved) {
    try {
      await adapter.delete({
        model: 'oauthResource',
        where: [{ field: 'identifier', value: input.resourceIdentifier }],
      })
    } catch {
      cleanupFailed = true
    }
  }
  if (cleanupFailed) throw new Error('AUTH_OAUTH_CLIENT_PARTIAL_CLEANUP_FAILED')
}

export function createOAuthOperator<DataModel extends GenericDataModel>(input: {
  createAuth: (
    ctx: AuthCtx<DataModel>,
    profile: PinnedOAuthProviderProfile,
  ) => Promise<{ $context: Promise<unknown> }>
  resolveProfile: (
    ctx: AuthCtx<DataModel>,
  ) => PinnedOAuthProviderProfile | Promise<PinnedOAuthProviderProfile | undefined> | undefined
}): BetterConvexOAuthOperator<DataModel> {
  return Object.freeze({
    async createPublicClient(
      ctx: AuthCtx<DataModel>,
      clientInput: BetterConvexPublicOAuthClientInput,
    ) {
      const name = requireString(clientInput.name, 'NAME')
      const profile = requireString(clientInput.profile, 'PROFILE')
      const redirectUris = requireValues(clientInput.redirectUris, 'REDIRECT_URI').map((value) =>
        requireUrl(value, 'REDIRECT_URI'),
      )
      const scopes = requireValues(clientInput.scopes, 'SCOPE')
      const resourceIdentifier = requireUrl(clientInput.resource.identifier, 'RESOURCE')
      if (clientInput.resource.ownership !== 'application') {
        throw new Error('AUTH_OAUTH_CLIENT_RESOURCE_OWNERSHIP_INVALID')
      }
      const resourceName = requireString(clientInput.resource.name, 'RESOURCE_NAME')
      let oauthProfile: PinnedOAuthProviderProfile | undefined
      try {
        oauthProfile = await input.resolveProfile(ctx)
        if (oauthProfile) validateOAuthProviderProfile(oauthProfile)
      } catch {
        throw new Error('AUTH_CONFIG_INVALID')
      }
      if (!oauthProfile) throw new TypeError('AUTH_OAUTH_PROVIDER_REQUIRED')
      const admittedScopes = new Set(oauthProfile.scopes)
      if (scopes.some((scope) => !admittedScopes.has(scope))) {
        throw new Error('AUTH_OAUTH_CLIENT_SCOPE_NOT_ADMITTED')
      }
      const auth = await input.createAuth(ctx, oauthProfile)
      const adapter = requireOperatorAdapter(await auth.$context)
      let resource = await adapter.findOne({
        model: 'oauthResource',
        where: [{ field: 'identifier', value: resourceIdentifier }],
      })
      let resourceCreated = false
      if (!resource) {
        try {
          resource = await adapter.create({
            model: 'oauthResource',
            data: {
              accessTokenTtl: 600,
              allowedScopes: scopes,
              customClaims: null,
              disabled: false,
              dpopBoundAccessTokensRequired: false,
              identifier: resourceIdentifier,
              metadata: null,
              name: resourceName,
              policyVersion: 1,
              refreshTokenTtl: null,
              signingAlgorithm: 'RS256',
              signingKeyId: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          })
          resourceCreated = true
        } catch {
          resource = await adapter.findOne({
            model: 'oauthResource',
            where: [{ field: 'identifier', value: resourceIdentifier }],
          })
          if (!resource) throw new Error('AUTH_OAUTH_RESOURCE_CREATE_FAILED')
        }
      }
      try {
        assertResourceProfile(resource, {
          identifier: resourceIdentifier,
          name: resourceName,
          scopes,
        })
      } catch {
        if (resourceCreated) {
          await rollbackProvisioning(adapter, { resourceCreated, resourceIdentifier })
        }
        throw new Error('AUTH_OAUTH_RESOURCE_PROFILE_INVALID')
      }
      const clientId = generatePublicClientId()
      try {
        const now = new Date(Math.floor(Date.now() / 1_000) * 1_000)
        await adapter.create({
          model: 'oauthClient',
          data: {
            applicationType: 'native',
            clientCredentialsScopes: [],
            clientDiscoveryId: null,
            clientId,
            createdAt: now,
            disabled: false,
            dpopBoundAccessTokens: false,
            enableEndSession: false,
            grantTypes: ['authorization_code'],
            name,
            redirectUris,
            requirePKCE: true,
            responseTypes: ['code'],
            scopes,
            skipConsent: false,
            softwareId: profile,
            subjectType: 'public',
            tokenEndpointAuthMethod: 'none',
            updatedAt: now,
          },
        })
        await adapter.create({
          model: 'oauthClientResource',
          data: { clientId, createdAt: new Date(), resourceId: resourceIdentifier },
        })
      } catch {
        await rollbackProvisioning(adapter, { clientId, resourceCreated, resourceIdentifier })
        throw new Error('AUTH_OAUTH_CLIENT_PROVISION_FAILED')
      }
      return { clientId }
    },
    async deleteClient(ctx: AuthCtx<DataModel>, clientInput: { readonly clientId: string }) {
      const clientId = requireString(clientInput.clientId, 'ID')
      const oauthProfile = await input.resolveProfile(ctx)
      if (!oauthProfile) throw new TypeError('AUTH_OAUTH_PROVIDER_REQUIRED')
      const auth = await input.createAuth(ctx, oauthProfile)
      const adapter = requireOperatorAdapter(await auth.$context)
      await rollbackProvisioning(adapter, {
        clientId,
        resourceCreated: false,
        resourceIdentifier: '',
      })
    },
  })
}
