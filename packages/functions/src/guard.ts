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
 * example an auth library's own endpoints.
 *
 * `modules` is the lazy `import.meta.glob` map that `convexTest` receives. It
 * loads the keys Convex deploys and skips the ones Convex's bundler skips: a
 * file name with more than one dot (`*.test.ts`, `test.setup.ts`),
 * `_generated/` at the functions root, and a directory below the root with its
 * own `convex.config.ts` (a local component). The functions root is the part
 * of a key before `_generated/`, as convex-test finds it, else `./`. It throws
 * when the map checks nothing.
 */
export async function unguardedFunctions(
  modules: Record<string, () => Promise<unknown>>,
  options: { trustedRoutes?: Record<string, string> } = {},
): Promise<string[]> {
  type Fn = {
    isPublic?: boolean
    isInternal?: boolean
    isHttp?: boolean
    [OPERATION]?: unknown
    [GUARDED]?: unknown
  }
  type Router = { getRoutes: () => readonly (readonly [string, string, Fn])[] }
  const paths = Object.keys(modules)
  const root =
    paths
      .filter((path) => path.includes('_generated/'))
      .map((path) => path.slice(0, path.indexOf('_generated/')))
      .sort((a, b) => a.length - b.length)[0] ?? './'
  const components = paths
    .filter((path) => path.startsWith(root) && path.endsWith('/convex.config.ts'))
    .map((path) => path.slice(0, -'convex.config.ts'.length))
    .filter((dir) => dir !== root)
  const deployed = Object.entries(modules).filter(([path]) => {
    const file = path.split('/').at(-1) ?? ''
    return (
      !path.startsWith(`${root}_generated/`) &&
      !components.some((dir) => path.startsWith(dir)) &&
      (file.match(/\./g) ?? []).length <= 1
    )
  })
  if (deployed.length === 0)
    throw new Error(
      'unguardedFunctions found no modules. Pass the import.meta.glob map you give convexTest.',
    )
  const loaded = await Promise.all(
    deployed.map(
      async ([path, load]) => [path, (await load()) as Record<string, unknown>] as const,
    ),
  )
  const trusted = (path: string) =>
    Object.keys(options.trustedRoutes ?? {}).some((prefix) => path.startsWith(prefix))
  // Every Convex function in the modules, by "module:export" or "module:METHOD /path".
  const functions = loaded.flatMap(([path, exports]) =>
    Object.entries(exports).flatMap(([name, value]): [string, Fn][] => {
      const router = value as Partial<Router> | null
      if (typeof router?.getRoutes === 'function')
        return router
          .getRoutes()
          .filter(([route]) => !trusted(route))
          .map(([route, method, handler]) => [`${path}:${method} ${route}`, handler])
      const fn = value as Fn | null
      return fn && (fn.isPublic || fn.isInternal || fn.isHttp) ? [[`${path}:${name}`, fn]] : []
    }),
  )
  if (!functions.some(([, fn]) => fn[OPERATION]))
    throw new Error(
      `unguardedFunctions loaded ${loaded.length} modules but found no defineFunctions operations. Check the glob.`,
    )
  return functions.filter(([, fn]) => !fn[OPERATION] && !fn[GUARDED]).map(([id]) => id)
}
