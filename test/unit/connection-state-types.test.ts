import { DISCONNECTED_CONNECTION_STATE } from '@lupinum/better-convex-vue/internal'
import { describe, expect, expectTypeOf, it } from 'vitest'

import type {
  UseConvexConnectionStateReturn,
  useConvexConnectionState as useVueConvexConnectionState,
} from '../../packages/vue/src/use-connection-state'
import { useConvexConnectionState as useNuxtConvexConnectionState } from '../../src/runtime/composables/useConvexConnectionState'

type TransportStateKeys =
  | 'state'
  | 'isConnected'
  | 'isReconnecting'
  | 'pendingMutations'
  | 'pendingActions'

describe('connection-state public contract', () => {
  it('names one return type shared by Vue and Nuxt', () => {
    expectTypeOf<
      ReturnType<typeof useVueConvexConnectionState>
    >().toEqualTypeOf<UseConvexConnectionStateReturn>()
    expectTypeOf<
      ReturnType<typeof useNuxtConvexConnectionState>
    >().toEqualTypeOf<UseConvexConnectionStateReturn>()
  })

  it('contains only transport facts in Vue and Nuxt', () => {
    expectTypeOf<
      keyof ReturnType<typeof useVueConvexConnectionState>
    >().toEqualTypeOf<TransportStateKeys>()
    expectTypeOf<
      keyof ReturnType<typeof useNuxtConvexConnectionState>
    >().toEqualTypeOf<TransportStateKeys>()
    expectTypeOf<ReturnType<typeof useVueConvexConnectionState>>().not.toHaveProperty(
      'shouldShowOfflineUi',
    )
    expectTypeOf<ReturnType<typeof useNuxtConvexConnectionState>>().not.toHaveProperty(
      'shouldShowOfflineUi',
    )
  })

  it('uses a deterministic disconnected projection during SSR', () => {
    const result = useNuxtConvexConnectionState()

    expect(Object.keys(result).sort()).toEqual([
      'isConnected',
      'isReconnecting',
      'pendingActions',
      'pendingMutations',
      'state',
    ])
    expect(result.state.value).toBe(DISCONNECTED_CONNECTION_STATE)
    expect(result.isConnected.value).toBe(false)
    expect(result.isReconnecting.value).toBe(false)
    expect(result.pendingMutations.value).toBe(0)
    expect(result.pendingActions.value).toBe(0)
  })
})
