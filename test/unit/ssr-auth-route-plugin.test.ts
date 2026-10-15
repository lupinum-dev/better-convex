import { describe, expect, it, vi } from 'vitest'

import ssrAuthRoute from '../../src/runtime/server/plugins/ssr-auth-route'
import { isSsrAuthEnabled } from '../../src/runtime/utils/ssr-auth'

const getRouteRulesMock = vi.hoisted(() => vi.fn())
vi.mock('nuxt/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nuxt/server')>()),
  getRouteRules: getRouteRulesMock,
}))

describe('ssr-auth-route Nitro plugin', () => {
  // Catches a plugin that does not hook every request, records the rule
  // somewhere the SSR plugin does not read, or reads it in the hook: Nuxt 5
  // runs the hook before Nitro routes the request (`context.routeRules` is set
  // later), and with `app.baseURL: '/app/'` the fallback lookup misses
  // `/blog/**`. A cached `ssrAuth: false` route would then resolve the session
  // and render one visitor's identity into HTML a shared cache serves to everyone.
  it('reads the route rule of the routed request when rendering', () => {
    const hooks: Array<(event: { context: Record<string, unknown> }) => void> = []
    ssrAuthRoute({
      hooks: {
        hook: (name, fn) => {
          expect(name).toBe('request')
          hooks.push(fn)
        },
      },
    })
    const event: { context: Record<string, unknown> } = { context: {} }
    // Nuxt 5 `nuxt/server` getRouteRules: the routed rules, else a lookup
    // that misses under a base URL.
    getRouteRulesMock.mockImplementation((routed: typeof event) => routed.context.routeRules ?? {})

    for (const hook of hooks) hook(event)
    // Nitro's `~findRoute` runs after the request hook.
    event.context.routeRules = { isr: 60, convex: { ssrAuth: false } }

    expect(hooks).toHaveLength(1)
    expect(isSsrAuthEnabled(event.context, true)).toBe(false)
    expect(getRouteRulesMock).toHaveBeenCalledWith(event)
  })
})
