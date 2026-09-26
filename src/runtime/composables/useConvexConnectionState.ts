import {
  useConvexConnectionState as useVueConvexConnectionState,
  type UseConvexConnectionStateReturn,
} from '@lupinum/better-convex-vue'
import {
  DISCONNECTED_CONNECTION_STATE,
  projectConvexConnectionState,
} from '@lupinum/better-convex-vue/internal'
import { computed } from 'vue'

import { useNuxtApp } from '#app'

import { readConvexRuntimeContext } from '../runtime-context'

export type { ConnectionState } from 'convex/browser'
export type { UseConvexConnectionStateReturn } from '@lupinum/better-convex-vue'

/**
 * Observe the browser Convex connection. Server rendering, and a build without
 * a Convex URL, report the same disconnected state the browser runtime starts
 * from, so the first client render hydrates without a mismatch.
 */
export function useConvexConnectionState(): UseConvexConnectionStateReturn {
  if (import.meta.client && readConvexRuntimeContext(useNuxtApp())) {
    return useVueConvexConnectionState()
  }
  return projectConvexConnectionState(computed(() => DISCONNECTED_CONNECTION_STATE))
}
