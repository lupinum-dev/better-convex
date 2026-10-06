/** Markers on registered functions, and the check that no public function bypasses the library. */

export const OPERATION = Symbol.for('better-convex.operation')

/** Marks a public function that checks its caller itself: the library's own, or one the app vouches for. */
const GUARDED = Symbol.for('better-convex.guarded')

export function guarded<F>(registered: F, reason = 'library'): F {
  Object.assign(registered as object, { [GUARDED]: reason })
  return registered
}

/**
 * A function built with Convex's own builders on purpose: an auth endpoint,
 * an operator function run from the dashboard. It gets no actor, policy or
 * row rules, so say why; the reason shows up in `unguardedFunctions` reviews
 * and is easy to search for.
 */
export function trusted<F>(reason: string, registered: F): F {
  return guarded(registered, reason)
}

/**
 * Functions in these modules that bypass the library: built with Convex's own
 * builders (public or internal, HTTP routes on an exported router included)
 * and not marked with `trusted`. An internal one matters as much as a public
 * one: an operation's nested call could reach it. Routes under a prefix in
 * `trustedRoutes` (path prefix → reason) are vouched for by the app, for
 * example an auth library's own endpoints. Run it over every module in a test.
 */
export function unguardedFunctions(
  modules: Record<string, Record<string, unknown>>,
  options: { trustedRoutes?: Record<string, string> } = {},
): string[] {
  type Fn = {
    isPublic?: boolean
    isInternal?: boolean
    isHttp?: boolean
    [OPERATION]?: unknown
    [GUARDED]?: unknown
  }
  const unguarded = (fn: Fn | null) =>
    !!fn &&
    (fn.isPublic === true || fn.isInternal === true || fn.isHttp === true) &&
    !fn[OPERATION] &&
    !fn[GUARDED]
  const trusted = (path: string) =>
    Object.keys(options.trustedRoutes ?? {}).some((prefix) => path.startsWith(prefix))
  return Object.entries(modules).flatMap(([path, exports]) =>
    Object.entries(exports).flatMap(([name, value]) => {
      const router = value as {
        getRoutes?: () => readonly (readonly [string, string, Fn])[]
      } | null
      if (typeof router?.getRoutes === 'function') {
        return router
          .getRoutes()
          .filter(([route, , handler]) => unguarded(handler) && !trusted(route))
          .map(([route, method]) => `${path}:${method} ${route}`)
      }
      return unguarded(value as Fn | null) ? [`${path}:${name}`] : []
    }),
  )
}
