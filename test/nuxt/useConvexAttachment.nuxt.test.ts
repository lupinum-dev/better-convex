import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import { useConvexAttachment } from '../../src/runtime/composables/useConvexAttachment'
import { ConvexCallError } from '../../src/runtime/errors'
import { captureInNuxt } from '../helpers/nuxt-runtime-harness'

describe('useConvexAttachment Nuxt host boundary', () => {
  // Runs before the harness installs a runtime into this file's Nuxt app.
  it('throws CLIENT_UNAVAILABLE when no browser runtime exists', async () => {
    let thrown: unknown
    await mountSuspended(
      defineComponent({
        setup() {
          try {
            useConvexAttachment()
          } catch (error) {
            thrown = error
          }
          return () => h('div')
        },
      }),
    )

    expect(thrown).toBeInstanceOf(ConvexCallError)
    expect(thrown).toMatchObject({ code: 'CLIENT_UNAVAILABLE' })
  })

  it('returns only the existing token-free Vue attachment, not the Nuxt runtime context', async () => {
    const { result, nuxtApp } = await captureInNuxt(() => useConvexAttachment(), {
      convex: {
        query: async () => null,
        mutation: async () => null,
        action: async () => null,
        onUpdate: () => () => {},
      },
      convexConfig: { auth: false },
    })

    expect(result).toBe(nuxtApp.$convexRuntime?.attachment)
    expect(Object.keys(result).sort()).toEqual([
      'anonymousClient',
      'client',
      'connection',
      'identity',
    ])
    expect(typeof result.client.query).toBe('function')
    expect(typeof result.client.mutation).toBe('function')
    expect(typeof result.client.action).toBe('function')
    expect(typeof result.client.onUpdate).toBe('function')
    expect(typeof result.anonymousClient.query).toBe('function')
    expect(typeof result.anonymousClient.mutation).toBe('function')
    expect(typeof result.anonymousClient.action).toBe('function')
    expect(typeof result.anonymousClient.onUpdate).toBe('function')
    expect(Object.keys(result.identity).sort()).toEqual([
      'snapshot',
      'subscribe',
      'waitForInitialSettlement',
    ])
    expect(result).not.toHaveProperty('logger')
    expect(result).not.toHaveProperty('getAuthController')
    expect(result).not.toHaveProperty('getDevtoolsSink')
    expect(result).not.toHaveProperty('dispose')
    expect(JSON.stringify(result.identity.snapshot())).not.toMatch(
      /token|cookie|authorization|secret|credential/iu,
    )
  })
})
