import {
  getResponseHeader,
  getResponseHeaders,
  removeResponseHeader,
  setResponseHeader,
  type H3Event,
} from 'h3'

const SHARED_CACHE_CONTROL_HEADERS = new Set([
  'cdn-cache-control',
  'edge-control',
  'surrogate-control',
  'x-accel-expires',
])

function removeSharedCacheOverrides(event: H3Event): void {
  for (const name of Object.keys(getResponseHeaders(event))) {
    const lower = name.toLowerCase()
    if (SHARED_CACHE_CONTROL_HEADERS.has(lower) || lower.endsWith('-cdn-cache-control')) {
      removeResponseHeader(event, name)
    }
  }
}

/**
 * Merge `Cookie` into an existing `Vary` header value without dropping any
 * caller-set field ("Vary/Cache-Control"). Existing tokens are
 * preserved, whitespace is normalized, and `Cookie` is added exactly once
 * (case-insensitively) so an auth-enabled SSR response always varies by cookie
 * while a pre-existing `Vary: Accept-Encoding` survives. `Vary: *` already
 * varies on every request property and must remain the sole field value.
 */
export function mergeVaryCookie(existing: string | number | string[] | undefined | null): string {
  const values: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    for (const part of raw.split(',')) {
      const token = part.trim()
      if (!token) continue
      const key = token.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      values.push(token)
    }
  }

  if (Array.isArray(existing)) {
    for (const entry of existing) push(String(entry))
  } else if (existing !== undefined && existing !== null) {
    push(String(existing))
  }

  if (seen.has('*')) return '*'
  if (!seen.has('cookie')) values.push('Cookie')
  return values.join(', ')
}

/**
 * Apply the SSR auth cache policy to the current response :
 *
 * - Every auth-enabled SSR response appends `Vary: Cookie`, preserving existing
 *   `Vary` values so a shared cache keys per cookie.
 * - A request carrying a recognized Better Auth cookie, or any response that
 *   renders a signed-in user, additionally gets `Cache-Control: private, no-store`.
 *   Invalid/revoked sessions remain request-specific even when no token is
 *   produced, and a per-user page is never cacheable without a cookie signal.
 *   Shared-cache override headers already present on the response are removed;
 *   an operator/CDN rule that rewrites headers after this point remains external.
 */
export function applyConvexAuthSsrHeaders(
  event: H3Event,
  options: { hasBetterAuthCookie: boolean; rendersUser: boolean },
): void {
  setResponseHeader(event, 'Vary', mergeVaryCookie(getResponseHeader(event, 'Vary')))
  if (options.hasBetterAuthCookie || options.rendersUser) {
    removeSharedCacheOverrides(event)
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
  }
}
