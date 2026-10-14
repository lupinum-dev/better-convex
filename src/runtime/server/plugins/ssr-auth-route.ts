import { getRouteRules, type RequestEvent } from 'nuxt/server'

import { recordSsrAuthRouteRule } from '../../utils/ssr-auth'

/**
 * Auth builds only: give the SSR auth plugin a way to read the request's
 * `convex: { ssrAuth }` route rule, so it can skip session resolution for
 * routes whose HTML must not depend on who is asking (ISR, shared caches).
 * The rule is read at render time, after Nitro has routed the request.
 *
 * A plain function instead of `defineNitroPlugin`, so one file loads on
 * nitropack 2 (Nuxt 4) and Nitro 3 (Nuxt 5). It stays a Nitro plugin: the
 * app-side route rules carry only Nuxt's own keys, not `convex`.
 */
export default function ssrAuthRoute(nitroApp: {
  hooks: {
    hook(name: 'request', fn: (event: Pick<RequestEvent, 'context'>) => void): unknown
  }
}): void {
  nitroApp.hooks.hook('request', (event) => {
    recordSsrAuthRouteRule(event.context, () => getRouteRules(event))
  })
}
