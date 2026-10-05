import { defineNitroPlugin, getRouteRules } from 'nitropack/runtime'

import { recordSsrAuthRouteRule } from '../../utils/ssr-auth'

/**
 * Auth builds only: copy the request's `convex: { ssrAuth }` route rule onto
 * the event so the SSR auth plugin can skip session resolution for routes
 * whose HTML must not depend on who is asking (ISR, shared caches).
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    recordSsrAuthRouteRule(event.context, getRouteRules(event))
  })
})
