import type { ConvexUser } from './types'

/**
 * Local JWT parsing exists only to derive provisional display state. Convex is
 * still the sole signature/issuer/audience/algorithm verifier. Keep this bound
 * well above normal Better Auth tokens while preventing an upstream response
 * from becoming an unbounded SSR/browser object graph.
 */
const MAX_LOCAL_JWT_LENGTH = 65_536
const MAX_DISPLAY_STRING_LENGTH = 4_096

/** Milliseconds before `exp` at which a locally retained token is unusable. */
export const TOKEN_EXPIRY_SAFETY_BUFFER_MS = 30_000

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function defineSafeProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

function readDisplayString(value: unknown): string | null | undefined {
  if (value === null) return null
  return typeof value === 'string' && value.length <= MAX_DISPLAY_STRING_LENGTH ? value : undefined
}

function copyNormalizedDisplayFields(
  target: Record<string, unknown>,
  input: Record<string, unknown>,
): void {
  for (const key of ['name', 'email', 'image', 'createdAt', 'updatedAt'] as const) {
    const value = readDisplayString(input[key])
    if (value !== undefined) defineSafeProperty(target, key, value)
  }
  if (typeof input.emailVerified === 'boolean') {
    defineSafeProperty(target, 'emailVerified', input.emailVerified)
  }
}

// ============================================================================
// JWT Decoding (Unified Implementation)
// ============================================================================

/**
 * Decode a base64url-encoded string.
 * Works in both browser (atob) and Node.js (Buffer) environments.
 * Handles URL-safe base64 encoding (RFC 4648) with proper UTF-8 support.
 */
function base64UrlDecode(str: string): string {
  // An unpadded base64url value can never have one trailing character. Node's
  // Buffer decoder accepts that input, so reject it before decoding.
  if (str.length % 4 === 1) throw new Error('Invalid base64url length')

  // Convert URL-safe base64 to standard base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')

  // Add padding if needed
  const padding = base64.length % 4
  if (padding > 0) {
    base64 += '='.repeat(4 - padding)
  }

  // Use Buffer in Node.js, atob in the browser, then the same strict UTF-8
  // decoder in both environments. Replacement characters would turn malformed
  // JWT bytes into a different, locally accepted JSON payload.
  let bytes: Uint8Array
  if (typeof Buffer !== 'undefined') {
    bytes = Buffer.from(base64, 'base64')
  } else {
    const binaryString = atob(base64)
    bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
  }

  // Buffer also ignores non-zero padding bits (for example `e31` decodes to
  // the same bytes as canonical `e30`). JWT compact serialization uses the
  // canonical unpadded base64url representation, so round-trip the payload.
  let canonical: string
  if (typeof Buffer !== 'undefined') {
    canonical = Buffer.from(bytes).toString('base64url')
  } else {
    let binaryString = ''
    for (const byte of bytes) binaryString += String.fromCharCode(byte)
    canonical = btoa(binaryString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  if (canonical !== str) throw new Error('Non-canonical base64url encoding')

  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function isBase64UrlSegment(value: string): boolean {
  // Local code decodes only the payload. Convex performs canonical JWS parsing
  // and verification, so the other opaque segments need only be non-empty
  // base64url characters here.
  return value.length > 0 && /^[\w-]+$/.test(value)
}

/**
 * Decode JWT payload without verification.
 * Returns the parsed payload object or null if decoding fails.
 *
 * @param token - The JWT token string
 * @returns The decoded payload object or null
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    if (token.length === 0 || token.length > MAX_LOCAL_JWT_LENGTH) return null
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [header, payload, signature] = parts
    if (
      !header ||
      !payload ||
      !signature ||
      !isBase64UrlSegment(header) ||
      !isBase64UrlSegment(payload) ||
      !isBase64UrlSegment(signature)
    ) {
      return null
    }

    const decoded = base64UrlDecode(payload)
    const parsed: unknown = JSON.parse(decoded)
    return isPlainRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Returns milliseconds until JWT expiry, or null when `exp` is missing/invalid.
 * Negative values mean the token is already expired.
 */
export function getJwtTimeUntilExpiryMs(token: string, nowMs = Date.now()): number | null {
  const payload = decodeJwtPayload(token)
  if (!payload) return null
  const exp = payload.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null
  const expiryMs = exp * 1000
  if (!Number.isFinite(expiryMs)) return null
  return expiryMs - nowMs
}

/**
 * A locally retained token must have a finite `exp` beyond the safety window.
 * This is a lifecycle guard, not JWT verification: Convex still verifies the
 * signature, algorithm, key, issuer, audience, subject, and temporal claims.
 */
export function isJwtUsable(token: string | null, nowMs = Date.now()): token is string {
  if (!token) return false
  const timeUntilExpiry = getJwtTimeUntilExpiryMs(token, nowMs)
  return timeUntilExpiry !== null && timeUntilExpiry > TOKEN_EXPIRY_SAFETY_BUFFER_MS
}

/**
 * Decode user info from JWT payload.
 * Extracts standard user fields from the JWT claims.
 *
 * @param token - The JWT token string
 * @returns The decoded user or null if decoding fails
 */
export function decodeUserFromJwt(token: string): ConvexUser | null {
  const payload = decodeJwtPayload(token)
  if (!payload) return null

  // Better Convex Nuxt always signs the Better Auth logical user id as `sub`, and
  // Convex uses that same subject for backend identity. Never let a display
  // claim choose a different principal or coerce an object/number into an id.
  const subject = payload.sub
  if (
    typeof subject !== 'string' ||
    subject.length === 0 ||
    subject.length > MAX_DISPLAY_STRING_LENGTH
  ) {
    return null
  }

  const user: ConvexUser & Record<string, unknown> = { id: subject }
  copyNormalizedDisplayFields(user, payload)
  return user
}
