/** Route rule that turns SSR session resolution on or off for matching routes. */
export interface ConvexRouteRules {
  /**
   * `false` renders matching routes as an anonymous visitor: no session
   * lookup, cookies ignored, no `Vary: Cookie`. Overrides `auth.ssr`.
   */
  readonly ssrAuth?: boolean
}

const SSR_AUTH_CONTEXT_KEY = 'betterConvexSsrAuth'

/** Record the matched route rule on the request (Nitro plugin, before rendering). */
export function recordSsrAuthRouteRule(
  context: Record<string, unknown>,
  routeRules: object | undefined,
): void {
  const convex = (routeRules as { convex?: ConvexRouteRules } | undefined)?.convex
  if (typeof convex?.ssrAuth === 'boolean') context[SSR_AUTH_CONTEXT_KEY] = convex.ssrAuth
}

/**
 * Whether this request resolves the session while rendering: the route rule
 * when one matched, otherwise the build-wide `auth.ssr` default.
 */
export function isSsrAuthEnabled(
  context: Record<string, unknown> | undefined,
  buildDefault: boolean,
): boolean {
  const routeRule = context?.[SSR_AUTH_CONTEXT_KEY]
  return typeof routeRule === 'boolean' ? routeRule : buildDefault
}
