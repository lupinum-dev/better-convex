/**
 * Build-time check for route rules that cache pages which resolve the session during SSR.
 *
 * A cache that a route rule turns on (`cache`, `swr`, `isr`) replaces the `Vary: Cookie` /
 * `Cache-Control: private, no-store` headers that SSR auth sets on signed-in pages, on Nuxt 4
 * and Nuxt 5. On Nuxt 5 a route rule's `headers` and server middleware win over them too (on
 * Nuxt 4 they share one Node response with SSR auth, which corrects them). The module only
 * warns, and only about route rules; it enforces nothing at runtime (D41 in
 * internals/decisions.md). The cacheable-public-pages docs quote `authCachedRoutesWarning`:
 * change both together.
 */

import { isSharedCacheOverrideHeader } from './runtime/utils/ssr-auth'

/** `/api/**`, `/_nuxt/**` and `/__*` never render a page. */
const NON_PAGE_PATTERN = /^\/(?:api(?:\/|$)|_nuxt(?:\/|$)|__)/u

type RouteRuleSource = Readonly<Record<string, unknown>> | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCacheHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === 'cache-control' || lower === 'vary' || isSharedCacheOverrideHeader(lower)
}

function setsCache(rule: Record<string, unknown>): boolean {
  return (
    Boolean(rule.cache) ||
    Boolean(rule.swr) ||
    Boolean(rule.isr) ||
    (isRecord(rule.headers) && Object.keys(rule.headers).some(isCacheHeader))
  )
}

function ruleSsrAuth(rule: Record<string, unknown>): boolean | undefined {
  const ssrAuth = isRecord(rule.convex) ? rule.convex.ssrAuth : undefined
  return typeof ssrAuth === 'boolean' ? ssrAuth : undefined
}

/**
 * Whether every path that `other` matches also matches `pattern`. Only a `/**` pattern covers
 * other patterns (`/**` covers all, `/blog/**` covers `/blog`, `/blog/x` and `/blog/x/**`); an
 * exact pattern covers only itself, and other wildcards are treated as covering nothing.
 */
function covers(pattern: string, other: string): boolean {
  if (!pattern.endsWith('/**')) return false
  const base = pattern.slice(0, -3)
  return other === base || other.startsWith(`${base}/`)
}

/**
 * Patterns whose rule can cover SSR pages, keeps SSR auth on and sets a cache or a cache
 * header. A pattern's `convex.ssrAuth` is its own, else that of the most specific other
 * pattern that covers all its paths (Nitro merges matching rules, the more specific winning),
 * else the build-wide `auth.ssr` default. `sources` are `nuxt.options.routeRules` and
 * `nuxt.options.nitro.routeRules`, in that order. For one pattern the last source that lists
 * it wins completely: `@nuxt/schema` resolves `nitro.routeRules` as
 * `{ ...routeRules, ...nitro.routeRules }`, so a Nitro entry replaces the Nuxt entry and the
 * runtime (`getRouteRules`) never sees the replaced one.
 */
export function findAuthCachedRoutePatterns(
  sources: readonly RouteRuleSource[],
  ssrAuthDefault: boolean,
): string[] {
  const patterns = [...new Set(sources.flatMap((source) => (source ? Object.keys(source) : [])))]
  const rules = new Map(
    patterns.flatMap((pattern) => {
      const rule = sources.map((source) => source?.[pattern]).findLast(isRecord)
      return rule ? [[pattern, rule] as const] : []
    }),
  )
  const inheritedSsrAuth = (pattern: string): boolean | undefined => {
    let inherited: { length: number; ssrAuth: boolean } | undefined
    for (const [other, rule] of rules) {
      const ssrAuth = ruleSsrAuth(rule)
      if (other === pattern || ssrAuth === undefined || !covers(other, pattern)) continue
      if (!inherited || other.length > inherited.length)
        inherited = { length: other.length, ssrAuth }
    }
    return inherited?.ssrAuth
  }
  return [...rules].flatMap(([pattern, rule]) => {
    if (NON_PAGE_PATTERN.test(pattern) || !setsCache(rule)) return []
    const ssrAuth = ruleSsrAuth(rule) ?? inheritedSsrAuth(pattern) ?? ssrAuthDefault
    return ssrAuth ? [pattern] : []
  })
}

export function authCachedRoutesWarning(patterns: readonly string[]): string {
  return (
    `Route rules ${patterns.map((pattern) => `"${pattern}"`).join(', ')} cache pages that ` +
    'resolve the Convex session during SSR. A cache rule replaces the `Vary: Cookie` and ' +
    '`Cache-Control: private, no-store` headers the module sets on signed-in pages, and on ' +
    'Nuxt 5 a `headers` rule with cache headers does too. Set `convex: { ssrAuth: false }` on ' +
    'cached routes or drop the cache rule.'
  )
}
