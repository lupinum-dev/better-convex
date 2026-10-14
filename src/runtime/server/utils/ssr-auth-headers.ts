import {
  eventHeadersSent,
  eventResponseHeaders,
  type ConvexServerEvent,
  type EventResponseHeaders,
} from './event'

const SHARED_CACHE_CONTROL_HEADERS = new Set([
  'cdn-cache-control',
  'edge-control',
  'surrogate-control',
  'x-accel-expires',
])

function removeSharedCacheOverrides(headers: EventResponseHeaders): void {
  // A copy of the names: deleting while iterating a live `Headers` skips entries.
  for (const name of new Set(headers.keys())) {
    const lower = name.toLowerCase()
    if (SHARED_CACHE_CONTROL_HEADERS.has(lower) || lower.endsWith('-cdn-cache-control')) {
      headers.delete(name)
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
 *   Shared-cache override headers already present on this event's response are
 *   removed; an operator/CDN rule that rewrites headers after this point remains
 *   external.
 *
 * Nuxt 5 renders a page on its own event, which shares only `context` with the
 * routed request event. Nitro then merges every header written on the routed
 * event (a route rule `headers` entry, server middleware) over the rendered
 * response. Those headers win: a `Vary` or `Cache-Control` set there replaces
 * the value set here, and a shared-cache override set there (for example
 * `CDN-Cache-Control`) is not removed. The module warns at build time only
 * about route rules that set cache headers on pages with SSR auth; middleware
 * is not checked. On Nuxt 4 both share one Node response, so this function
 * sees and corrects those headers.
 */
export function applyConvexAuthSsrHeaders(
  event: ConvexServerEvent,
  options: { hasBetterAuthCookie: boolean; rendersUser: boolean },
): void {
  // Headers are already on the wire (SSE, streaming): setting one would throw.
  if (eventHeadersSent(event)) return
  const headers = eventResponseHeaders(event)
  headers.set('Vary', mergeVaryCookie(headers.get('Vary')))
  if (options.hasBetterAuthCookie || options.rendersUser) {
    removeSharedCacheOverrides(headers)
    headers.set('Cache-Control', 'private, no-store')
  }
}
