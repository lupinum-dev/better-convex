import type { OAuthOptions, Scope } from '@better-auth/oauth-provider'

import { readStreamWithByteLimit } from '../shared/bounded-stream'

const OAUTH_CONFIG_ERROR = 'AUTH_OAUTH_CONFIG_INVALID'
const OAUTH_REQUEST_ERROR = 'AUTH_OAUTH_REQUEST_INVALID'
const OAUTH_TOKEN_ERROR = 'AUTH_OAUTH_TOKEN_INVALID'

const FORBIDDEN_SCOPES = new Set(['email', 'offline_access', 'openid', 'profile'])
const SCOPE_PATTERN = /^[\w:./-]+$/

const TOKEN_CLAIMS = new Set([
  'aud',
  'azp',
  'client_id',
  'exp',
  'iat',
  'iss',
  'jti',
  'scope',
  'sid',
  'sub',
  'token_use',
])

/**
 * The exact Better Auth OAuth Provider profile accepted by this release.
 *
 * This is a pinned compatibility firewall, not a provider-neutral OAuth
 * configuration abstraction. Runtime validation intentionally accepts only a
 * strict subset of the exact installed provider's options.
 */
const PINNED_OAUTH_PROVIDER_KEYS = [
  'accessTokenExpiresIn',
  'allowDynamicClientRegistration',
  'allowPublicClientPrelogin',
  'allowUnauthenticatedClientRegistration',
  'advertisedMetadata',
  'clientCredentialGrantDefaultScopes',
  'clientPrivileges',
  'clientRegistrationRequirePKCE',
  'codeExpiresIn',
  'consentPage',
  'customAccessTokenClaims',
  'customIdTokenClaims',
  'customTokenResponseFields',
  'customUserInfoClaims',
  'disableJwtPlugin',
  'dpop',
  'enforcePerClientResources',
  'extensions',
  'grantTypes',
  'loginPage',
  'm2mAccessTokenExpiresIn',
  'pairwiseSecret',
  'rateLimit',
  'requestUriResolver',
  'resourcePrivileges',
  'resources',
  'scopes',
  'storeClientSecret',
  'storeTokens',
  'validateInitialAccessToken',
] as const satisfies readonly (keyof OAuthOptions<Scope[]>)[]

const PINNED_OAUTH_PROVIDER_KEY_SET = new Set<string>(PINNED_OAUTH_PROVIDER_KEYS)

export type PinnedOAuthProviderProfile = Pick<
  OAuthOptions<Scope[]>,
  (typeof PINNED_OAUTH_PROVIDER_KEYS)[number]
>

export interface OAuthClientRecord extends Record<string, unknown> {
  clientId: string
}

export interface OAuthResourceRecord extends Record<string, unknown> {
  identifier: string
}

export interface OAuthClientResourceRecord extends Record<string, unknown> {
  clientId: string
  resourceId: string
}

export interface OAuthAccessTokenExpectations {
  allowedScopes: readonly string[]
  audience: string
  clientId?: string
  issuer: string
  maxLifetimeSeconds?: number
  requiredScopes?: readonly string[]
  subject?: string
}

export interface OAuthPrincipal {
  clientId: string
  expiresAt: number
  scopes: readonly string[]
  sessionId: string
  subject: string
}

interface PrivilegeContext {
  headers: Headers
  session?: unknown
  user?: unknown
  [key: string]: unknown
}

interface HardenedOAuthCallbacks {
  clientPrivileges: (context: PrivilegeContext) => Promise<boolean>
  customAccessTokenClaims: (info: unknown) => Promise<{ token_use: 'oauth-access' }>
  resourcePrivileges: (context: PrivilegeContext) => Promise<boolean>
}

const hardenedProfiles = new WeakMap<object, HardenedOAuthCallbacks>()

export class OAuthSecurityError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'OAuthSecurityError'
    this.code = code
  }
}

interface UrlCanParseTarget {
  canParse?: (input: string | URL, base?: string | URL) => boolean
}

/**
 * Supply the one modern URL primitive absent from the manifest-pinned Convex
 * isolate but called by @better-auth/oauth-provider@1.7.0-rc.2 while parsing
 * RFC 8707 resources. Delete this helper and both call sites as soon as a
 * reviewed dependency tuple supplies the primitive or removes those calls.
 */
export function installUrlCanParseCompatibility(
  target: UrlCanParseTarget = URL as unknown as UrlCanParseTarget,
): void {
  if (typeof target.canParse === 'function') return
  Object.defineProperty(target, 'canParse', {
    configurable: true,
    value: (input: string | URL, base?: string | URL) => {
      try {
        new URL(input, base)
        return true
      } catch {
        return false
      }
    },
    writable: true,
  })
}

function invalidConfig(): never {
  throw new OAuthSecurityError(OAUTH_CONFIG_ERROR)
}

function invalidRequest(): never {
  throw new OAuthSecurityError(OAUTH_REQUEST_ERROR)
}

function invalidToken(): never {
  throw new OAuthSecurityError(OAUTH_TOKEN_ERROR)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function exactArray(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  )
}

function emptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return true
  if (Array.isArray(value)) return value.length === 0
  if (isRecord(value)) return Object.keys(value).length === 0
  return false
}

function validatePagePath(value: unknown): void {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    invalidConfig()
  }
}

export function validateOAuthScopes(scopes: unknown): asserts scopes is readonly string[] {
  if (!Array.isArray(scopes) || scopes.length === 0 || scopes.length > 64) invalidConfig()
  const seen = new Set<string>()
  for (const scope of scopes) {
    if (
      typeof scope !== 'string' ||
      !SCOPE_PATTERN.test(scope) ||
      FORBIDDEN_SCOPES.has(scope) ||
      seen.has(scope)
    ) {
      invalidConfig()
    }
    seen.add(scope)
  }
}

function validateRateLimit(value: unknown, expected: { max: number; window: number }): void {
  if (!isRecord(value) || value.max !== expected.max || value.window !== expected.window) {
    invalidConfig()
  }
}

function validateConfiguredResource(
  value: string | Record<string, unknown>,
  allowedScopes: readonly string[],
): void {
  if (typeof value === 'string') {
    validateResourceIdentifier(value)
    return
  }
  if (!isRecord(value)) invalidConfig()
  assertSafeStoredOAuthResource(
    {
      accessTokenTtl: value.accessTokenTtl,
      allowedScopes: value.allowedScopes,
      customClaims: value.customClaims,
      disabled: value.disabled,
      dpopBoundAccessTokensRequired: value.dpopBoundAccessTokensRequired,
      identifier: value.identifier as string,
      name: typeof value.name === 'string' ? value.name : 'Configured resource',
      refreshTokenTtl: value.refreshTokenTtl,
      signingAlgorithm: value.signingAlgorithm,
      signingKeyId: value.signingKeyId,
    },
    allowedScopes,
  )
}

export function validateOAuthProviderProfile(options: PinnedOAuthProviderProfile): void {
  if (!isRecord(options)) invalidConfig()
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== 'string' || !PINNED_OAUTH_PROVIDER_KEY_SET.has(key)) invalidConfig()
  }
  if (
    options.accessTokenExpiresIn !== 600 ||
    options.codeExpiresIn !== 120 ||
    options.allowDynamicClientRegistration !== false ||
    options.allowPublicClientPrelogin !== true ||
    options.allowUnauthenticatedClientRegistration !== false ||
    options.enforcePerClientResources !== true ||
    options.storeClientSecret !== 'hashed' ||
    options.storeTokens !== 'hashed' ||
    options.disableJwtPlugin === true ||
    options.clientRegistrationRequirePKCE === false ||
    !exactArray(options.grantTypes, ['authorization_code']) ||
    typeof options.clientPrivileges !== 'function' ||
    typeof options.resourcePrivileges !== 'function' ||
    typeof options.customAccessTokenClaims !== 'function'
  ) {
    invalidConfig()
  }

  validatePagePath(options.loginPage)
  validatePagePath(options.consentPage)
  validateOAuthScopes(options.scopes)

  if (
    !isRecord(options.dpop) ||
    !Array.isArray(options.dpop.signingAlgorithms) ||
    options.dpop.signingAlgorithms.length !== 0
  ) {
    invalidConfig()
  }
  if (!isRecord(options.rateLimit)) invalidConfig()
  validateRateLimit(options.rateLimit.token, { max: 20, window: 60 })
  validateRateLimit(options.rateLimit.authorize, { max: 30, window: 60 })
  validateRateLimit(options.rateLimit.revoke, { max: 30, window: 60 })

  if (
    !emptyValue(options.extensions) ||
    !emptyValue(options.validateInitialAccessToken) ||
    !emptyValue(options.requestUriResolver) ||
    !emptyValue(options.customIdTokenClaims) ||
    !emptyValue(options.customUserInfoClaims) ||
    !emptyValue(options.customTokenResponseFields) ||
    !emptyValue(options.clientCredentialGrantDefaultScopes) ||
    !emptyValue(options.pairwiseSecret) ||
    options.m2mAccessTokenExpiresIn !== undefined
  ) {
    invalidConfig()
  }

  if (options.advertisedMetadata !== undefined) {
    if (
      !isRecord(options.advertisedMetadata) ||
      !emptyValue(options.advertisedMetadata.claims_supported) ||
      (options.advertisedMetadata.scopes_supported !== undefined &&
        !exactArray(options.advertisedMetadata.scopes_supported, options.scopes))
    ) {
      invalidConfig()
    }
  }

  if (options.resources !== undefined && !Array.isArray(options.resources)) invalidConfig()
  for (const resource of options.resources ?? []) {
    if (typeof resource !== 'string' && !isRecord(resource)) invalidConfig()
    validateConfiguredResource(resource, options.scopes)
  }
}

async function runPrivilegeCallback(
  callback: (context: PrivilegeContext) => unknown,
  context: PrivilegeContext,
): Promise<boolean> {
  if (!context || typeof context !== 'object' || !context.user || !context.session) return false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      Promise.resolve()
        .then(() => callback(context))
        .catch(() => false),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 500)
      }),
    ])
    return result === true
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function hardenOAuthProviderCallbacks(
  options: PinnedOAuthProviderProfile,
): HardenedOAuthCallbacks {
  validateOAuthProviderProfile(options)
  const existing = hardenedProfiles.get(options)
  if (existing) return existing

  const clientPrivileges = options.clientPrivileges as (context: PrivilegeContext) => unknown
  const resourcePrivileges = options.resourcePrivileges as (context: PrivilegeContext) => unknown
  const accessTokenClaims = options.customAccessTokenClaims as (info: unknown) => unknown
  const hardened: HardenedOAuthCallbacks = {
    clientPrivileges: (context) => runPrivilegeCallback(clientPrivileges, context),
    resourcePrivileges: (context) => runPrivilegeCallback(resourcePrivileges, context),
    customAccessTokenClaims: async (info) => {
      let claims: unknown
      try {
        claims = await accessTokenClaims(info)
      } catch {
        invalidConfig()
      }
      if (
        !isRecord(claims) ||
        Object.keys(claims).length !== 1 ||
        claims.token_use !== 'oauth-access'
      ) {
        invalidConfig()
      }
      return { token_use: 'oauth-access' }
    },
  }
  try {
    Object.assign(options, hardened)
  } catch {
    invalidConfig()
  }
  if (
    options.clientPrivileges !== hardened.clientPrivileges ||
    options.resourcePrivileges !== hardened.resourcePrivileges ||
    options.customAccessTokenClaims !== hardened.customAccessTokenClaims
  ) {
    invalidConfig()
  }
  hardenedProfiles.set(options, hardened)
  return hardened
}

export function validateResourceIdentifier(identifier: string): void {
  let url: URL
  try {
    url = new URL(identifier)
  } catch {
    invalidConfig()
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.hash ||
    url.username ||
    url.password ||
    url.href !== identifier
  ) {
    invalidConfig()
  }
}

function isLoopbackRedirectHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export function validateOAuthRedirectUris(value: unknown): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) invalidConfig()
  const seen = new Set<string>()
  for (const redirectUri of value) {
    if (
      typeof redirectUri !== 'string' ||
      seen.has(redirectUri) ||
      redirectUri.includes('*') ||
      redirectUri.includes('#')
    ) {
      invalidConfig()
    }
    let url: URL
    try {
      url = new URL(redirectUri)
    } catch {
      invalidConfig()
    }
    const loopbackHost = isLoopbackRedirectHost(url.hostname)
    const fixedLoopback =
      url.protocol === 'http:' &&
      loopbackHost &&
      url.port !== '' &&
      Number.isSafeInteger(Number(url.port)) &&
      Number(url.port) > 0 &&
      Number(url.port) <= 65535
    if (
      (url.protocol === 'https:' ? loopbackHost : !fixedLoopback) ||
      url.hash ||
      url.username ||
      url.password ||
      url.href !== redirectUri
    ) {
      invalidConfig()
    }
    seen.add(redirectUri)
  }
}

function validateScopeSubset(
  value: unknown,
  allowedScopes: readonly string[],
  requireValue: boolean,
): void {
  if (!Array.isArray(value)) {
    if (!requireValue && value === undefined) return
    invalidConfig()
  }
  if (requireValue && value.length === 0) invalidConfig()
  const allowed = new Set(allowedScopes)
  const seen = new Set<string>()
  for (const scope of value) {
    if (typeof scope !== 'string' || !allowed.has(scope) || seen.has(scope)) invalidConfig()
    seen.add(scope)
  }
}

function assertNoHiddenClientMetadata(client: OAuthClientRecord): void {
  for (const field of [
    'backchannelLogoutUri',
    'backchannelLogoutSessionRequired',
    'jwks',
    'jwksUri',
    'metadata',
    'postLogoutRedirectUris',
    'softwareStatement',
  ]) {
    if (!emptyValue(client[field])) invalidConfig()
  }
}

export function assertSafeStoredOAuthClient(
  client: OAuthClientRecord,
  allowedScopes: readonly string[],
): void {
  if (client.expiresAt !== undefined && client.expiresAt !== null) {
    const expiresAt =
      client.expiresAt instanceof Date
        ? client.expiresAt.getTime()
        : typeof client.expiresAt === 'number'
          ? client.expiresAt
          : Number.NaN
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) invalidConfig()
  }
  const confidentialBasic =
    client.public === false &&
    client.tokenEndpointAuthMethod === 'client_secret_basic' &&
    typeof client.clientSecret === 'string' &&
    client.clientSecret.length > 0 &&
    (client.type === undefined || client.type === 'web')
  const publicNone =
    client.public === true &&
    client.tokenEndpointAuthMethod === 'none' &&
    (client.clientSecret === undefined || client.clientSecret === null) &&
    (client.type === undefined || client.type === 'native' || client.type === 'user-agent-based')
  if (
    typeof client.clientId !== 'string' ||
    client.clientId.length === 0 ||
    client.disabled === true ||
    (!confidentialBasic && !publicNone) ||
    client.requirePKCE !== true ||
    client.skipConsent !== false ||
    client.enableEndSession !== false ||
    client.dpopBoundAccessTokens !== false ||
    (client.subjectType !== undefined && client.subjectType !== 'public') ||
    !exactArray(client.grantTypes, ['authorization_code']) ||
    !exactArray(client.responseTypes, ['code'])
  ) {
    invalidConfig()
  }
  validateScopeSubset(client.scopes, allowedScopes, true)
  validateOAuthRedirectUris(client.redirectUris)
  assertNoHiddenClientMetadata(client)
}

export function assertSafeStoredOAuthResource(
  resource: OAuthResourceRecord,
  allowedScopes: readonly string[],
): void {
  if (
    typeof resource.identifier !== 'string' ||
    typeof resource.name !== 'string' ||
    resource.name.length === 0 ||
    resource.disabled === true ||
    resource.dpopBoundAccessTokensRequired === true ||
    !emptyValue(resource.refreshTokenTtl) ||
    !emptyValue(resource.signingKeyId) ||
    !emptyValue(resource.customClaims) ||
    (resource.signingAlgorithm !== undefined && resource.signingAlgorithm !== 'RS256')
  ) {
    invalidConfig()
  }
  validateResourceIdentifier(resource.identifier)
  if (resource.accessTokenTtl !== undefined) {
    if (
      !Number.isSafeInteger(resource.accessTokenTtl) ||
      (resource.accessTokenTtl as number) <= 0 ||
      (resource.accessTokenTtl as number) > 600
    ) {
      invalidConfig()
    }
  }
  validateScopeSubset(resource.allowedScopes, allowedScopes, false)
}

export function assertSafeStoredOAuthClientResource(
  link: OAuthClientResourceRecord,
  clientId: string,
  resourceId: string,
): void {
  if (
    link.id !== `${clientId}::${resourceId}` ||
    link.clientId !== clientId ||
    link.resourceId !== resourceId ||
    !emptyValue(link.metadata)
  ) {
    invalidConfig()
  }
}

export function assertSingleParameters(
  parameters: URLSearchParams,
  singletonFields: readonly string[],
): void {
  for (const field of singletonFields) {
    if (parameters.getAll(field).length > 1) invalidRequest()
  }
}

export function requireSingleParameter(parameters: URLSearchParams, field: string): string {
  const values = parameters.getAll(field)
  if (values.length !== 1 || values[0] === '') invalidRequest()
  return values[0]!
}

export async function parseBoundedFormRequest(
  request: Request,
  allowedFields: readonly string[],
  maxBytes = 16 * 1024,
): Promise<URLSearchParams> {
  const parameters = await parseBoundedFormBody(request, maxBytes)
  const allowed = new Set(allowedFields)
  for (const field of parameters.keys()) {
    if (!allowed.has(field)) invalidRequest()
  }
  assertSingleParameters(parameters, allowedFields)
  return parameters
}

export async function parseBoundedFormBody(
  request: Request,
  maxBytes: number,
): Promise<URLSearchParams> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/x-www-form-urlencoded') invalidRequest()
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const bytes = Number(contentLength)
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes) invalidRequest()
  }
  const body = await readStreamWithByteLimit(
    request.clone().body,
    maxBytes,
    () => new OAuthSecurityError(OAUTH_REQUEST_ERROR),
    request.signal,
  )
  return new URLSearchParams(new TextDecoder().decode(body ?? new Uint8Array()))
}

function metadataUrl(value: unknown, expected: string): void {
  if (value !== expected) invalidConfig()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    invalidConfig()
  }
  if (url.href !== expected) invalidConfig()
}

export function projectOAuthAuthorizationServerMetadata(
  officialMetadata: unknown,
  issuer: string,
  scopes: readonly string[],
): Readonly<Record<string, unknown>> {
  if (!isRecord(officialMetadata)) invalidConfig()
  const expected = {
    authorization_endpoint: `${issuer}/oauth2/authorize`,
    issuer,
    jwks_uri: `${issuer}/jwks`,
    revocation_endpoint: `${issuer}/oauth2/revoke`,
    token_endpoint: `${issuer}/oauth2/token`,
  } as const
  for (const [field, value] of Object.entries(expected)) metadataUrl(officialMetadata[field], value)

  const expectedOrigin = new URL(issuer).origin
  for (const [field, value] of Object.entries(officialMetadata)) {
    if ((field.endsWith('_endpoint') || field.endsWith('_uri')) && typeof value === 'string') {
      let url: URL
      try {
        url = new URL(value)
      } catch {
        invalidConfig()
      }
      if (url.origin !== expectedOrigin) invalidConfig()
    }
  }

  if (
    !exactArray(officialMetadata.scopes_supported, scopes) ||
    !Array.isArray(officialMetadata.response_types_supported) ||
    !officialMetadata.response_types_supported.includes('code') ||
    !Array.isArray(officialMetadata.grant_types_supported) ||
    !officialMetadata.grant_types_supported.includes('authorization_code') ||
    !Array.isArray(officialMetadata.token_endpoint_auth_methods_supported) ||
    !officialMetadata.token_endpoint_auth_methods_supported.includes('client_secret_basic') ||
    !Array.isArray(officialMetadata.code_challenge_methods_supported) ||
    !officialMetadata.code_challenge_methods_supported.includes('S256') ||
    officialMetadata.authorization_response_iss_parameter_supported !== true
  ) {
    invalidConfig()
  }

  return Object.freeze({
    issuer: expected.issuer,
    authorization_endpoint: expected.authorization_endpoint,
    token_endpoint: expected.token_endpoint,
    jwks_uri: expected.jwks_uri,
    revocation_endpoint: expected.revocation_endpoint,
    scopes_supported: [...scopes],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  })
}

function requiredString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field]
  if (typeof value !== 'string' || value.length === 0) invalidToken()
  return value
}

function requiredNumericDate(payload: Record<string, unknown>, field: string): number {
  const value = payload[field]
  if (!Number.isSafeInteger(value) || (value as number) <= 0) invalidToken()
  return value as number
}

export function assertOAuthAccessTokenClaims(
  payload: unknown,
  expectations: OAuthAccessTokenExpectations,
): OAuthPrincipal {
  return assertOAuthAccessTokenClaimsAt(
    payload,
    expectations,
    Math.floor(new Date().getTime() / 1000),
  )
}

function assertOAuthAccessTokenClaimsAt(
  payload: unknown,
  expectations: OAuthAccessTokenExpectations,
  now: number,
): OAuthPrincipal {
  if (!isRecord(payload)) invalidToken()
  for (const claim of Object.keys(payload)) {
    if (!TOKEN_CLAIMS.has(claim)) invalidToken()
  }
  const maxLifetime = expectations.maxLifetimeSeconds ?? 600
  if (!Number.isSafeInteger(maxLifetime) || maxLifetime <= 0 || maxLifetime > 600) invalidToken()
  const issuer = requiredString(payload, 'iss')
  const subject = requiredString(payload, 'sub')
  const audience = requiredString(payload, 'aud')
  const clientId = requiredString(payload, 'client_id')
  const authorizedParty = requiredString(payload, 'azp')
  const sessionId = requiredString(payload, 'sid')
  requiredString(payload, 'jti')
  const issuedAt = requiredNumericDate(payload, 'iat')
  const expiresAt = requiredNumericDate(payload, 'exp')
  if (
    issuer !== expectations.issuer ||
    audience !== expectations.audience ||
    clientId !== authorizedParty ||
    payload.token_use !== 'oauth-access' ||
    issuedAt > now ||
    expiresAt <= now ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > maxLifetime ||
    (expectations.clientId !== undefined && clientId !== expectations.clientId) ||
    (expectations.subject !== undefined && subject !== expectations.subject)
  ) {
    invalidToken()
  }

  const rawScope = requiredString(payload, 'scope')
  const scopes = rawScope.split(' ')
  if (scopes.some((scope) => scope.length === 0) || new Set(scopes).size !== scopes.length) {
    invalidToken()
  }
  const allowed = new Set(expectations.allowedScopes)
  if (scopes.some((scope) => !allowed.has(scope))) invalidToken()
  for (const required of expectations.requiredScopes ?? []) {
    if (!allowed.has(required) || !scopes.includes(required)) invalidToken()
  }

  return Object.freeze({ clientId, expiresAt, scopes, sessionId, subject })
}

export function prepareOAuthAccessTokenVerification(expectations: OAuthAccessTokenExpectations) {
  const currentDate = new Date()
  const now = Math.floor(currentDate.getTime() / 1000)
  return Object.freeze({
    currentDate,
    assert(payload: unknown): OAuthPrincipal {
      return assertOAuthAccessTokenClaimsAt(payload, expectations, now)
    },
  })
}
