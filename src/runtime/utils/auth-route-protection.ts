import type { RouteLocationRaw } from 'vue-router'

/**
 * Page-level route protection.
 *
 * - `true` or `{ redirectTo? }`: the page requires a signed-in user.
 * - `'guest'`: the page is for signed-out users only (sign-in, sign-up); a
 *   signed-in user is sent to the validated `?redirect=` return path or to
 *   `convex.auth.guestRedirectTo`.
 * - `false`: the page is public, even when `convex.auth.routes` is `'protected'`.
 * - omitted: follows `convex.auth.routes`.
 */
export type ConvexAuthPageMeta = boolean | 'guest' | { redirectTo?: RouteLocationRaw }

export interface RouteProtectionDecisionInput {
  meta: ConvexAuthPageMeta | undefined
  /** Protection for pages without `convexAuth` meta. @default 'public' */
  routes?: 'public' | 'protected'
  defaultRedirectTo: string
  currentPath: string
  currentFullPath?: string
}

export interface RouteProtectionDecision {
  redirectTo: RouteLocationRaw
}

export interface GuestRouteDecisionInput {
  /** The raw `?redirect=` query value from the current route. */
  returnTo: unknown
  guestRedirectTo: string
  currentPath: string
}

const LOCAL_URL_BASE = 'https://better-convex-nuxt.invalid'

function hasUnsafePathCharacter(value: string): boolean {
  for (const character of value) {
    const codeUnit = character.charCodeAt(0)
    if (character === '\\' || codeUnit <= 31 || codeUnit === 127) return true
  }
  return false
}

/**
 * Return `value` as a normalized same-origin application path, or `null`.
 *
 * Accepts only a path that starts with a single `/`. Protocol-relative
 * (`//host`), backslash (`/\host`), absolute and scheme URLs, control
 * characters, malformed percent-encoding, and encoded variants of any of these
 * are rejected, so the result is always safe to navigate to or reflect.
 */
export function normalizeLocalRedirectPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (!value.startsWith('/') || value.startsWith('//') || hasUnsafePathCharacter(value)) {
    return null
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return null
  }
  if (decoded.startsWith('//') || hasUnsafePathCharacter(decoded)) {
    return null
  }

  const parsed = new URL(value, LOCAL_URL_BASE)
  if (parsed.origin !== LOCAL_URL_BASE || parsed.pathname.startsWith('//')) {
    return null
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

function pathOnly(path: string): string {
  return path.split(/[?#]/)[0] || path
}

/** Resolve a page's effective protection from its meta and the build's route default. */
export function resolveRoutePolicy(
  meta: ConvexAuthPageMeta | undefined,
  routes: 'public' | 'protected' = 'public',
): 'public' | 'protected' | 'guest' {
  if (meta === 'guest') return 'guest'
  if (meta === false) return 'public'
  if (meta === undefined) return routes
  return 'protected'
}

function signInRedirect(
  redirectBase: string,
  currentPath: string,
  currentFullPath: string,
): RouteProtectionDecision | null {
  const redirectPath = normalizeLocalRedirectPath(redirectBase)
  if (!redirectPath) return null
  if (currentPath === pathOnly(redirectPath)) return null

  const returnTo =
    normalizeLocalRedirectPath(currentFullPath) ?? normalizeLocalRedirectPath(currentPath) ?? '/'
  const hashIndex = redirectPath.indexOf('#')
  const redirectWithoutHash = hashIndex === -1 ? redirectPath : redirectPath.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : redirectPath.slice(hashIndex)
  const separator = redirectWithoutHash.includes('?') ? '&' : '?'
  return {
    redirectTo: `${redirectWithoutHash}${separator}redirect=${encodeURIComponent(returnTo)}${hash}`,
  }
}

/**
 * Where an unauthenticated visitor of a protected page goes, or `null` when
 * the page does not require authentication (or already is the sign-in page).
 * An unsafe per-page `redirectTo` falls back to the build default rather than
 * leaving the page unprotected.
 */
export function resolveRouteProtectionDecision(
  input: RouteProtectionDecisionInput,
): RouteProtectionDecision | null {
  const { meta, defaultRedirectTo, currentPath } = input
  const currentFullPath = input.currentFullPath ?? currentPath

  if (resolveRoutePolicy(meta, input.routes) !== 'protected') return null

  const pageRedirect = typeof meta === 'object' && meta !== null ? meta.redirectTo : undefined
  if (pageRedirect && typeof pageRedirect !== 'string') {
    if (!('path' in pageRedirect) || typeof pageRedirect.path !== 'string') {
      return { redirectTo: pageRedirect }
    }
    const path = normalizeLocalRedirectPath(pageRedirect.path)
    if (path) {
      if (currentPath === pathOnly(path)) return null
      return { redirectTo: { ...pageRedirect, path } }
    }
  } else if (pageRedirect && normalizeLocalRedirectPath(pageRedirect)) {
    return signInRedirect(pageRedirect, currentPath, currentFullPath)
  }
  return signInRedirect(defaultRedirectTo, currentPath, currentFullPath)
}

/**
 * Where a signed-in visitor of a guest-only page goes: the validated return
 * path, else `guestRedirectTo`. `null` only when every candidate is the
 * current page, which would loop.
 */
export function resolveGuestRedirect(input: GuestRouteDecisionInput): string | null {
  // A repeated `?redirect=` arrives as an array and is rejected as ambiguous.
  const candidates = [
    normalizeLocalRedirectPath(input.returnTo),
    normalizeLocalRedirectPath(input.guestRedirectTo),
  ]
  for (const candidate of candidates) {
    if (candidate && pathOnly(candidate) !== input.currentPath) return candidate
  }
  return null
}
