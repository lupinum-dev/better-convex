/**
 * Build-time check for route rules that cache pages which resolve the session during SSR.
 *
 * On Nuxt 5 a route rule's `headers`, a cache it turns on (`cache`, `swr`, `isr`) or server
 * middleware wins over the `Vary: Cookie` / `Cache-Control: private, no-store` headers that
 * SSR auth sets on signed-in pages. The module only warns, and only about route rules; it
 * enforces nothing at runtime (D41 in internals/decisions.md). The cacheable-public-pages docs
 * quote `authCachedRoutesWarning`: change both together.
 */

const CACHE_HEADER_NAMES = new Set([
  'cache-control',
  'vary',
  'cdn-cache-control',
  'surrogate-control',
  'edge-control',
  'x-accel-expires',
])

/** `/api/**`, `/_nuxt/**` and `/__*` never render a page. */
const NON_PAGE_PATTERN = /^\/(?:api(?:\/|$)|_nuxt(?:\/|$)|__)/u

type RouteRuleSource = Readonly<Record<string, unknown>> | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCacheHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return CACHE_HEADER_NAMES.has(lower) || lower.endsWith('-cdn-cache-control')
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
 * Patterns whose rule can cover SSR pages, keeps SSR auth on (its own `convex.ssrAuth`, else
 * the build-wide `auth.ssr` default) and sets a cache or a cache header. `sources` are
 * `nuxt.options.routeRules` and `nuxt.options.nitro.routeRules`, in that order. For one pattern
 * the last source that lists it wins completely: `@nuxt/schema` resolves
 * `nitro.routeRules` as `{ ...routeRules, ...nitro.routeRules }`, so a Nitro entry replaces the
 * Nuxt entry and the runtime (`getRouteRules`) never sees the replaced one. Only a warning, so
 * rules of overlapping patterns are not combined.
 */
export function findAuthCachedRoutePatterns(
  sources: readonly RouteRuleSource[],
  ssrAuthDefault: boolean,
): string[] {
  const patterns = new Set(sources.flatMap((source) => (source ? Object.keys(source) : [])))
  return [...patterns].filter((pattern) => {
    if (NON_PAGE_PATTERN.test(pattern)) return false
    const rule = sources.map((source) => source?.[pattern]).findLast(isRecord)
    if (!rule) return false
    return (ruleSsrAuth(rule) ?? ssrAuthDefault) && setsCache(rule)
  })
}

export function authCachedRoutesWarning(patterns: readonly string[]): string {
  return (
    `Route rules ${patterns.map((pattern) => `"${pattern}"`).join(', ')} cache pages that ` +
    'resolve the Convex session during SSR. On Nuxt 5 these headers and caches override the ' +
    '`Vary: Cookie` and `Cache-Control: private, no-store` headers the module sets on ' +
    'signed-in pages. Set `convex: { ssrAuth: false }` on cached routes or drop the cache rule.'
  )
}
