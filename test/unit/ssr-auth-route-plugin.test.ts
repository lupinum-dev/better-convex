import { describe, expect, it, vi } from 'vitest'

import ssrAuthRoute from '../../src/runtime/server/plugins/ssr-auth-route'
import { isSsrAuthEnabled } from '../../src/runtime/utils/ssr-auth'

const getRouteRulesMock = vi.hoisted(() => vi.fn())
vi.mock('nuxt/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nuxt/server')>()),
  getRouteRules: getRouteRulesMock,
}))

describe('ssr-auth-route Nitro plugin', () => {
  // Catches a plugin that does not hook every request, or records the rule
  // somewhere the SSR plugin does not read: a cached `ssrAuth: false` route
  // would then resolve the session and render one visitor's identity into
  // HTML a shared cache serves to everyone.
  it('marks the request context of a route whose rule turns SSR auth off', () => {
    const hooks: Array<(event: { context: Record<string, unknown> }) => void> = []
    ssrAuthRoute({
      hooks: {
        hook: (name, fn) => {
          expect(name).toBe('request')
          hooks.push(fn)
        },
      },
    })
    const event = { context: {} }
    getRouteRulesMock.mockReturnValue({ convex: { ssrAuth: false } })

    for (const hook of hooks) hook(event)

    expect(hooks).toHaveLength(1)
    expect(getRouteRulesMock).toHaveBeenCalledWith(event)
    expect(isSsrAuthEnabled(event.context, true)).toBe(false)
  })
})
