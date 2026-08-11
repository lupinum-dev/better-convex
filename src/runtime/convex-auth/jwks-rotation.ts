import type { Jwk, JwtOptions } from 'better-auth/plugins'
import { createJwk } from 'better-auth/plugins'
import { v } from 'convex/values'

export const JWKS_MAX_TOKEN_LIFETIME_SECONDS = 15 * 60
export const JWKS_CACHE_LIFETIME_SECONDS = 5 * 60
export const JWKS_CLOCK_SKEW_SECONDS = 60
export const JWKS_GRACE_PERIOD_SECONDS =
  JWKS_MAX_TOKEN_LIFETIME_SECONDS + JWKS_CACHE_LIFETIME_SECONDS + JWKS_CLOCK_SKEW_SECONDS
export const JWKS_CACHE_CONTROL = `public, max-age=${JWKS_CACHE_LIFETIME_SECONDS}, must-revalidate`

const MAX_KEY_ID_LENGTH = 256
const MAX_PUBLIC_JWK_LENGTH = 16 * 1024
const MAX_ENCRYPTED_PRIVATE_JWK_LENGTH = 64 * 1024
const PRIVATE_JWK_MEMBERS = new Set(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'])
const PUBLIC_RSA_JWK_MEMBERS = new Set(['e', 'kty', 'n'])
const VERSIONED_CIPHERTEXT_PATTERN = /^\$ba\$(?:0|[1-9]\d*)\$(?:[0-9a-f]{2})+$/u

export const signingKeyCandidateValidator = v.object({
  alg: v.literal('RS256'),
  crv: v.null(),
  id: v.string(),
  privateKey: v.string(),
  publicKey: v.string(),
})

export interface SigningKeyCandidate {
  alg: 'RS256'
  crv: null
  id: string
  privateKey: string
  publicKey: string
}

export interface SigningKeyRotationMetadata {
  createdAt: number
  newKid: string
  previousKids: string[]
  previousVerifyUntil: number
  rotatedAt: number
}

type BetterAuthEndpointContext = Parameters<typeof createJwk>[0]['context']
type CreateJwkAdapter = NonNullable<NonNullable<JwtOptions['adapter']>['createJwk']>

function assertBoundedString(value: string, maximum: number, code: string): void {
  if (value.length === 0 || value.length > maximum) throw new Error(code)
}

function parseJson(value: string, maximum: number, code: string): unknown {
  assertBoundedString(value, maximum, code)
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new Error(code)
  }
}

function assertNoPrivateJwkMembers(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoPrivateJwkMembers(entry)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [name, entry] of Object.entries(value)) {
    if (PRIVATE_JWK_MEMBERS.has(name)) throw new Error('AUTH_JWKS_PUBLIC_KEY_INVALID')
    assertNoPrivateJwkMembers(entry)
  }
}

/**
 * Validate and canonicalize the one public key shape emitted by the pinned
 * Better Auth RS256 generator. A tuple update must review this projection.
 */
export function canonicalizePublicRsaJwk(value: string): string {
  const parsed = parseJson(value, MAX_PUBLIC_JWK_LENGTH, 'AUTH_JWKS_PUBLIC_KEY_INVALID')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AUTH_JWKS_PUBLIC_KEY_INVALID')
  }
  assertNoPrivateJwkMembers(parsed)
  const key = parsed as Record<string, unknown>
  if (
    Object.keys(key).some((name) => !PUBLIC_RSA_JWK_MEMBERS.has(name)) ||
    key.kty !== 'RSA' ||
    typeof key.n !== 'string' ||
    key.n.length === 0 ||
    typeof key.e !== 'string' ||
    key.e.length === 0
  ) {
    throw new Error('AUTH_JWKS_PUBLIC_KEY_INVALID')
  }
  return JSON.stringify({ kty: 'RSA', n: key.n, e: key.e })
}

function assertVersionedEncryptedPrivateJwk(value: string): void {
  const parsed = parseJson(
    value,
    MAX_ENCRYPTED_PRIVATE_JWK_LENGTH,
    'AUTH_JWKS_PRIVATE_KEY_NOT_ENCRYPTED',
  )
  if (typeof parsed !== 'string' || !VERSIONED_CIPHERTEXT_PATTERN.test(parsed)) {
    throw new Error('AUTH_JWKS_PRIVATE_KEY_NOT_ENCRYPTED')
  }
}

export function normalizeSigningKeyCandidate(candidate: SigningKeyCandidate): SigningKeyCandidate {
  assertBoundedString(candidate.id, MAX_KEY_ID_LENGTH, 'AUTH_JWKS_KEY_ID_INVALID')
  if (/\p{C}/u.test(candidate.id)) throw new Error('AUTH_JWKS_KEY_ID_INVALID')
  if (candidate.alg !== 'RS256' || candidate.crv !== null) {
    throw new Error('AUTH_JWKS_ALGORITHM_INVALID')
  }
  assertVersionedEncryptedPrivateJwk(candidate.privateKey)
  return {
    ...candidate,
    publicKey: canonicalizePublicRsaJwk(candidate.publicKey),
  }
}

/**
 * The JWT plugin reads these rows for both signing and public serialization.
 * Keep the encrypted private field for signing, but replace the public JSON
 * with the exact public projection before Better Auth spreads it into `/jwks`.
 */
export function sanitizeStoredJwk(jwk: Jwk): Jwk {
  return { ...jwk, publicKey: canonicalizePublicRsaJwk(jwk.publicKey) }
}

export function createPublicJwksResponse(rows: Jwk[], method: string, now = Date.now()): Response {
  const live = rows.filter((row) => {
    if (row.expiresAt === null || row.expiresAt === undefined) return true
    if (!(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())) {
      throw new TypeError('AUTH_JWKS_EXPIRY_INVALID')
    }
    return row.expiresAt.getTime() + JWKS_GRACE_PERIOD_SECONDS * 1_000 > now
  })
  if (live.length === 0) {
    return new Response(
      method === 'HEAD'
        ? null
        : JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: 'Signing keys are not ready' }),
      {
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Type': 'application/json',
        },
        status: 503,
      },
    )
  }

  const keys = live.map((stored) => {
    const row = sanitizeStoredJwk(stored)
    assertBoundedString(row.id, MAX_KEY_ID_LENGTH, 'AUTH_JWKS_PUBLIC_KEY_INVALID')
    if (
      /\p{C}/u.test(row.id) ||
      row.alg !== 'RS256' ||
      (row.crv !== null && row.crv !== undefined)
    ) {
      throw new Error('AUTH_JWKS_PUBLIC_KEY_INVALID')
    }
    return {
      alg: 'RS256' as const,
      ...(JSON.parse(row.publicKey) as Record<string, unknown>),
      kid: row.id,
    }
  })
  const headers = {
    'Cache-Control': JWKS_CACHE_CONTROL,
    'Content-Type': 'application/json',
  }
  return method === 'HEAD'
    ? new Response(null, { headers, status: 200 })
    : Response.json({ keys }, { headers })
}

export const rejectImplicitSigningKeyCreation: CreateJwkAdapter = async () => {
  throw new Error('AUTH_JWKS_OPERATOR_SETUP_REQUIRED')
}

export function assertSupportedJwksOptions(options: JwtOptions | undefined, code: string): void {
  if (
    !options ||
    options.disableSettingJwtHeader !== true ||
    options.jwks?.disablePrivateKeyEncryption !== false ||
    options.jwks.gracePeriod !== JWKS_GRACE_PERIOD_SECONDS ||
    options.jwks.keyPairConfig?.alg !== 'RS256' ||
    options.jwks.rotationInterval !== undefined ||
    options.jwks.remoteUrl !== undefined ||
    (options.jwks.jwksPath !== undefined && options.jwks.jwksPath !== '/jwks') ||
    (options.jwks.keyPairConfigs !== undefined && options.jwks.keyPairConfigs.length !== 0) ||
    (options.adapter?.createJwk !== undefined &&
      options.adapter.createJwk !== rejectImplicitSigningKeyCreation)
  ) {
    throw new Error(code)
  }
}

/**
 * Generate and encrypt a key through Better Auth, then let one Convex mutation
 * own insertion and retirement. The generated action timestamp and any
 * rotationInterval expiry are deliberately not forwarded to the mutation.
 */
export async function rotateSigningKeyWithOfficialJwt(
  context: BetterAuthEndpointContext,
  options: JwtOptions,
  commit: (candidate: SigningKeyCandidate) => Promise<SigningKeyRotationMetadata>,
): Promise<SigningKeyRotationMetadata> {
  assertSupportedJwksOptions(options, 'AUTH_JWKS_CONFIG_INVALID')
  let committed: SigningKeyRotationMetadata | undefined

  await createJwk({ context } as Parameters<typeof createJwk>[0], {
    ...options,
    adapter: {
      ...options.adapter,
      createJwk: async (generated, endpointContext) => {
        if (generated.alg !== 'RS256' || generated.crv !== undefined) {
          throw new Error('AUTH_JWKS_ALGORITHM_INVALID')
        }
        const id = endpointContext.context.generateId({ model: 'jwks' })
        if (typeof id !== 'string' || id.length === 0) {
          throw new Error('AUTH_JWKS_KEY_ID_INVALID')
        }
        const candidate = normalizeSigningKeyCandidate({
          alg: generated.alg,
          crv: null,
          id,
          privateKey: generated.privateKey,
          publicKey: generated.publicKey,
        })
        committed = await commit(candidate)
        return {
          ...generated,
          alg: 'RS256',
          createdAt: new Date(committed.createdAt),
          crv: undefined,
          expiresAt: undefined,
          id,
          publicKey: candidate.publicKey,
        }
      },
    },
  })

  if (!committed) throw new Error('AUTH_JWKS_ROTATION_NOT_COMMITTED')
  return committed
}
