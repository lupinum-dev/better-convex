import type { Auth } from 'better-auth'
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

interface OAuthOperatorApi {
  adminCreateOAuthResource(input: { body: Record<string, unknown> }): Promise<OAuthOperatorResource>
  adminCreateOAuthClient(input: {
    body: Record<string, unknown>
  }): Promise<{ client_id?: unknown } | null>
  adminDeleteOAuthResource(input: { params: { identifier: string } }): Promise<unknown>
  adminLinkClientResource(input: {
    params: { client_id: string; identifier: string }
  }): Promise<unknown>
  adminListOAuthResources(): Promise<OAuthOperatorResource[]>
  deleteOAuthClient(input: { body: { client_id: string } }): Promise<unknown>
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

function requireOperatorApi(api: Auth['api']): OAuthOperatorApi {
  const candidate = api as unknown as Partial<OAuthOperatorApi>
  if (
    typeof candidate.adminCreateOAuthClient !== 'function' ||
    typeof candidate.adminCreateOAuthResource !== 'function' ||
    typeof candidate.adminDeleteOAuthResource !== 'function' ||
    typeof candidate.adminListOAuthResources !== 'function' ||
    typeof candidate.adminLinkClientResource !== 'function' ||
    typeof candidate.deleteOAuthClient !== 'function'
  ) {
    throw new TypeError('AUTH_OAUTH_PROVIDER_REQUIRED')
  }
  return candidate as OAuthOperatorApi
}

async function rollbackProvisioning(
  api: OAuthOperatorApi,
  input: { clientId?: string; resourceCreated: boolean; resourceIdentifier: string },
): Promise<void> {
  let clientRemoved = input.clientId === undefined
  let cleanupFailed = false
  if (input.clientId !== undefined) {
    try {
      await api.deleteOAuthClient({ body: { client_id: input.clientId } })
      clientRemoved = true
    } catch {
      cleanupFailed = true
    }
  }
  if (input.resourceCreated && clientRemoved) {
    try {
      await api.adminDeleteOAuthResource({ params: { identifier: input.resourceIdentifier } })
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
  ) => Promise<{ api: Auth['api'] }>
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
      const api = requireOperatorApi((await input.createAuth(ctx, oauthProfile)).api)
      const resources = await api.adminListOAuthResources()
      let resource = resources.find((candidate) => candidate.identifier === resourceIdentifier)
      let resourceCreated = false
      if (!resource) {
        resource = await api.adminCreateOAuthResource({
          body: {
            accessTokenTtl: 600,
            allowedScopes: scopes,
            disabled: false,
            dpopBoundAccessTokensRequired: false,
            identifier: resourceIdentifier,
            name: resourceName,
            signingAlgorithm: 'RS256',
          },
        })
        resourceCreated = true
      }
      const resourceScopes = Array.isArray(resource.allowedScopes) ? resource.allowedScopes : null
      if (
        resource.identifier !== resourceIdentifier ||
        resource.name !== resourceName ||
        resource.accessTokenTtl !== 600 ||
        resource.disabled !== false ||
        resource.dpopBoundAccessTokensRequired !== false ||
        resource.signingAlgorithm !== 'RS256' ||
        resourceScopes === null ||
        resourceScopes.length !== scopes.length ||
        scopes.some((scope) => !resourceScopes.includes(scope))
      ) {
        if (resourceCreated) {
          await rollbackProvisioning(api, { resourceCreated, resourceIdentifier })
        }
        throw new Error('AUTH_OAUTH_RESOURCE_PROFILE_INVALID')
      }
      let clientId: string | undefined
      try {
        const client = await api.adminCreateOAuthClient({
          body: {
            application_type: 'native',
            client_name: name,
            dpop_bound_access_tokens: false,
            enable_end_session: false,
            grant_types: ['authorization_code'],
            redirect_uris: redirectUris,
            require_pkce: true,
            response_types: ['code'],
            scope: scopes.join(' '),
            skip_consent: false,
            software_id: profile,
            subject_type: 'public',
            token_endpoint_auth_method: 'none',
          },
        })
        if (typeof client?.client_id !== 'string' || !client.client_id) {
          throw new Error('AUTH_OAUTH_CLIENT_CREATE_FAILED')
        }
        clientId = client.client_id
        await api.adminLinkClientResource({
          params: { client_id: clientId, identifier: resourceIdentifier },
        })
      } catch {
        await rollbackProvisioning(api, { clientId, resourceCreated, resourceIdentifier })
        throw new Error('AUTH_OAUTH_CLIENT_PROVISION_FAILED')
      }
      return { clientId }
    },
    async deleteClient(ctx: AuthCtx<DataModel>, clientInput: { readonly clientId: string }) {
      const clientId = requireString(clientInput.clientId, 'ID')
      const oauthProfile = await input.resolveProfile(ctx)
      if (!oauthProfile) throw new TypeError('AUTH_OAUTH_PROVIDER_REQUIRED')
      const api = requireOperatorApi((await input.createAuth(ctx, oauthProfile)).api)
      await api.deleteOAuthClient({ body: { client_id: clientId } })
    },
  })
}
