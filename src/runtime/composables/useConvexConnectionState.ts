import {
  useConvexConnectionState as useVueConvexConnectionState,
  type UseConvexConnectionStateReturn,
} from '@lupinum/better-convex-vue'
import {
  DISCONNECTED_CONNECTION_STATE,
  projectConvexConnectionState,
} from '@lupinum/better-convex-vue/internal'
import { computed, shallowRef } from 'vue'

import { useNuxtApp } from '#app'

import { readConvexRuntimeContext } from '../runtime-context'

export type { ConnectionState } from 'convex/browser'
export type { UseConvexConnectionStateReturn } from '@lupinum/better-convex-vue'

/**
 * Observe the browser Convex connection. Server rendering, and a build without
 * a Convex URL, report the disconnected state. While the browser hydrates a
 * server-rendered page it reports that same state, because the client may
 * already be connecting; the live state follows once hydration ends.
 */
export function useConvexConnectionState(): UseConvexConnectionStateReturn {
  const nuxtApp = import.meta.client ? useNuxtApp() : undefined
  if (!nuxtApp || !readConvexRuntimeContext(nuxtApp)) {
    return projectConvexConnectionState(computed(() => DISCONNECTED_CONNECTION_STATE))
  }
  const live = useVueConvexConnectionState()
  if (!nuxtApp.isHydrating || !nuxtApp.payload.serverRendered) return live
  const hydrated = shallowRef(false)
  nuxtApp.hooks.hookOnce('app:suspense:resolve', () => {
    hydrated.value = true
  })
  return projectConvexConnectionState(
    computed(() => (hydrated.value ? live.state.value : DISCONNECTED_CONNECTION_STATE)),
  )
}
