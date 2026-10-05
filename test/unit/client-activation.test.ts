import { describe, expect, it } from 'vitest'

import {
  getClientActivationTemplateContents,
  getRouteRulesTypeTemplateContents,
} from '../../src/module-templates'
import { normalizeConvexClientConnect } from '../../src/runtime/utils/client-connect'
import { isSsrAuthEnabled, recordSsrAuthRouteRule } from '../../src/runtime/utils/ssr-auth'

describe('client.connect', () => {
  it('defaults to eager and accepts on-demand', () => {
    expect(normalizeConvexClientConnect(undefined)).toBe('eager')
    expect(normalizeConvexClientConnect('eager')).toBe('eager')
    expect(normalizeConvexClientConnect('on-demand')).toBe('on-demand')
  })

  it.each(['lazy', true, null])('rejects %s', (value) => {
    expect(() => normalizeConvexClientConnect(value)).toThrow(
      "client.connect must be 'eager' or 'on-demand'",
    )
  })

  it('exports no loader in an eager build', () => {
    const contents = getClientActivationTemplateContents('eager')
    expect(contents).toContain(`export const connect = 'eager'`)
    expect(contents).toContain('export const loadBrowserRuntime = null')
    expect(contents).not.toContain('import(')
  })

  it('loads the browser runtime lazily and only in the client bundle when on-demand', () => {
    const contents = getClientActivationTemplateContents('on-demand')
    expect(contents).toContain(`export const connect = 'on-demand'`)
    expect(contents).toContain('import.meta.client')
    expect(contents).toContain("import('#convex/browser-runtime')")
    expect(contents).toContain('setupConvexBrowserRuntime')
  })
})

describe('SSR auth route rule', () => {
  it('uses the build default when no route rule matched', () => {
    expect(isSsrAuthEnabled({}, true)).toBe(true)
    expect(isSsrAuthEnabled(undefined, false)).toBe(false)
  })

  it('lets a matched convex.ssrAuth rule override the default in both directions', () => {
    const off: Record<string, unknown> = {}
    recordSsrAuthRouteRule(off, { convex: { ssrAuth: false } })
    expect(isSsrAuthEnabled(off, true)).toBe(false)

    const on: Record<string, unknown> = {}
    recordSsrAuthRouteRule(on, { convex: { ssrAuth: true } })
    expect(isSsrAuthEnabled(on, false)).toBe(true)
  })

  it('ignores rules without a boolean ssrAuth', () => {
    const context: Record<string, unknown> = {}
    recordSsrAuthRouteRule(context, { convex: { ssrAuth: 'no' } })
    recordSsrAuthRouteRule(context, { isr: 60 } as never)
    recordSsrAuthRouteRule(context, undefined)
    expect(isSsrAuthEnabled(context, true)).toBe(true)
  })

  it('types the route rule for Nitro', () => {
    const contents = getRouteRulesTypeTemplateContents('/runtime/utils/ssr-auth')
    expect(contents).toContain("declare module 'nitropack'")
    expect(contents).toContain("declare module 'nitropack/types'")
    expect(contents).toContain('convex?: ConvexRouteRules')
  })
})
