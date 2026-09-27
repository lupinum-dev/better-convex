import { isExactLoopbackHost, normalizeAuthOrigin } from '../shared/auth-origin'
import { normalizeLocalRedirectPath } from './auth-route-protection'
import type { ConvexAuthMode } from './auth-status'

/**
 * Route protection for pages whose `definePageMeta` has no `convexAuth`.
 * `'public'` leaves them open; `'protected'` requires authentication, and
 * `convexAuth: false` opts a page out.
 */
export type ConvexAuthRouteDefault = 'public' | 'protected'

/** Build-time authentication options. An object opts the application into auth. */
export interface ConvexAuthOptions {
  /** Exact public Nuxt application origin used by the same-origin auth proxy. */
  origin: string
  /** Optional build-time Better Auth client definition. Never copied to runtime config. */
  client?: string
  /** Trusted ingress-owned header containing exactly one client IP address. */
  trustedClientIpHeader?: string
  /** Local route used when protected navigation needs authentication. @default '/auth/signin' */
  redirectTo?: string
  /**
   * Local route for a signed-in user on a `convexAuth: 'guest'` page when the
   * URL carries no valid `?redirect=` return path. @default '/'
   */
  guestRedirectTo?: string
  /**
   * Auth mode for `useConvexQuery` / `useConvexPaginatedQuery` calls that omit
   * `auth`. Server rendering and the browser use the same value. A call site's
   * own `auth` always wins. @default 'optional'
   */
  defaultQueryAuth?: ConvexAuthMode
  /** Protection for pages without `convexAuth` page meta. @default 'public' */
  routes?: ConvexAuthRouteDefault
}

/** Internal materialized auth policy. `false` exists only for a no-auth build. */
export type NormalizedConvexAuthConfig =
  | false
  | Readonly<{
      origin: string
      trustedClientIpHeader: string
      redirectTo: string
      guestRedirectTo: string
      defaultQueryAuth: ConvexAuthMode
      routes: ConvexAuthRouteDefault
    }>

const DEFAULT_AUTH_REDIRECT = '/auth/signin'
const DEFAULT_GUEST_REDIRECT = '/'
const QUERY_AUTH_MODES: readonly ConvexAuthMode[] = ['optional', 'required', 'none']
const ROUTE_DEFAULTS: readonly ConvexAuthRouteDefault[] = ['public', 'protected']

function normalizeEnum<Value extends string>(
  input: unknown,
  allowed: readonly Value[],
  fallback: Value,
  name: string,
): Value {
  if (input === undefined) return fallback
  if (!(allowed as readonly unknown[]).includes(input)) {
    throw new TypeError(`${name} must be one of ${allowed.map((value) => `'${value}'`).join(', ')}`)
  }
  return input as Value
}

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

function normalizeLocalPath(input: unknown, fallback: string, name: string): string {
  const path =
    typeof input === 'string' || input === undefined
      ? normalizeLocalRedirectPath(input ?? fallback)
      : null
  if (!path) throw new TypeError(`${name} must be a safe local application path`)
  return path
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

  const redirectTo = normalizeLocalPath(
    options.redirectTo,
    DEFAULT_AUTH_REDIRECT,
    'auth.redirectTo',
  )
  const guestRedirectTo = normalizeLocalPath(
    options.guestRedirectTo,
    DEFAULT_GUEST_REDIRECT,
    'auth.guestRedirectTo',
  )
  const defaultQueryAuth = normalizeEnum(
    options.defaultQueryAuth,
    QUERY_AUTH_MODES,
    'optional',
    'auth.defaultQueryAuth',
  )
  const routes = normalizeEnum(options.routes, ROUTE_DEFAULTS, 'public', 'auth.routes')

  return Object.freeze({
    origin,
    trustedClientIpHeader,
    redirectTo,
    guestRedirectTo,
    defaultQueryAuth,
    routes,
  })
}

export function isConvexAuthEnabled(
  config: NormalizedConvexAuthConfig,
): config is Exclude<NormalizedConvexAuthConfig, false> {
  return config !== false
}
