/** Route rule that turns SSR session resolution on or off for matching routes. */
export interface ConvexRouteRules {
  /**
   * `false` renders matching routes as an anonymous visitor: no session
   * lookup, cookies ignored, no `Vary: Cookie`. Overrides `auth.ssr`.
   */
  readonly ssrAuth?: boolean
}

const SSR_AUTH_CONTEXT_KEY = 'betterConvexSsrAuth'

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
