import type { BetterAuthPlugin } from 'better-auth'
import { APIError } from 'better-auth/api'

import {
  OAuthSecurityError,
  assertSafeStoredOAuthClient,
  assertSafeStoredOAuthResource,
  type hardenOAuthProviderCallbacks,
  type OAuthClientRecord,
  type PinnedOAuthProviderProfile,
} from './oauth-security'

const DISABLED_PINNED_PROVIDER_PATHS = new Set([
  '/get-access-token',
  '/refresh-token',
  '/.well-known/openid-configuration',
  '/oauth2/client/rotate-secret',
  '/oauth2/create-client',
  '/oauth2/delete-client',
  '/oauth2/end-session',
  '/oauth2/get-client',
  '/oauth2/get-clients',
  '/oauth2/introspect',
  '/oauth2/register',
  '/oauth2/update-client',
  '/oauth2/userinfo',
  '/token',
])

interface InstalledOAuthProviderPlugin extends BetterAuthPlugin {
  options?: Record<string, unknown>
}

function invalidConfiguration(): never {
  throw new OAuthSecurityError('AUTH_OAUTH_CONFIG_INVALID')
}

export function validatePinnedOAuthProviderRuntime(
  context: Parameters<NonNullable<BetterAuthPlugin['init']>>[0],
  options: PinnedOAuthProviderProfile,
  hardened: ReturnType<typeof hardenOAuthProviderCallbacks>,
): InstalledOAuthProviderPlugin['options'] {
  const configuredPlugins = context.options.plugins ?? []
  const jwtIndexes = configuredPlugins
    .map((plugin, index) => (plugin.id === 'jwt' ? index : -1))
    .filter((index) => index >= 0)
  const convexIndexes = configuredPlugins
    .map((plugin, index) => (plugin.id === '@lupinum/better-convex-nuxt' ? index : -1))
    .filter((index) => index >= 0)
  const oauthIndexes = configuredPlugins
    .map((plugin, index) => (plugin.id === 'oauth-provider' ? index : -1))
    .filter((index) => index >= 0)
  if (
    jwtIndexes.length !== 1 ||
    convexIndexes.length !== 1 ||
    oauthIndexes.length !== 1 ||
    !(jwtIndexes[0]! < convexIndexes[0]! && convexIndexes[0]! < oauthIndexes[0]!)
  ) {
    invalidConfiguration()
  }

  const disabledPaths = new Set(context.options.disabledPaths ?? [])
  if ([...DISABLED_PINNED_PROVIDER_PATHS].some((path) => !disabledPaths.has(path))) {
    invalidConfiguration()
  }
  if (
    context.options.account?.encryptOAuthTokens !== true ||
    context.options.account.storeAccountCookie !== false ||
    context.options.verification?.storeIdentifier !== 'hashed'
  ) {
    invalidConfiguration()
  }

  const issuer = context.baseURL
  let issuerUrl: URL
  try {
    issuerUrl = new URL(issuer)
  } catch {
    invalidConfiguration()
  }
  if (
    issuerUrl.pathname !== '/api/auth' ||
    issuerUrl.search ||
    issuerUrl.hash ||
    issuerUrl.username ||
    issuerUrl.password
  ) {
    invalidConfiguration()
  }

  const jwtPlugin = configuredPlugins[jwtIndexes[0]!] as InstalledOAuthProviderPlugin
  const jwtOptions = jwtPlugin.options?.jwt
  const jwksOptions = jwtPlugin.options?.jwks
  if (
    !jwtOptions ||
    typeof jwtOptions !== 'object' ||
    (jwtOptions as Record<string, unknown>).issuer !== issuer ||
    (jwtOptions as Record<string, unknown>).audience !== issuer ||
    (jwtOptions as Record<string, unknown>).expirationTime !== '10m' ||
    !jwksOptions ||
    typeof jwksOptions !== 'object' ||
    ((jwksOptions as Record<string, unknown>).keyPairConfig as Record<string, unknown> | undefined)
      ?.alg !== 'RS256' ||
    (jwksOptions as Record<string, unknown>).disablePrivateKeyEncryption !== false
  ) {
    invalidConfiguration()
  }

  const oauthPlugin = configuredPlugins[oauthIndexes[0]!] as InstalledOAuthProviderPlugin
  const providerOptions = oauthPlugin.options
  if (
    !providerOptions ||
    providerOptions.clientPrivileges !== hardened.clientPrivileges ||
    providerOptions.resourcePrivileges !== hardened.resourcePrivileges ||
    providerOptions.customAccessTokenClaims !== hardened.customAccessTokenClaims ||
    providerOptions.accessTokenExpiresIn !== options.accessTokenExpiresIn ||
    providerOptions.codeExpiresIn !== options.codeExpiresIn ||
    !Array.isArray(providerOptions.grantTypes) ||
    providerOptions.grantTypes.length !== 1 ||
    providerOptions.grantTypes[0] !== 'authorization_code'
  ) {
    invalidConfiguration()
  }

  if (process.env.NODE_ENV === 'production') {
    const proxySecret = process.env.BCN_AUTH_PROXY_IP_SECRET
    if (typeof proxySecret !== 'string' || proxySecret.length < 32) {
      invalidConfiguration()
    }
  }
  return providerOptions
}

function parseScope(value: string): string[] {
  const scopes = value.split(' ')
  if (scopes.some((scope) => scope.length === 0) || new Set(scopes).size !== scopes.length) {
    invalidConfiguration()
  }
  return scopes
}

function invalidClientProfile(): never {
  throw new APIError('BAD_REQUEST', {
    message: 'AUTH_OAUTH_CLIENT_PROFILE_INVALID',
  })
}

function projectPinnedClientRecord(
  input: Record<string, unknown>,
  allowedScopes: readonly string[],
  updating: boolean,
): OAuthClientRecord {
  if (
    'public' in input ||
    'type' in input ||
    'client_credentials_scopes' in input ||
    'client_discovery_id' in input
  ) {
    invalidConfiguration()
  }
  const tokenEndpointAuthMethod =
    updating && input.token_endpoint_auth_method === undefined
      ? 'client_secret_basic'
      : input.token_endpoint_auth_method
  const rawExpiry = input.client_secret_expires_at
  const expiresAt =
    rawExpiry === undefined || rawExpiry === 0 || rawExpiry === '0'
      ? undefined
      : typeof rawExpiry === 'number' || typeof rawExpiry === 'string'
        ? new Date(Number(rawExpiry) * 1000)
        : rawExpiry
  return {
    applicationType: input.application_type === undefined ? 'web' : input.application_type,
    backchannelLogoutSessionRequired: input.backchannel_logout_session_required,
    backchannelLogoutUri: input.backchannel_logout_uri,
    clientId: 'provisioning-client',
    clientSecret: tokenEndpointAuthMethod === 'client_secret_basic' ? 'provisioning-secret' : null,
    disabled: input.disabled,
    dpopBoundAccessTokens:
      updating && input.dpop_bound_access_tokens === undefined
        ? false
        : input.dpop_bound_access_tokens,
    enableEndSession:
      updating && input.enable_end_session === undefined ? false : input.enable_end_session,
    expiresAt,
    grantTypes:
      updating && input.grant_types === undefined ? ['authorization_code'] : input.grant_types,
    jwks: input.jwks,
    jwksUri: input.jwks_uri,
    metadata: input.metadata,
    postLogoutRedirectUris: input.post_logout_redirect_uris,
    redirectUris:
      updating && input.redirect_uris === undefined
        ? ['https://provisioning.invalid/callback']
        : input.redirect_uris,
    requirePKCE: updating && input.require_pkce === undefined ? true : input.require_pkce,
    responseTypes: updating && input.response_types === undefined ? ['code'] : input.response_types,
    scopes:
      typeof input.scope === 'string'
        ? parseScope(input.scope)
        : updating
          ? [...allowedScopes]
          : [],
    skipConsent: updating && input.skip_consent === undefined ? false : input.skip_consent,
    softwareStatement: input.software_statement,
    subjectType: input.subject_type,
    tokenEndpointAuthMethod,
  }
}

export function assertSafePinnedClientProvisioning(
  method: unknown,
  body: unknown,
  allowedScopes: readonly string[],
): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalidClientProfile()
  const input = body as Record<string, unknown>
  try {
    if (method !== 'POST') invalidConfiguration()
    assertSafeStoredOAuthClient(
      projectPinnedClientRecord(input, allowedScopes, false),
      allowedScopes,
    )
  } catch {
    invalidClientProfile()
  }
}

export function assertSafePinnedClientUpdate(
  method: unknown,
  body: unknown,
  allowedScopes: readonly string[],
): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalidClientProfile()
  const input = body as Record<string, unknown>
  try {
    if (method !== 'PATCH') invalidConfiguration()
    assertSafeStoredOAuthClient(
      projectPinnedClientRecord(input, allowedScopes, true),
      allowedScopes,
    )
  } catch {
    invalidClientProfile()
  }
}

function invalidResourceProfile(): never {
  throw new APIError('BAD_REQUEST', {
    message: 'AUTH_OAUTH_RESOURCE_PROFILE_INVALID',
  })
}

export function assertSafePinnedResourceProvisioning(
  method: unknown,
  body: unknown,
  allowedScopes: readonly string[],
): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalidResourceProfile()
  const input = body as Record<string, unknown>
  try {
    if (method !== 'POST' && method !== 'PATCH') invalidConfiguration()
    const updating = method === 'PATCH'
    assertSafeStoredOAuthResource(
      {
        accessTokenTtl: input.accessTokenTtl,
        allowedScopes: input.allowedScopes,
        customClaims: input.customClaims,
        // Disabling an existing resource is an intentional terminal transition.
        // Every field that can make an enabled resource unsafe still uses the
        // canonical stored-record predicate.
        disabled: updating ? false : input.disabled,
        dpopBoundAccessTokensRequired: input.dpopBoundAccessTokensRequired,
        identifier: updating ? 'https://provisioning.invalid/resource' : String(input.identifier),
        name: updating ? 'Provisioning resource' : input.name,
        refreshTokenTtl: input.refreshTokenTtl,
        signingAlgorithm: input.signingAlgorithm,
        signingKeyId: input.signingKeyId,
      },
      allowedScopes,
    )
  } catch {
    invalidResourceProfile()
  }
}
