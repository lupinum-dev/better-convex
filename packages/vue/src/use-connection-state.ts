import { computed, getCurrentScope, onScopeDispose } from 'vue'

import { useBetterConvexRuntime } from './runtime-context'

export function useConvexConnectionState() {
  if (!getCurrentScope()) {
    throw new Error(
      '[better-convex-vue] useConvexConnectionState must run inside a Vue effect scope',
    )
  }

  const { browser } = useBetterConvexRuntime()
  const remove = browser.connection.addConsumer()
  onScopeDispose(remove)

  const state = computed(() => browser.connection.state.value)
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
