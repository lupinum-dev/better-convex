import { validateOAuthScopes, type PinnedOAuthProviderProfile } from './oauth-security'
import { requireAuthOrigin } from './origin'

/** MCP hosts with a reviewed redirect URI preset. */
export type BetterConvexMcpHost = 'chatgpt' | 'claude'

/**
 * The MCP OAuth profile. It configures the OAuth provider with the defaults a
 * real MCP host needs: public PKCE clients provisioned by an operator, a
 * consent page, access tokens bound to the MCP resource (`aud`), and optional
 * session-bound renewal.
 */
export interface BetterConvexMcpOptions {
  /**
   * The MCP endpoint, which is also the token audience. A path (default
   * `/mcp`) resolves against `CONVEX_SITE_URL`; an absolute URL is used as is.
   */
  readonly resource?: string
  /** Delegated scopes, name to consent description. `offline_access` is library-owned. */
  readonly scopes: Readonly<Record<string, string>>
  /** Hosts whose redirect URI presets `oauthOperator.createHostClient` admits. */
  readonly hosts?: readonly BetterConvexMcpHost[]
  /**
   * Issue session-bound refresh tokens (`offline_access`). Renewal never
   * outlives the Better Auth session that granted consent. Default `true`.
   */
  readonly renewal?: boolean
  /** App page that signs the user in for an authorization request. Default `/login`. */
  readonly loginPage?: string
  /** App page that asks for consent. Default `/oauth/consent`. */
  readonly consentPage?: string
}

export interface ResolvedMcpProfile {
  readonly consentPage: string
  readonly hosts: readonly BetterConvexMcpHost[]
  readonly loginPage: string
  readonly provider: PinnedOAuthProviderProfile
  readonly renewal: boolean
  /** Resource as configured (path or absolute URL). */
  readonly resource: string
  /** Scope descriptions, without `offline_access`. */
  readonly scopes: Readonly<Record<string, string>>
}

const MCP_OPTION_KEYS = ['consentPage', 'hosts', 'loginPage', 'renewal', 'resource', 'scopes']
const MCP_HOSTS: readonly BetterConvexMcpHost[] = ['chatgpt', 'claude']
const RESOURCE_PATH_PATTERN = /^\/[\w\-.~/]*$/u
const MAX_SCOPE_DESCRIPTION_LENGTH = 200
const OFFLINE_ACCESS = 'offline_access'

/** Claude's fixed MCP OAuth callback. */
export const CLAUDE_MCP_REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback'
const CHATGPT_ORIGIN = 'https://chatgpt.com'
const CHATGPT_CONNECTOR_PATH = /^\/connector\/oauth\/[\w-]+$/u

function configError(message: string): Error {
  return new Error(`[better-convex] createBetterConvexAuth ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validatePage(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('\\')
  ) {
    throw configError(`requires "oauth.mcp.${name}" to be an app path such as "/login"`)
  }
  return value
}

function validateAbsoluteResource(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw configError('requires "oauth.mcp.resource" to be a path or an absolute URL')
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname === '/' ||
    url.href !== value
  ) {
    throw configError(
      'requires "oauth.mcp.resource" to be a canonical https URL with a path and no query or fragment',
    )
  }
  return url
}

function validateResource(value: unknown): string {
  if (value === undefined) return '/mcp'
  if (typeof value !== 'string' || value.length === 0) {
    throw configError('requires "oauth.mcp.resource" to be a path or an absolute URL')
  }
  if (value.startsWith('/')) {
    if (value === '/' || value.includes('//') || !RESOURCE_PATH_PATTERN.test(value)) {
      throw configError('requires "oauth.mcp.resource" to be a plain path such as "/mcp"')
    }
    return value
  }
  validateAbsoluteResource(value)
  return value
}

function validateScopes(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) {
    throw configError('requires "oauth.mcp.scopes" to map scope names to descriptions')
  }
  const names = Object.keys(value)
  try {
    validateOAuthScopes(names)
  } catch {
    throw configError(
      'requires "oauth.mcp.scopes" to name 1-64 unique scopes (letters, digits, ":", ".", "/", "-", "_"), without openid, profile, or email',
    )
  }
  if (names.includes(OFFLINE_ACCESS)) {
    throw configError('owns "offline_access"; enable renewal with "oauth.mcp.renewal"')
  }
  const scopes: Record<string, string> = {}
  for (const name of names) {
    const description = value[name]
    if (
      typeof description !== 'string' ||
      description.trim().length === 0 ||
      description.length > MAX_SCOPE_DESCRIPTION_LENGTH
    ) {
      throw configError(
        `requires a description of 1-${MAX_SCOPE_DESCRIPTION_LENGTH} characters for scope "${name}"`,
      )
    }
    scopes[name] = description
  }
  return Object.freeze(scopes)
}

function validateHosts(value: unknown): readonly BetterConvexMcpHost[] {
  if (value === undefined) return Object.freeze([])
  if (
    !Array.isArray(value) ||
    value.some((host) => !MCP_HOSTS.includes(host as BetterConvexMcpHost)) ||
    new Set(value).size !== value.length
  ) {
    throw configError(`requires "oauth.mcp.hosts" to list unique hosts of ${MCP_HOSTS.join(', ')}`)
  }
  return Object.freeze([...value] as BetterConvexMcpHost[])
}

const denyClientManagement = async () => false

/**
 * Validate the `oauth.mcp` option and build the pinned provider profile.
 * Client and resource management through Better Auth endpoints is denied;
 * clients are provisioned only by the server-side `oauthOperator`.
 */
export function resolveMcpProfile(value: unknown): ResolvedMcpProfile {
  if (!isRecord(value)) throw configError('expected "oauth.mcp" to be an object')
  for (const key of Object.keys(value)) {
    if (!MCP_OPTION_KEYS.includes(key)) throw configError(`does not support "oauth.mcp.${key}"`)
  }
  const resource = validateResource(value.resource)
  const scopes = validateScopes(value.scopes)
  const hosts = validateHosts(value.hosts)
  if (value.renewal !== undefined && typeof value.renewal !== 'boolean') {
    throw configError('expected "oauth.mcp.renewal" to be a boolean')
  }
  const renewal = value.renewal !== false
  const loginPage = validatePage(value.loginPage ?? '/login', 'loginPage')
  const consentPage = validatePage(value.consentPage ?? '/oauth/consent', 'consentPage')

  const provider: PinnedOAuthProviderProfile = {
    accessTokenExpiresIn: 600,
    allowDynamicClientRegistration: false,
    allowPublicClientPrelogin: true,
    allowUnauthenticatedClientRegistration: false,
    clientPrivileges: denyClientManagement,
    codeExpiresIn: 120,
    consentPage,
    customAccessTokenClaims: () => ({ token_use: 'oauth-access' }),
    dpop: { signingAlgorithms: [] },
    enforcePerClientResources: true,
    grantTypes: renewal ? ['authorization_code', 'refresh_token'] : ['authorization_code'],
    loginPage,
    rateLimit: {
      authorize: { max: 30, window: 60 },
      revoke: { max: 30, window: 60 },
      token: { max: 20, window: 60 },
    },
    ...(renewal ? { refreshTokenExpiresIn: 604800, refreshTokenReuseInterval: 10 } : {}),
    resourcePrivileges: denyClientManagement,
    scopes: [...Object.keys(scopes), ...(renewal ? [OFFLINE_ACCESS] : [])],
    storeClientSecret: 'hashed',
    storeTokens: 'hashed',
  }

  return Object.freeze({
    consentPage,
    hosts,
    loginPage,
    provider,
    renewal,
    resource,
    scopes,
  })
}

/** This deployment's Better Auth issuer. */
export function canonicalAuthIssuer(): string {
  return `${requireAuthOrigin('SITE_URL')}/api/auth`
}

/** The MCP resource URL: a configured path resolves against `CONVEX_SITE_URL`. */
export function resolveMcpResource(profile: Pick<ResolvedMcpProfile, 'resource'>): URL {
  if (!profile.resource.startsWith('/')) return validateAbsoluteResource(profile.resource)
  return new URL(profile.resource, requireAuthOrigin('CONVEX_SITE_URL'))
}

/**
 * The exact redirect URI a host preset admits. Claude uses one fixed callback.
 * ChatGPT issues a per-connector callback on `https://chatgpt.com`, so the app
 * passes the URI ChatGPT shows and the preset checks its shape.
 */
export function resolveMcpHostRedirectUri(
  host: BetterConvexMcpHost,
  redirectUri: string | undefined,
): string {
  if (host === 'claude') {
    if (redirectUri !== undefined && redirectUri !== CLAUDE_MCP_REDIRECT_URI) {
      throw new Error('AUTH_OAUTH_CLIENT_REDIRECT_URI_INVALID')
    }
    return CLAUDE_MCP_REDIRECT_URI
  }
  if (host === 'chatgpt') {
    if (typeof redirectUri !== 'string') throw new Error('AUTH_OAUTH_CLIENT_REDIRECT_URI_INVALID')
    let url: URL
    try {
      url = new URL(redirectUri)
    } catch {
      throw new Error('AUTH_OAUTH_CLIENT_REDIRECT_URI_INVALID')
    }
    if (
      url.origin !== CHATGPT_ORIGIN ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.href !== redirectUri ||
      (url.pathname !== '/connector_platform_oauth_redirect' &&
        !CHATGPT_CONNECTOR_PATH.test(url.pathname))
    ) {
      throw new Error('AUTH_OAUTH_CLIENT_REDIRECT_URI_INVALID')
    }
    return redirectUri
  }
  throw new Error('AUTH_OAUTH_CLIENT_HOST_INVALID')
}
