import { shallowRef, type Ref } from 'vue'

import { useNuxtApp, type NuxtApp } from '#app'
import { connect, loadBrowserRuntime } from '#convex/client-activation'

import { readConvexRuntimeContext } from '../runtime-context'
import type { ConvexClientConnect } from '../utils/client-connect'

export type { ConvexClientConnect } from '../utils/client-connect'

export interface UseConvexActivationReturn {
  /** The build's `convex.client.connect` mode. */
  readonly connect: ConvexClientConnect
  /** `true` once the browser runtime exists. Always `false` during server rendering. */
  readonly active: Readonly<Ref<boolean>>
  /**
   * Start the browser runtime if it is not running yet. Concurrent calls share
   * one start. Resolves without effect during server rendering; rejects when
   * the runtime code cannot be loaded, and a later call retries.
   */
  activate(): Promise<void>
}

interface ActivationState {
  readonly active: Ref<boolean>
  starting: Promise<void> | null
}

const states = new WeakMap<NuxtApp, ActivationState>()

function activationState(nuxtApp: NuxtApp): ActivationState {
  let state = states.get(nuxtApp)
  if (!state) {
    state = { active: shallowRef(false), starting: null }
    states.set(nuxtApp, state)
  }
  return state
}

async function start(nuxtApp: NuxtApp, state: ActivationState): Promise<void> {
  if (loadBrowserRuntime) {
    const setup = await loadBrowserRuntime()
    await nuxtApp.runWithContext(() => setup(nuxtApp))
  }
  state.active.value = Boolean(readConvexRuntimeContext(nuxtApp))
}

/**
 * Start the Convex browser runtime on demand.
 *
 * With `convex.client.connect: 'on-demand'` the browser loads no Convex or
 * Better Auth client and opens no WebSocket until `activate()` runs. Call it
 * before mounting components that use Convex composables, for example from a
 * plugin that checks for an editor cookie, or from an event handler before a
 * `v-if` shows the editing UI. With the default `'eager'` mode the runtime
 * starts with the app and `activate()` resolves at once.
 */
export function useConvexActivation(nuxtApp: NuxtApp = useNuxtApp()): UseConvexActivationReturn {
  const state = activationState(nuxtApp)
  // An eager runtime may start after the first call (plugin order).
  if (import.meta.client && !state.active.value && readConvexRuntimeContext(nuxtApp)) {
    state.active.value = true
  }
  return {
    connect,
    active: state.active,
    activate() {
      if (import.meta.server || state.active.value) return Promise.resolve()
      state.starting ??= start(nuxtApp, state).finally(() => {
        state.starting = null
      })
      return state.starting
    },
  }
}
