import { describe, expect, it } from 'vitest'
import { onMounted } from 'vue'

import { useNuxtApp } from '#app'

import {
  createConvexClientOwner,
  type OwnedConvexClient,
} from '../../packages/vue/src/internal/client-owner'
import { useConvexConnectionState } from '../../src/runtime/composables/useConvexConnectionState'
import { MockConvexClient } from '../helpers/mock-convex-client'
import { captureInNuxt } from '../helpers/nuxt-runtime-harness'

/** `useConvexConnectionState` observes the current primary through the per-app client owner. */
function ownerFor(convex: MockConvexClient) {
  return createConvexClientOwner({
    primaryFactory: () => convex as unknown as OwnedConvexClient,
  })
}

describe('useConvexConnectionState (Nuxt runtime)', () => {
  it('hydrates a server-rendered page with the server state, then shows the live state', async () => {
    const convex = new MockConvexClient()
    const owner = ownerFor(convex)

    const { result, wrapper } = await captureInNuxt(
      () => {
        const nuxtApp = useNuxtApp()
        nuxtApp.isHydrating = true
        nuxtApp.payload.serverRendered = true
        const state = useConvexConnectionState()
        // An anonymous visitor's client may connect before hydration ends.
        convex.updateConnectionState({ isWebSocketConnected: true, hasEverConnected: true })
        const duringHydration = state.isConnected.value
        onMounted(() => {
          nuxtApp.isHydrating = false
          void nuxtApp.callHook('app:suspense:resolve')
        })
        return { state, duringHydration }
      },
      { owner },
    )

    expect(result.duringHydration).toBe(false)
    expect(result.state.isConnected.value).toBe(true)
    wrapper.unmount()
  })

  it('shares one connection-state subscription for multiple consumers', async () => {
    const convex = new MockConvexClient()
    const owner = ownerFor(convex)

    const { result, wrapper } = await captureInNuxt(
      () => ({
        first: useConvexConnectionState(),
        second: useConvexConnectionState(),
      }),
      { owner },
    )

    expect(result.first.isConnected.value).toBe(false)
    expect(result.second.isConnected.value).toBe(false)

    // The owner holds exactly one underlying subscription for both consumers.
    expect(convex.connectionSubscriberCount()).toBe(1)

    // Derived fields are covered in test/unit/connection-state-runtime.test.ts.
    convex.updateConnectionState({ isWebSocketConnected: true, hasEverConnected: true })
    expect(result.first.isConnected.value).toBe(true)
    expect(result.second.isConnected.value).toBe(true)

    wrapper.unmount()
    // Every consumer released → the owner drops the underlying subscription.
    expect(convex.connectionSubscriberCount()).toBe(0)
  })
})
