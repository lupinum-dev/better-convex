import type { ConnectionState } from 'convex/browser'
import { computed, getCurrentScope, onScopeDispose, type ComputedRef } from 'vue'

import { useBetterConvexRuntime } from './runtime-context'

/** Project one connection-state source onto the returned transport facts. */
export function projectConvexConnectionState(state: ComputedRef<ConnectionState>) {
  return Object.freeze({
    state,
    isConnected: computed(() => state.value.isWebSocketConnected),
    isReconnecting: computed(
      () => state.value.hasEverConnected && !state.value.isWebSocketConnected,
    ),
    pendingMutations: computed(() => state.value.inflightMutations),
    pendingActions: computed(() => state.value.inflightActions),
  })
}

export function useConvexConnectionState() {
  if (!getCurrentScope()) {
    throw new Error(
      '[better-convex-vue] useConvexConnectionState must run inside a Vue effect scope',
    )
  }

  const { browser } = useBetterConvexRuntime()
  const remove = browser.connection.addConsumer()
  onScopeDispose(remove)

  return projectConvexConnectionState(computed(() => browser.connection.state.value))
}
