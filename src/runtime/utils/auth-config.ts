import { isExactLoopbackHost, normalizeAuthOrigin } from '../shared/auth-origin'
import { normalizeLocalRedirectPath } from './auth-route-protection'

/** Build-time authentication options. An object opts the application into auth. */
export interface ConvexAuthOptions {
  /** Exact public Nuxt application origin used by the same-origin auth proxy. */
  origin: string
  /** Optional build-time Better Auth client definition. Never copied to runtime config. */
  client?: string
  /** Trusted ingress-owned header containing exactly one client IP address. */
  trustedClientIpHeader?: string
  /** Local route used when protected navigation needs authentication. */
  redirectTo?: string
}

/** Internal materialized auth policy. `false` exists only for a no-auth build. */
export type NormalizedConvexAuthConfig =
  | false
  | Readonly<{
      origin: string
      trustedClientIpHeader: string
      redirectTo: string
    }>

const DEFAULT_AUTH_REDIRECT = '/auth/signin'

function normalizeTrustedClientIpHeader(input: unknown): string {
  if (input === undefined) return ''
  if (typeof input !== 'string') {
    throw new TypeError('auth.trustedClientIpHeader must be a valid HTTP header name')
  }
  const header = input.trim().toLowerCase()
  if (!header) return ''
  try {
    new Headers().set(header, 'validation')
  } catch {
    throw new TypeError('auth.trustedClientIpHeader must be a valid HTTP header name')
  }
  if (header.startsWith('x-bcn-')) {
    throw new TypeError('auth.trustedClientIpHeader must not use the reserved x-bcn-* namespace')
  }
  return header
}

/**
 * Normalize the build grammar. Omission is a genuine Convex-only build; an
 * object opts into auth and must name its one exact public application origin.
 * `false` remains a Nuxt-layer tombstone for removing inherited auth options.
 */
export function normalizeConvexAuthConfig(
  input: false | ConvexAuthOptions | undefined | unknown,
): NormalizedConvexAuthConfig {
  if (input === undefined || input === false) return false
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('auth must be false or an object with an origin')
  }

  const options = input as Partial<ConvexAuthOptions>
  if (typeof options.origin !== 'string') {
    throw new TypeError('auth.origin must be a non-empty string URL origin')
  }
  const origin = normalizeAuthOrigin(options.origin, 'auth.origin')
  const trustedClientIpHeader = normalizeTrustedClientIpHeader(options.trustedClientIpHeader)
  if (!trustedClientIpHeader && !isExactLoopbackHost(new URL(origin).hostname)) {
    throw new TypeError(
      'auth.trustedClientIpHeader is required outside exact loopback development origins',
    )
  }

  const redirectTo = normalizeLocalRedirectPath(options.redirectTo ?? DEFAULT_AUTH_REDIRECT)
  if (!redirectTo) {
    throw new TypeError('auth.redirectTo must be a safe local application path')
  }

  return Object.freeze({ origin, trustedClientIpHeader, redirectTo })
}

export function isConvexAuthEnabled(
  config: NormalizedConvexAuthConfig,
): config is Exclude<NormalizedConvexAuthConfig, false> {
  return config !== false
}
