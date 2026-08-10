import { describe, expect, it } from 'vitest'

import {
  createConvexClientOwner,
  type OwnedConvexClient,
} from '../../packages/vue/src/internal/client-owner'
import { useConvexConnectionState as useVueConvexConnectionState } from '../../packages/vue/src/use-connection-state'
import { useConvexConnectionState } from '../../src/runtime/composables/useConvexConnectionState'
import { MockConvexClient } from '../helpers/mock-convex-client'
import { captureInNuxt } from '../helpers/nuxt-runtime-harness'

/**
 * `useConvexConnectionState` now observes the CURRENT primary through the per-app
 * client owner (architecture invariant) rather than reading `$convex` and a
 * module-level store. These tests provide an owner wrapping the mock client.
 */
function ownerFor(convex: MockConvexClient) {
  return createConvexClientOwner({
    primaryFactory: () => convex as unknown as OwnedConvexClient,
  })
}

describe('useConvexConnectionState (Nuxt runtime)', () => {
  it('fails before returning inert state outside a Vue effect scope', () => {
    expect(() => useVueConvexConnectionState()).toThrow(
      '[better-convex-vue] useConvexConnectionState must run inside a Vue effect scope',
    )
  })

  it('returns transport facts immediately without product UI policy', async () => {
    const convex = new MockConvexClient()
    const owner = ownerFor(convex)

    const { result, wrapper } = await captureInNuxt(() => useConvexConnectionState(), { owner })

    expect(Object.keys(result).sort()).toEqual([
      'isConnected',
      'isReconnecting',
      'pendingActions',
      'pendingMutations',
      'state',
    ])
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.isConnected.value).toBe(false)
    expect(result.isReconnecting.value).toBe(false)
    expect(result.pendingMutations.value).toBe(0)
    expect(result.pendingActions.value).toBe(0)
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

    convex.updateConnectionState({
      isWebSocketConnected: true,
      hasEverConnected: true,
      connectionCount: 1,
    })

    expect(result.first.isConnected.value).toBe(true)
    expect(result.second.isConnected.value).toBe(true)
    expect(result.first.isReconnecting.value).toBe(false)
    expect(result.first.pendingMutations.value).toBe(0)
    expect(result.second.pendingActions.value).toBe(0)

    convex.updateConnectionState({
      isWebSocketConnected: false,
      hasEverConnected: true,
      connectionRetries: 1,
      inflightMutations: 1,
      inflightActions: 2,
    })

    expect(result.first.isConnected.value).toBe(false)
    expect(result.first.isReconnecting.value).toBe(true)
    expect(result.first.pendingMutations.value).toBe(1)
    expect(result.second.pendingActions.value).toBe(2)

    wrapper.unmount()
    // Every consumer released → the owner drops the underlying subscription.
    expect(convex.connectionSubscriberCount()).toBe(0)
  })
})
