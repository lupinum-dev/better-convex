import type { ConvexAuthMode } from '../../utils/auth-status'

/**
 * A low-level Better Auth cookie credential handed to `serverConvex` for an
 * explicit principal. The value is a raw `Cookie` header string.
 */
export type ConvexCredential = { type: 'cookie'; value: string }

/**
 * Public per-caller options for `serverConvex`.
 *
 * Cookie policy, an explicit Convex token, and an explicit Better Auth cookie
 * credential are three mutually exclusive call modes. An explicit principal
 * always requires authentication, so those branches deliberately do not accept
 * a redundant `auth: 'required'` field.
 */
export type ServerConvexOptions =
  | {
      auth?: ConvexAuthMode
      authToken?: never
      credential?: never
    }
  | {
      auth?: never
      authToken: string
      credential?: never
    }
  | {
      auth?: never
      authToken?: never
      credential: ConvexCredential
    }

/**
 * The validated, resolved options a caller operates on. `auth` is always a
 * concrete mode: cookie-based callers default to a fixed `optional`, while an
 * explicit principal resolves to `required`.
 */
export type NormalizedServerConvexOptions =
  | {
      auth: ConvexAuthMode
      authToken?: never
      credential?: never
    }
  | {
      auth: 'required'
      authToken: string
      credential?: never
    }
  | {
      auth: 'required'
      authToken?: never
      credential: ConvexCredential
    }

/**
 * Synchronous validation failure for server-call options and credential values
 * . This is deliberately NOT a {@link ConvexCallError}: the public
 * error contract  has no `validation` kind, and an option/credential
 * contract violation is a caller programming error surfaced before any network
 * access — not a classifiable Convex call outcome. Callers that construct a
 * `serverConvex` caller receive this synchronously, before a request is ever
 * made.
 */
export class ServerConvexValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerConvexValidationError'
  }
}

/**
 * True when `value` contains any ASCII control character (0x00–0x1F or 0x7F),
 * which includes CR (0x0D) and LF (0x0A). A credential carrying these could be
 * used for header injection / request smuggling, so it is rejected before it can
 * be placed in a request header.
 */
const ASCII_CONTROL_MAX = 31 // 0x1F
const ASCII_DEL = 127 // 0x7F

export function credentialHasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= ASCII_CONTROL_MAX || code === ASCII_DEL) return true
  }
  return false
}

/**
 * Reject an empty or control-character-bearing credential value synchronously,
 * before any network access . Shared by option validation and by the
 * exchange primitive so both refuse a smuggling-capable credential at the door.
 */
export function assertCredentialValueSafe(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ServerConvexValidationError(`${label} must be a non-empty string`)
  }
  if (credentialHasControlChars(value)) {
    throw new ServerConvexValidationError(`${label} must not contain control characters`)
  }
}

export function assertConvexCredentialShape(
  credential: unknown,
): asserts credential is ConvexCredential {
  if (!credential || typeof credential !== 'object') {
    throw new ServerConvexValidationError('credential must be a cookie credential')
  }
  const type = (credential as { type?: unknown }).type
  if (type !== 'cookie') {
    throw new ServerConvexValidationError('credential must be a cookie credential')
  }
}

function assertConvexAuthMode(auth: unknown): asserts auth is ConvexAuthMode | undefined {
  if (auth !== undefined && auth !== 'required' && auth !== 'optional' && auth !== 'none') {
    throw new ServerConvexValidationError("auth must be one of 'required', 'optional', or 'none'")
  }
}

/**
 * Validate and normalize {@link ServerConvexOptions} synchronously (public
 * "Validation rules"). Throws {@link ServerConvexValidationError} — before any
 * network access — for every invalid combination rather than silently
 * downgrading a rejected explicit principal.
 *
 * Rules:
 * - `authToken` and `credential` are mutually exclusive.
 * - Providing either implies `required`; every explicit `auth` field is
 *   rejected as redundant or contradictory.
 * - An empty or control-character token/credential value is rejected.
 * - With no explicit principal, cookie-based resolution defaults to a fixed
 *   `optional`.
 */
export function validateServerConvexOptions(
  options: ServerConvexOptions = {},
): NormalizedServerConvexOptions {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new ServerConvexValidationError('serverConvex options must be an object')
  }

  // Re-read as unknown because JavaScript and casts can bypass the public
  // mutually exclusive union. Runtime validation must enforce the same
  // contract before any credential reaches a request header.
  const { auth, authToken, credential } = options as {
    auth?: unknown
    authToken?: unknown
    credential?: unknown
  }
  const hasToken = authToken !== undefined
  const hasCredential = credential !== undefined

  assertConvexAuthMode(auth)

  if (hasToken && hasCredential) {
    throw new ServerConvexValidationError(
      'authToken and credential are mutually exclusive; provide at most one',
    )
  }

  if (hasToken) {
    assertCredentialValueSafe(authToken, 'authToken')
  }
  if (hasCredential) {
    assertConvexCredentialShape(credential)
    assertCredentialValueSafe(credential.value, 'credential value')
  }

  const hasExplicitPrincipal = hasToken || hasCredential

  if (hasExplicitPrincipal) {
    if (auth !== undefined) {
      throw new ServerConvexValidationError(
        'auth must be omitted when authToken or credential is provided; an explicit principal already requires authentication',
      )
    }
    if (hasToken) return { auth: 'required', authToken }
    if (hasCredential) return { auth: 'required', credential }
  }

  // No explicit principal: cookie-based event resolution. Default to a fixed
  // `optional` policy when auth is omitted.
  return { auth: auth ?? 'optional' }
}
