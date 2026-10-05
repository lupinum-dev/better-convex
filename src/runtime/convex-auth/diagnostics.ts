/**
 * Server-side diagnostics for opaque auth configuration failures.
 *
 * Public responses and thrown errors stay `AUTH_CONFIG_INVALID`. The deployment
 * log receives one stable sub-code and a sanitized cause so an operator can see
 * which stage failed without the log carrying secrets, tokens, or cookies.
 */

export const AUTH_CONFIG_INVALID = 'AUTH_CONFIG_INVALID'

export type AuthConfigSubCode =
  | 'AUTH_CONFIG_SITE_URL_INVALID'
  | 'AUTH_CONFIG_CONVEX_SITE_URL_INVALID'
  | 'AUTH_CONFIG_SECRETS_INVALID'
  | 'AUTH_CONFIG_OPTIONS_INVALID'
  | 'AUTH_CONFIG_OAUTH_PROFILE_FAILED'
  | 'AUTH_CONFIG_CONSTRUCTION_FAILED'
  | 'AUTH_CONFIG_ROUTE_SITE_URL_INVALID'
  | 'AUTH_CONFIG_SITE_ORIGINS_INVALID'
  | 'AUTH_CONFIG_SITE_ORIGIN_NOT_ALLOWED'
  | 'AUTH_CONFIG_ROUTE_CONSTRUCTION_FAILED'

export type AuthFailureCode = typeof AUTH_CONFIG_INVALID | 'AUTH_HANDLER_FAILED'

/** Static error for a rejected application `email` hook. */
export const AUTH_EMAIL_DELIVERY_FAILED = 'AUTH_EMAIL_DELIVERY_FAILED'

const MAX_CAUSE_LENGTH = 200
const OWNED_CODE = /^[A-Z][A-Z\d_]*(?::[\w.-]{1,64})?$/u
// Anything long and token-shaped (JWTs, base64/hex secrets, session tokens).
const TOKEN_LIKE = /[\w+/=.~-]{24,}/gu
const URL_CREDENTIALS = /\/\/[^/\s:@]+:[^/\s@]+@/gu
const SENSITIVE_ASSIGNMENT =
  /\b(secret|token|cookie|password|authorization|bearer|key)(?:\s*[:=]\s*|\s+)\S+/giu

// Plain `Error('AUTH_CONFIG_INVALID')` instances, remembered without a visible
// property so the public error serializes exactly like any opaque failure.
const ownedConfigErrors = new WeakMap<object, AuthConfigSubCode>()

function createAuthConfigError(subCode: AuthConfigSubCode): Error {
  const error = new Error(AUTH_CONFIG_INVALID)
  ownedConfigErrors.set(error, subCode)
  return error
}

/** True for an opaque configuration error whose stage was already logged. */
export function isLoggedAuthConfigError(error: unknown): error is Error {
  return typeof error === 'object' && error !== null && ownedConfigErrors.has(error)
}

/** Reduce an arbitrary cause to a short, secret-free description. */
export function sanitizeAuthCause(error: unknown): string {
  const owned = typeof error === 'object' && error !== null && ownedConfigErrors.get(error)
  if (owned) return owned
  const name =
    error instanceof Error && typeof error.name === 'string' && /^\w{1,64}$/u.test(error.name)
      ? error.name
      : typeof error
  const message = error instanceof Error ? error.message : undefined
  if (typeof message !== 'string' || message.length === 0) return name
  if (OWNED_CODE.test(message)) return `${name}: ${message}`
  const redacted = message
    .replace(URL_CREDENTIALS, '//[redacted]@')
    .replace(SENSITIVE_ASSIGNMENT, '$1 [redacted]')
    .replace(TOKEN_LIKE, '[redacted]')
    .replace(/\s+/gu, ' ')
    .trim()
  const bounded =
    redacted.length > MAX_CAUSE_LENGTH ? `${redacted.slice(0, MAX_CAUSE_LENGTH)}…` : redacted
  return `${name}: ${bounded}`
}

/** Log one stable sub-code with a sanitized cause. Never logs request data. */
export function logAuthFailure(
  code: AuthFailureCode,
  subCode: AuthConfigSubCode | 'AUTH_HANDLER_THREW',
  cause?: unknown,
): void {
  console.error(`[better-convex] ${code}`, {
    subCode,
    ...(cause === undefined ? {} : { cause: sanitizeAuthCause(cause) }),
  })
}

/** Log a sub-code and return the opaque public error for the caller to throw. */
export function authConfigFailure(subCode: AuthConfigSubCode, cause?: unknown): Error {
  if (isLoggedAuthConfigError(cause)) return cause
  logAuthFailure(AUTH_CONFIG_INVALID, subCode, cause)
  return createAuthConfigError(subCode)
}

/**
 * Log a rejected `email` hook with its message type and a sanitized cause.
 * Every known credential of the message is removed from the cause first, so an
 * application error that echoes its arguments cannot leak it (short OTPs are
 * not token-shaped and would otherwise survive generic redaction).
 */
export function logAuthEmailFailure(
  type: string,
  cause: unknown,
  credentials: readonly string[],
): void {
  let redacted = cause
  if (cause instanceof Error && typeof cause.message === 'string') {
    let message = cause.message
    for (const credential of credentials) {
      if (credential.length > 0) message = message.split(credential).join('[redacted]')
    }
    redacted = Object.assign(new Error(message), { name: cause.name })
  }
  console.error(`[better-convex] ${AUTH_EMAIL_DELIVERY_FAILED}`, {
    type,
    cause: sanitizeAuthCause(redacted),
  })
}
