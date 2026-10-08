/** Markers on registered functions, and the check that no public function bypasses the library. */

import type { Operation } from './functions'

export const OPERATION = Symbol.for('better-convex.operation')

/** Marks the agents package's housekeeping function, so `launchProblems` can look for the cron that calls it. */
export const HOUSEKEEPING = Symbol.for('better-convex.housekeeping')

/** Marks the erasure step, so `launchProblems` can see that the app exports it. */
export const ERASURE_STEP = Symbol.for('better-convex.erasure-step')

/** Marks a public function that checks its caller itself: the library's own, or one the app vouches for. */
const GUARDED = Symbol.for('better-convex.guarded')

/** Marks a registered function as the library's housekeeping job: a cron must call it. Not enumerable, so it stays out of the function's JSON. */
export function markHousekeeping<F>(registered: F): F {
  Object.defineProperty(registered as object, HOUSEKEEPING, { value: true, enumerable: false })
  return registered
}

/** Marks a registered function as the erasure step: the app must export it. Not enumerable, so it stays out of the function's JSON. */
export function markErasureStep<F>(registered: F): F {
  Object.defineProperty(registered as object, ERASURE_STEP, { value: true, enumerable: false })
  return registered
}

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
  const { functions } = await scanModules(modules, options, 'unguardedFunctions')
  return functions.filter(([, fn]) => !fn[OPERATION] && !fn[GUARDED]).map(([id]) => id)
}

/** A Convex function as the scans see it: the flags Convex sets and the markers this package adds. */
export type ScannedFn = {
  isPublic?: boolean
  isInternal?: boolean
  isHttp?: boolean
  [OPERATION]?: Operation
  [GUARDED]?: unknown
  [HOUSEKEEPING]?: unknown
  [ERASURE_STEP]?: unknown
}

/**
 * Loads the modules Convex deploys (see `unguardedFunctions`) and lists their
 * functions by "module/path.ts:export", or "module/path.ts:METHOD /route" for
 * HTTP routes. `exports` has every export with its Convex function name
 * ("module/path:export"). Throws when the map is empty or holds no operations.
 */
export async function scanModules(
  modules: Record<string, () => Promise<unknown>>,
  options: { trustedRoutes?: Record<string, string> },
  caller: string,
) {
  type Router = { getRoutes: () => readonly (readonly [string, string, ScannedFn])[] }
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
      `${caller} found no modules. Pass the import.meta.glob map you give convexTest.`,
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
    Object.entries(exports).flatMap(([name, value]): [string, ScannedFn][] => {
      const router = value as Partial<Router> | null
      if (typeof router?.getRoutes === 'function')
        return router
          .getRoutes()
          .filter(([route]) => !trusted(route))
          .map(([route, method, handler]) => [`${path}:${method} ${route}`, handler])
      const fn = value as ScannedFn | null
      return fn && (fn.isPublic || fn.isInternal || fn.isHttp) ? [[`${path}:${name}`, fn]] : []
    }),
  )
  if (!functions.some(([, fn]) => fn[OPERATION]))
    throw new Error(
      `${caller} loaded ${loaded.length} modules but found no defineFunctions operations. Check the glob.`,
    )
  const exports = loaded.flatMap(([path, found]) =>
    Object.entries(found).map(([name, value]) => ({
      path,
      name,
      /** How Convex names it, for `crons`: the path below the functions root, no extension. */
      functionName: `${path.slice(root.length).replace(/\.[cm]?[jt]s$/, '')}:${name}`,
      value,
    })),
  )
  return { functions, exports }
}
