/** Route rule that turns SSR session resolution on or off for matching routes. */
export interface ConvexRouteRules {
  /**
   * `false` renders matching routes as an anonymous visitor: no session
   * lookup, cookies ignored, no `Vary: Cookie`. Overrides `auth.ssr`.
   */
  readonly ssrAuth?: boolean
}

const SSR_AUTH_CONTEXT_KEY = 'betterConvexSsrAuth'

const SHARED_CACHE_OVERRIDE_HEADERS = new Set([
  'cdn-cache-control',
  'edge-control',
  'surrogate-control',
  'x-accel-expires',
])

/**
 * A response header that tells a CDN or reverse proxy to cache regardless of
 * `Cache-Control` (`CDN-Cache-Control`, `Vercel-CDN-Cache-Control`, ...). SSR
 * auth removes these from signed-in pages, and the build warns about route
 * rules that set them on pages with SSR auth.
 */
export function isSharedCacheOverrideHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return SHARED_CACHE_OVERRIDE_HEADERS.has(lower) || lower.endsWith('-cdn-cache-control')
}

/**
 * Record how to read the request's route rules (Nitro plugin, `request` hook).
 * The rules are read when rendering, not in the hook: Nuxt 5 runs that hook
 * before Nitro routes the request, and its fallback lookup there misses every
 * rule but `/**` when `app.baseURL` is not `/`.
 */
export function recordSsrAuthRouteRule(
  context: Record<string, unknown>,
  readRouteRules: () => object | undefined,
): void {
  context[SSR_AUTH_CONTEXT_KEY] = readRouteRules
}

/**
 * Whether this request resolves the session while rendering: the route rule
 * when one matched, otherwise the build-wide `auth.ssr` default.
 */
export function isSsrAuthEnabled(
  context: Record<string, unknown> | undefined,
  buildDefault: boolean,
): boolean {
  const readRouteRules = context?.[SSR_AUTH_CONTEXT_KEY]
  if (typeof readRouteRules !== 'function') return buildDefault
  const routeRules: unknown = readRouteRules()
  const convex = (routeRules as { convex?: ConvexRouteRules } | undefined)?.convex
  return typeof convex?.ssrAuth === 'boolean' ? convex.ssrAuth : buildDefault
}
