/**
 * Discovery, the key set and token requests for the one OIDC issuer.
 *
 * The caches are per isolate and best effort. They fill only where `fetch` is
 * allowed (actions and HTTP actions); nothing here touches the network until a
 * method is called.
 */
import {
  applyDefaultAccessTokenExpiry,
  authorizationCodeRequest,
  getOAuth2Tokens,
  refreshAccessTokenRequest,
  type OAuth2Tokens,
} from 'better-auth/oauth2'
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type JSONWebKeySet,
  type JWK,
  type JWTHeaderParameters,
  type JWTPayload,
} from 'jose'

import { logOidcFailure } from './diagnostics'
import { OIDC_MAX_RESPONSE_BYTES, OidcError, idpFetch } from './oidc-fetch'
import { isAllowedIdpUrl, type ResolvedOidcConfig } from './oidc-options'

export const OIDC_ID_TOKEN_MAX_AGE_SECONDS = 600

const OIDC_ALLOWED_ALGORITHMS: readonly string[] = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
]
const OIDC_MAX_JWT_BYTES = 16_384
const OIDC_DISCOVERY_TTL_MS = 3_600_000
const OIDC_JWKS_TTL_MS = 600_000
const OIDC_JWKS_REFETCH_COOLDOWN_MS = 30_000
const OIDC_FAILURE_BACKOFF_MS = 10_000
const OIDC_CLOCK_TOLERANCE_SECONDS = 60
const OIDC_DEFAULT_ACCESS_TOKEN_SECONDS = 300
const MAX_JWKS_KEYS = 100
const SIGNING_KEY_TYPES = new Set(['RSA', 'EC', 'OKP'])
const LOGOUT_TYPES = new Set(['', 'jwt', 'logout+jwt'])

export interface OidcMetadata {
  readonly issuer: string
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly jwksUri: string
  readonly endSessionEndpoint: string | null
  /** OIDC_ALLOWED_ALGORITHMS ∩ advertised, in our order. Mutable only because jose's option type is. */
  readonly algorithms: string[]
  readonly tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post'
}

export type OidcJwtCheck = {
  readonly requiredClaims: readonly string[]
  readonly maxTokenAgeSeconds: number
  readonly typ: 'id_token' | 'logout_token'
}
export type OidcJwtFailure =
  | 'too_large'
  | 'malformed'
  | 'typ'
  | 'algorithm'
  | 'signature'
  | 'issuer'
  | 'audience'
  | 'expired'
  | 'too_old'
  | 'not_yet_valid'
  | 'claim_missing'
  | 'azp'
  | 'keys_unavailable'
export type OidcJwtResult =
  | { readonly ok: true; readonly payload: JWTPayload; readonly header: JWTHeaderParameters }
  | { readonly ok: false; readonly reason: OidcJwtFailure }

export type OidcGrant =
  | {
      readonly type: 'authorization_code'
      readonly code: string
      readonly codeVerifier: string
      readonly redirectURI: string
    }
  | { readonly type: 'refresh_token'; readonly refreshToken: string }
export type OidcTokenResult =
  | { readonly ok: true; readonly tokens: OAuth2Tokens }
  | { readonly ok: false; readonly status: number; readonly error: string | null }

export interface OidcClient {
  readonly config: ResolvedOidcConfig
  metadata(deadline: number): Promise<OidcMetadata>
  verifyJwt(token: string, check: OidcJwtCheck, deadline: number): Promise<OidcJwtResult>
  requestTokens(grant: OidcGrant, deadline: number): Promise<OidcTokenResult>
  /** `<issuer tag>:<sub>`; the account key of this issuer's subject. */
  accountKey(sub: string): Promise<string>
}

interface DiscoveryEntry {
  readonly promise: Promise<OidcMetadata>
  /** `Infinity` while the fetch runs. */
  expiresAt: number
}

interface KeySet {
  readonly resolver: ReturnType<typeof createLocalJWKSet>
  readonly fetchedAt: number
}

interface IssuerState {
  failure: { readonly until: number; readonly error: OidcError } | null
  keys: KeySet | null
  keysLoading: Promise<KeySet> | null
}

const discoveryCache = new Map<string, DiscoveryEntry>()
const issuerStates = new Map<string, IssuerState>()
const clients = new Map<string, OidcClient>()

function issuerState(issuer: string): IssuerState {
  let state = issuerStates.get(issuer)
  if (!state) {
    state = { failure: null, keys: null, keysLoading: null }
    issuerStates.set(issuer, state)
  }
  return state
}

// One attempt per isolate per backoff window while the IdP fails.
function throwDuringBackoff(state: IssuerState): void {
  const failure = state.failure
  if (failure && Date.now() < failure.until) throw failure.error
}

function recordFailure(state: IssuerState, error: OidcError): OidcError {
  state.failure = { until: Date.now() + OIDC_FAILURE_BACKOFF_MS, error }
  return error
}

function transportDetail(error: unknown): string {
  return error instanceof OidcError && error.detail !== undefined ? error.detail : 'network'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(field: string): OidcError {
  return new OidcError('AUTH_OIDC_DISCOVERY_INVALID', field)
}

function optionalStringArray(value: unknown, field: string): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw invalid(field)
  }
  return value
}

function logIssuerMismatch(expected: string, received: unknown): void {
  logOidcFailure('AUTH_OIDC_ISSUER_MISMATCH', {
    expected,
    received: typeof received === 'string' ? received : typeof received,
  })
}

function parseDiscovery(config: ResolvedOidcConfig, document: Record<string, unknown>) {
  if (document.issuer !== config.issuer) logIssuerMismatch(config.issuer, document.issuer)
  if (document.issuer !== config.issuer) throw new OidcError('AUTH_OIDC_ISSUER_MISMATCH')
  const endpoint = (field: string): string => {
    const value = document[field]
    if (typeof value !== 'string' || !isAllowedIdpUrl(value, config.loopbackHttp)) {
      throw invalid(field)
    }
    return value
  }
  const authorizationEndpoint = endpoint('authorization_endpoint')
  const tokenEndpoint = endpoint('token_endpoint')
  const jwksUri = endpoint('jwks_uri')
  const endSessionEndpoint =
    document.end_session_endpoint === undefined ? null : endpoint('end_session_endpoint')
  const responseTypes = optionalStringArray(document.response_types_supported, 'response_types')
  if (responseTypes !== undefined && !responseTypes.includes('code')) {
    throw invalid('response_types')
  }
  const pkceMethods = optionalStringArray(document.code_challenge_methods_supported, 'pkce')
  if (pkceMethods !== undefined && !pkceMethods.includes('S256')) throw invalid('pkce')
  const advertised = optionalStringArray(
    document.id_token_signing_alg_values_supported,
    'algorithms',
  )
  if (advertised === undefined) throw invalid('algorithms')
  const algorithms = OIDC_ALLOWED_ALGORITHMS.filter((alg) => advertised.includes(alg))
  if (algorithms.length === 0) throw invalid('algorithms')
  const authMethods = optionalStringArray(
    document.token_endpoint_auth_methods_supported,
    'token_auth',
  )
  let tokenEndpointAuthMethod: OidcMetadata['tokenEndpointAuthMethod']
  if (authMethods === undefined || authMethods.includes('client_secret_basic')) {
    tokenEndpointAuthMethod = 'client_secret_basic'
  } else if (authMethods.includes('client_secret_post')) {
    tokenEndpointAuthMethod = 'client_secret_post'
  } else {
    throw invalid('token_auth')
  }
  return Object.freeze({
    issuer: config.issuer,
    authorizationEndpoint,
    tokenEndpoint,
    jwksUri,
    endSessionEndpoint,
    algorithms,
    tokenEndpointAuthMethod,
  })
}

function discoveryUrl(issuer: string): string {
  return issuer.endsWith('/')
    ? `${issuer}.well-known/openid-configuration`
    : `${issuer}/.well-known/openid-configuration`
}

async function fetchDiscovery(config: ResolvedOidcConfig, deadline: number) {
  let response: Awaited<ReturnType<typeof idpFetch>>
  try {
    response = await idpFetch(
      discoveryUrl(config.issuer),
      { method: 'GET' },
      { deadline, maxBytes: OIDC_MAX_RESPONSE_BYTES },
    )
  } catch (error) {
    throw new OidcError('AUTH_OIDC_DISCOVERY_FAILED', transportDetail(error))
  }
  if (response.status !== 200) {
    throw new OidcError('AUTH_OIDC_DISCOVERY_FAILED', String(response.status))
  }
  if (response.json === null) throw new OidcError('AUTH_OIDC_DISCOVERY_FAILED', 'body')
  return parseDiscovery(config, response.json)
}

async function loadMetadata(config: ResolvedOidcConfig, deadline: number): Promise<OidcMetadata> {
  const cached = discoveryCache.get(config.issuer)
  if (cached && Date.now() < cached.expiresAt) return cached.promise
  const state = issuerState(config.issuer)
  throwDuringBackoff(state)
  const entry: DiscoveryEntry = {
    promise: fetchDiscovery(config, deadline).then(
      (metadata) => {
        entry.expiresAt = Date.now() + OIDC_DISCOVERY_TTL_MS
        state.failure = null
        return metadata
      },
      (error: unknown) => {
        if (discoveryCache.get(config.issuer) === entry) discoveryCache.delete(config.issuer)
        const failure =
          error instanceof OidcError
            ? error
            : new OidcError('AUTH_OIDC_DISCOVERY_FAILED', 'internal')
        throw recordFailure(state, failure)
      },
    ),
    expiresAt: Number.POSITIVE_INFINITY,
  }
  discoveryCache.set(config.issuer, entry)
  return entry.promise
}

function signingKeys(body: Record<string, unknown> | null): JSONWebKeySet {
  if (body === null || !Array.isArray(body.keys) || body.keys.length > MAX_JWKS_KEYS) {
    throw new OidcError('AUTH_OIDC_JWKS_FAILED', 'body')
  }
  const keys: JWK[] = body.keys.filter(
    (key): key is JWK =>
      isRecord(key) &&
      typeof key.kty === 'string' &&
      SIGNING_KEY_TYPES.has(key.kty) &&
      (key.use === undefined || key.use === 'sig'),
  )
  if (keys.length === 0) throw new OidcError('AUTH_OIDC_JWKS_FAILED', 'empty')
  return { keys }
}

async function fetchKeys(metadata: OidcMetadata, deadline: number): Promise<KeySet> {
  let response: Awaited<ReturnType<typeof idpFetch>>
  try {
    response = await idpFetch(
      metadata.jwksUri,
      { method: 'GET' },
      { deadline, maxBytes: OIDC_MAX_RESPONSE_BYTES },
    )
  } catch (error) {
    throw new OidcError('AUTH_OIDC_JWKS_FAILED', transportDetail(error))
  }
  if (response.status !== 200) {
    throw new OidcError('AUTH_OIDC_JWKS_FAILED', String(response.status))
  }
  return { resolver: createLocalJWKSet(signingKeys(response.json)), fetchedAt: Date.now() }
}

// Single-flight JWKS load; a failure starts the backoff.
function loadKeys(state: IssuerState, metadata: OidcMetadata, deadline: number): Promise<KeySet> {
  throwDuringBackoff(state)
  if (state.keysLoading) return state.keysLoading
  const loading = fetchKeys(metadata, deadline).then(
    (keys) => {
      state.keys = keys
      state.failure = null
      return keys
    },
    (error: unknown) => {
      const failure =
        error instanceof OidcError ? error : new OidcError('AUTH_OIDC_JWKS_FAILED', 'internal')
      throw recordFailure(state, failure)
    },
  )
  state.keysLoading = loading
  const clear = () => {
    if (state.keysLoading === loading) state.keysLoading = null
  }
  loading.then(clear, clear)
  return loading
}

function currentKeys(
  state: IssuerState,
  metadata: OidcMetadata,
  deadline: number,
): Promise<KeySet> {
  const keys = state.keys
  if (keys && Date.now() - keys.fetchedAt < OIDC_JWKS_TTL_MS) return Promise.resolve(keys)
  return loadKeys(state, metadata, deadline)
}

// A token with an unknown `kid` may follow a key rotation. One refetch per
// cooldown bounds the IdP load from forged `kid` values.
async function refetchKeys(
  state: IssuerState,
  keys: KeySet,
  metadata: OidcMetadata,
  deadline: number,
): Promise<KeySet | null> {
  const now = Date.now()
  if (now - keys.fetchedAt < OIDC_JWKS_REFETCH_COOLDOWN_MS) return null
  try {
    return await loadKeys(state, metadata, deadline)
  } catch {
    return null
  }
}

const NO_MATCHING_KEY = Symbol('no matching key')

function claimFailure(error: errors.JWTClaimValidationFailed): OidcJwtFailure {
  if (error.reason === 'missing') return 'claim_missing'
  // A claim of the wrong type is a malformed token, not a failed time or value check.
  if (error.reason !== 'check_failed') return 'malformed'
  if (error.claim === 'iss') return 'issuer'
  if (error.claim === 'aud') return 'audience'
  if (error.claim === 'iat' || error.claim === 'nbf') return 'not_yet_valid'
  return 'malformed'
}

function joseFailure(error: unknown): OidcJwtFailure | typeof NO_MATCHING_KEY {
  if (error instanceof errors.JWKSMultipleMatchingKeys) return 'signature'
  if (error instanceof errors.JWKSNoMatchingKey) return NO_MATCHING_KEY
  if (error instanceof errors.JWSSignatureVerificationFailed) return 'signature'
  if (error instanceof errors.JOSEAlgNotAllowed) return 'algorithm'
  if (error instanceof errors.JWTExpired) return error.claim === 'iat' ? 'too_old' : 'expired'
  if (error instanceof errors.JWTClaimValidationFailed) return claimFailure(error)
  return 'malformed'
}

function headerType(value: unknown): string | null {
  if (value === undefined) return ''
  if (typeof value !== 'string') return null
  return value.toLowerCase().replace(/^application\//u, '')
}

async function verifyJwt(
  client: OidcClient,
  token: string,
  check: OidcJwtCheck,
  deadline: number,
): Promise<OidcJwtResult> {
  if (token.length > OIDC_MAX_JWT_BYTES) return { ok: false, reason: 'too_large' }
  if (token.split('.').length !== 3) return { ok: false, reason: 'malformed' }
  let decoded: ReturnType<typeof decodeProtectedHeader>
  try {
    decoded = decodeProtectedHeader(token)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  const typ = headerType(decoded.typ)
  if (typ === null) return { ok: false, reason: 'malformed' }
  if (check.typ === 'id_token' && typ.endsWith('+jwt')) return { ok: false, reason: 'typ' }
  if (check.typ === 'logout_token' && !LOGOUT_TYPES.has(typ)) return { ok: false, reason: 'typ' }
  const header = { alg: typeof decoded.alg === 'string' ? decoded.alg : '' }
  if (!OIDC_ALLOWED_ALGORITHMS.includes(header.alg)) return { ok: false, reason: 'algorithm' }

  const state = issuerState(client.config.issuer)
  let metadata: OidcMetadata
  let keys: KeySet
  try {
    metadata = await client.metadata(deadline)
    keys = await currentKeys(state, metadata, deadline)
  } catch {
    return { ok: false, reason: 'keys_unavailable' }
  }
  const verify = async (resolver: KeySet['resolver']) => {
    try {
      return await jwtVerify(token, resolver, {
        issuer: client.config.issuer,
        audience: client.config.clientId,
        algorithms: metadata.algorithms,
        clockTolerance: OIDC_CLOCK_TOLERANCE_SECONDS,
        maxTokenAge: check.maxTokenAgeSeconds,
        requiredClaims: [...check.requiredClaims],
      })
    } catch (error) {
      return joseFailure(error)
    }
  }
  let result = await verify(keys.resolver)
  if (result === NO_MATCHING_KEY) {
    const refreshed = await refetchKeys(state, keys, metadata, deadline)
    if (!refreshed) return { ok: false, reason: 'keys_unavailable' }
    result = await verify(refreshed.resolver)
    // A fresh key set still has no key for this `kid`: the token is not signed by the IdP.
    if (result === NO_MATCHING_KEY) return { ok: false, reason: 'signature' }
  }
  if (typeof result === 'string') return { ok: false, reason: result }
  const payload = result.payload
  // prettier-ignore
  if (check.typ === 'id_token' && Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp === undefined) return { ok: false, reason: 'azp' }
  // prettier-ignore
  if (check.typ === 'id_token' && payload.azp !== undefined && payload.azp !== client.config.clientId) return { ok: false, reason: 'azp' }
  return { ok: true, payload, header: result.protectedHeader }
}

function acceptedTokens(json: Record<string, unknown> | null): OAuth2Tokens {
  const valid =
    json !== null &&
    typeof json.access_token === 'string' &&
    json.access_token.length > 0 &&
    (json.token_type === undefined ||
      (typeof json.token_type === 'string' && json.token_type.toLowerCase() === 'bearer'))
  if (!valid) throw new OidcError('AUTH_OIDC_TOKEN_REQUEST_FAILED', 'response')
  return applyDefaultAccessTokenExpiry(getOAuth2Tokens(json), OIDC_DEFAULT_ACCESS_TOKEN_SECONDS)
}

async function requestTokens(
  client: OidcClient,
  grant: OidcGrant,
  deadline: number,
): Promise<OidcTokenResult> {
  const state = issuerState(client.config.issuer)
  throwDuringBackoff(state)
  const metadata = await client.metadata(deadline)
  const options = { clientId: client.config.clientId, clientSecret: client.config.clientSecret }
  const tokenEndpointAuth = { method: metadata.tokenEndpointAuthMethod }
  const request =
    grant.type === 'authorization_code'
      ? await authorizationCodeRequest({
          code: grant.code,
          codeVerifier: grant.codeVerifier,
          redirectURI: grant.redirectURI,
          options,
          tokenEndpoint: metadata.tokenEndpoint,
          tokenEndpointAuth,
        })
      : await refreshAccessTokenRequest({
          refreshToken: grant.refreshToken,
          options,
          tokenEndpoint: metadata.tokenEndpoint,
          tokenEndpointAuth,
        })
  let response: Awaited<ReturnType<typeof idpFetch>>
  try {
    response = await idpFetch(
      metadata.tokenEndpoint,
      { method: 'POST', headers: request.headers, body: request.body },
      { deadline, maxBytes: OIDC_MAX_RESPONSE_BYTES },
    )
  } catch (error) {
    throw recordFailure(
      state,
      new OidcError('AUTH_OIDC_TOKEN_REQUEST_FAILED', transportDetail(error)),
    )
  }
  state.failure = null
  if (response.status !== 200) {
    const error = response.json?.error
    return { ok: false, status: response.status, error: typeof error === 'string' ? error : null }
  }
  return { ok: true, tokens: acceptedTokens(response.json) }
}

async function computeIssuerTag(issuer: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(issuer))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '').slice(0, 16)
}

function createOidcClient(config: ResolvedOidcConfig): OidcClient {
  let issuerTag: Promise<string> | undefined
  const client: OidcClient = Object.freeze({
    config,
    metadata: (deadline: number) => loadMetadata(config, deadline),
    verifyJwt: (token: string, check: OidcJwtCheck, deadline: number) =>
      verifyJwt(client, token, check, deadline),
    requestTokens: (grant: OidcGrant, deadline: number) => requestTokens(client, grant, deadline),
    // `sub` is unique only within one issuer (OIDC Core 5.7), so the key binds both.
    accountKey: async (sub: string) => {
      issuerTag ??= computeIssuerTag(config.issuer)
      return `${await issuerTag}:${sub}`
    },
  })
  return client
}

/** One client per issuer, client id and secret per isolate, so the caches survive auth constructions. */
export function getOidcClient(config: ResolvedOidcConfig): OidcClient {
  const key = JSON.stringify([config.issuer, config.clientId, config.clientSecret])
  let client = clients.get(key)
  if (!client) {
    client = createOidcClient(config)
    clients.set(key, client)
  }
  return client
}
