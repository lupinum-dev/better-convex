import { useConvexConnectionState as useVueConvexConnectionState } from '@lupinum/better-convex-vue'
import {
  DISCONNECTED_CONNECTION_STATE,
  projectConvexConnectionState,
} from '@lupinum/better-convex-vue/internal'
import { computed } from 'vue'

export type { ConnectionState } from 'convex/browser'

/** Deterministic SSR projection around the shared Vue connection store. */
export function useConvexConnectionState() {
  // The Better Convex Vue plugin is intentionally client-only in Nuxt. SSR
  // therefore renders the same disconnected state that the shared runtime
  // reports before its first browser connection, without relaxing plain Vue's
  // fail-fast "plugin required" contract.
  if (import.meta.client) return useVueConvexConnectionState()
  return projectConvexConnectionState(computed(() => DISCONNECTED_CONNECTION_STATE))
}
