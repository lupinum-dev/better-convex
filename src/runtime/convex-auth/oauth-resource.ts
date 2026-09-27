import { verifyJwsAccessToken } from 'better-auth/oauth2'
import { getFunctionAddress, type GenericDataModel } from 'convex/server'

import type { AuthCtx } from './context'
import {
  JWKS_CACHE_LIFETIME_SECONDS,
  JWKS_GRACE_PERIOD_SECONDS,
  canonicalizePublicRsaJwk,
} from './jwks-rotation'
import type { BetterConvexMcpPrincipal } from './mcp-principal'
import { canonicalAuthIssuer } from './mcp-profile'
import { queryOAuthLiveGrant } from './oauth-live-access'
import {
  OAuthSecurityError,
  prepareOAuthAccessTokenVerification,
  type OAuthAccessTokenExpectations,
  type OAuthPrincipal,
} from './oauth-security'
import type { AuthAdapterComponentApi } from './types'

export interface BetterAuthMcpAccessVerifierOptions {
  /** Every scope a token may carry. A token with any other scope is rejected. */
  readonly allowedScopes: readonly string[]
  /** Scopes every token must carry to reach the MCP endpoint at all. */
  readonly requiredScopes?: readonly string[]
  /** Upper bound for `exp - iat`, in seconds (1..600, default 600). */
  readonly maxLifetimeSeconds?: number
  /**
   * The one MCP resource this verifier admits. When set, a verification
   * expectation for any other resource is rejected before token processing.
   */
  readonly resource?: string | URL
}

/** Frozen result of one successful verification. `expiresAt` is epoch seconds. */
export interface VerifiedBetterConvexMcpAccess {
  readonly access: {
    readonly issuer: string
    readonly subject: string
    readonly clientId: string
    readonly resource: string
    readonly scopes: readonly string[]
  }
  readonly principal: BetterConvexMcpPrincipal
  readonly expiresAt: number
}

export interface BetterConvexMcpAccessVerifier {
  verifyAccessToken(
    token: string,
    expected: { readonly issuer: string; readonly resource: URL },
  ): Promise<VerifiedBetterConvexMcpAccess>
}

const COMPACT_JWT_PATTERN = /^[\w-]+\.[\w-]+\.[\w-]+$/u
const MAX_COMPACT_JWT_BYTES = 8192
const MAX_KEY_ID_LENGTH = 256

/** Verification keys read per component query; retired keys are pruned after their grace. */
const MAX_VERIFICATION_KEYS = 16
/** Isolate-level verification key cache: bounded in entries and in age. */
const KEY_CACHE_MAX_ENTRIES = 8
const KEY_CACHE_TTL_MS = JWKS_CACHE_LIFETIME_SECONDS * 1_000

interface VerificationKey {
  readonly kid: string
  readonly jwk: Readonly<Record<string, unknown>>
  /** Retirement time in epoch milliseconds, or `null` for a current key. */
  readonly expiresAt: number | null
}

interface CachedKeys {
  readonly fetchedAt: number
  readonly keys: readonly VerificationKey[]
}

const verificationKeyCache = new Map<string, CachedKeys>()

function invalidToken(): never {
  throw new OAuthSecurityError('AUTH_OAUTH_TOKEN_INVALID')
}

function decodeSegment(token: string, index: 0 | 1): Record<string, unknown> {
  if (token.length > MAX_COMPACT_JWT_BYTES || !COMPACT_JWT_PATTERN.test(token)) invalidToken()
  const encoded = token.split('.')[index]
  if (!encoded || encoded.length % 4 === 1) invalidToken()
  try {
    const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/')
    const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalidToken()
    return value as Record<string, unknown>
  } catch {
    invalidToken()
  }
}

/** The one header profile the library's signer emits: RS256, `at+jwt`, and a key id. */
function tokenKeyId(token: string): string {
  const header = decodeSegment(token, 0)
  if (
    header.alg !== 'RS256' ||
    header.typ !== 'at+jwt' ||
    typeof header.kid !== 'string' ||
    header.kid.length === 0 ||
    header.kid.length > MAX_KEY_ID_LENGTH ||
    Object.hasOwn(header, 'jku') ||
    Object.hasOwn(header, 'jwk') ||
    Object.hasOwn(header, 'x5u') ||
    Object.hasOwn(header, 'x5c') ||
    Object.hasOwn(header, 'crit')
  ) {
    invalidToken()
  }
  return header.kid
}

function isSecureOAuthEndpoint(value: URL): boolean {
  return (
    value.protocol === 'https:' ||
    (value.protocol === 'http:' &&
      (value.hostname === '127.0.0.1' ||
        value.hostname === 'localhost' ||
        value.hostname === '[::1]'))
  )
}

function safeResource(value: unknown): value is URL {
  return (
    value instanceof URL &&
    isSecureOAuthEndpoint(value) &&
    !value.username &&
    !value.password &&
    !value.search &&
    !value.hash
  )
}

/** Public RS256 keys that may verify a token now: current keys, and retired keys within grace. */
function projectVerificationKeys(rows: readonly Record<string, unknown>[]): VerificationKey[] {
  const keys: VerificationKey[] = []
  for (const row of rows) {
    const kid = row.id
    const expiresAt = row.expiresAt
    if (
      typeof kid !== 'string' ||
      kid.length === 0 ||
      kid.length > MAX_KEY_ID_LENGTH ||
      row.alg !== 'RS256' ||
      (row.crv !== null && row.crv !== undefined) ||
      typeof row.publicKey !== 'string' ||
      (expiresAt !== null && (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)))
    ) {
      continue
    }
    let jwk: Record<string, unknown>
    try {
      jwk = JSON.parse(canonicalizePublicRsaJwk(row.publicKey)) as Record<string, unknown>
    } catch {
      continue
    }
    keys.push(Object.freeze({ kid, jwk: Object.freeze(jwk), expiresAt }))
  }
  return keys
}

function usableKeys(keys: readonly VerificationKey[], now: number): VerificationKey[] {
  return keys.filter(
    (key) => key.expiresAt === null || key.expiresAt + JWKS_GRACE_PERIOD_SECONDS * 1_000 > now,
  )
}

function cacheKey(component: AuthAdapterComponentApi): string | undefined {
  try {
    return JSON.stringify(getFunctionAddress(component.adapter.findMany))
  } catch {
    return undefined
  }
}

async function readVerificationKeys<DataModel extends GenericDataModel>(
  ctx: AuthCtx<DataModel>,
  component: AuthAdapterComponentApi,
  kid: string,
): Promise<VerificationKey[]> {
  const now = Date.now()
  const key = cacheKey(component)
  const cached = key === undefined ? undefined : verificationKeyCache.get(key)
  if (cached && now - cached.fetchedAt < KEY_CACHE_TTL_MS && now >= cached.fetchedAt) {
    const keys = usableKeys(cached.keys, now)
    // A key id the cache has not seen may be a newly rotated key: read once more.
    if (keys.some((candidate) => candidate.kid === kid)) return keys
  }

  const page = (await ctx.runQuery(component.adapter.findMany, {
    model: 'jwks',
    select: ['id', 'alg', 'crv', 'expiresAt', 'publicKey'],
    sortBy: { field: 'createdAt', direction: 'desc' },
    paginationOpts: { cursor: null, numItems: MAX_VERIFICATION_KEYS },
  })) as { page?: unknown }
  const rows = Array.isArray(page?.page) ? (page.page as Record<string, unknown>[]) : []
  const keys = projectVerificationKeys(rows)
  if (key !== undefined) {
    verificationKeyCache.delete(key)
    while (verificationKeyCache.size >= KEY_CACHE_MAX_ENTRIES) {
      const oldest = verificationKeyCache.keys().next().value
      if (oldest === undefined) break
      verificationKeyCache.delete(oldest)
    }
    verificationKeyCache.set(key, Object.freeze({ fetchedAt: now, keys: Object.freeze(keys) }))
  }
  return usableKeys(keys, now)
}

/** Test-only: forget cached verification keys. @internal */
export function clearVerificationKeyCache(): void {
  verificationKeyCache.clear()
}

/**
 * Verify a Better Auth OAuth access token against the signing keys read
 * directly from the auth component (no HTTP JWKS round trip), then apply the
 * library's strict token-class and exact-binding checks. Live session,
 * client, consent, and resource authority is a separate check.
 */
export async function verifyOAuthBearerToken<DataModel extends GenericDataModel>(
  ctx: AuthCtx<DataModel>,
  component: AuthAdapterComponentApi,
  token: string | undefined,
  options: OAuthAccessTokenExpectations,
): Promise<OAuthPrincipal> {
  if (typeof token !== 'string') invalidToken()
  // Reject malformed, oversized, or foreign-profile compact values before any
  // key lookup. The decoded payload is not trusted until the signature passes.
  const kid = tokenKeyId(token)
  decodeSegment(token, 1)
  const maxLifetimeSeconds = options.maxLifetimeSeconds ?? 600
  const verification = prepareOAuthAccessTokenVerification(options)
  const keys = (await readVerificationKeys(ctx, component, kid)).filter((key) => key.kid === kid)
  if (keys.length !== 1) invalidToken()
  try {
    await verifyJwsAccessToken(token, {
      jwksFetch: async () => ({
        keys: keys.map((key) => ({ ...key.jwk, alg: 'RS256', kid: key.kid, use: 'sig' })),
      }),
      verifyOptions: {
        algorithms: ['RS256'],
        audience: options.audience,
        clockTolerance: 0,
        currentDate: verification.currentDate,
        issuer: options.issuer,
        maxTokenAge: `${maxLifetimeSeconds}s`,
        typ: 'at+jwt',
      },
    })
  } catch {
    invalidToken()
  }

  // The official verifier normalizes `client_id` from `azp` on its returned
  // payload. Re-read the now signature-verified compact bytes so a conflicting
  // signed client_id (or another raw unknown claim) cannot be hidden.
  return verification.assert(decodeSegment(token, 1))
}

function frozenScopes(values: readonly string[], name: string): readonly string[] {
  if (!Array.isArray(values)) throw new OAuthSecurityError('AUTH_OAUTH_CONFIG_INVALID')
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new OAuthSecurityError(`AUTH_OAUTH_CONFIG_INVALID:${name}`)
    }
  }
  return Object.freeze([...values])
}

/**
 * The Better Auth access verifier for `handleMcpRequest`. For every token it
 * performs signature, issuer, audience (= the MCP resource), algorithm,
 * lifetime, token-class, and scope checks with keys from the component, then
 * one live grant query. The result carries the typed
 * {@link BetterConvexMcpPrincipal}; pass it to internal functions and call
 * `requireMcpPrincipal` there.
 *
 * The expected issuer must be this deployment's Better Auth issuer
 * (`${SITE_URL}/api/auth`); a caller-selected issuer is rejected.
 */
export function createBetterAuthMcpAccessVerifier<DataModel extends GenericDataModel>(
  ctx: AuthCtx<DataModel>,
  component: AuthAdapterComponentApi,
  options: BetterAuthMcpAccessVerifierOptions,
): BetterConvexMcpAccessVerifier {
  if (!ctx || typeof ctx.runQuery !== 'function' || !component?.adapter || !options) {
    throw new OAuthSecurityError('AUTH_OAUTH_CONFIG_INVALID')
  }
  const allowedScopes = frozenScopes(options.allowedScopes, 'allowedScopes')
  if (allowedScopes.length === 0) throw new OAuthSecurityError('AUTH_OAUTH_CONFIG_INVALID')
  const requiredScopes =
    options.requiredScopes === undefined
      ? undefined
      : frozenScopes(options.requiredScopes, 'requiredScopes')
  const maxLifetimeSeconds = options.maxLifetimeSeconds
  let pinnedResource: string | undefined
  if (options.resource !== undefined) {
    let parsed: URL
    try {
      parsed = new URL(options.resource)
    } catch {
      throw new OAuthSecurityError('AUTH_OAUTH_CONFIG_INVALID')
    }
    if (!safeResource(parsed)) throw new OAuthSecurityError('AUTH_OAUTH_CONFIG_INVALID')
    pinnedResource = parsed.href
  }

  return Object.freeze({
    async verifyAccessToken(
      token: string,
      expected: { readonly issuer: string; readonly resource: URL },
    ): Promise<VerifiedBetterConvexMcpAccess> {
      if (!expected || typeof expected.issuer !== 'string' || !safeResource(expected.resource)) {
        invalidToken()
      }
      const resource = expected.resource.href
      let issuer: string
      try {
        issuer = canonicalAuthIssuer()
      } catch {
        invalidToken()
      }
      if (
        expected.issuer !== issuer ||
        (pinnedResource !== undefined && resource !== pinnedResource)
      ) {
        invalidToken()
      }
      const verified = await verifyOAuthBearerToken(ctx, component, token, {
        allowedScopes,
        audience: resource,
        issuer,
        ...(maxLifetimeSeconds === undefined ? {} : { maxLifetimeSeconds }),
        ...(requiredScopes === undefined ? {} : { requiredScopes }),
      })
      const grant = await queryOAuthLiveGrant(ctx, component, {
        clientId: verified.clientId,
        grantId: verified.grantId,
        resource,
        scopes: verified.scopes,
        sessionId: verified.sessionId,
        userId: verified.subject,
      })
      if (!grant) invalidToken()
      const scopes = Object.freeze([...verified.scopes])
      return Object.freeze({
        access: Object.freeze({
          issuer,
          subject: verified.subject,
          clientId: verified.clientId,
          resource,
          scopes,
        }),
        principal: Object.freeze({
          kind: 'oauth' as const,
          userId: verified.subject,
          clientId: verified.clientId,
          scopes: [...verified.scopes],
          sessionId: verified.sessionId,
          grantId: grant.grantId,
          issuer,
          resource,
          expiresAt: verified.expiresAt,
        }),
        expiresAt: verified.expiresAt,
      })
    },
  })
}
