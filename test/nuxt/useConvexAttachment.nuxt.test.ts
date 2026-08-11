import { describe, expect, it } from 'vitest'

import { useConvexAttachment } from '../../src/runtime/composables/useConvexAttachment'
import { captureInNuxt } from '../helpers/nuxt-runtime-harness'

describe('useConvexAttachment Nuxt host boundary', () => {
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
