import { createBetterConvex } from '@lupinum/better-convex-vue'
import { computed } from 'vue'

import { defineNuxtPlugin, useRuntimeConfig, useState, type NuxtApp } from '#app'

import { identityUser } from './auth/auth-identity'
import { setupNuxtDevtoolsClient } from './devtools/setup-client'
import { createConvexRuntimeContext, readConvexRuntimeContext } from './runtime-context'
import { useConvexIdentityState } from './utils/auth-identity-state'
import { useConvexAuthPendingState } from './utils/auth-pending-state'
import { MISSING_CONVEX_URL_MESSAGE } from './utils/convex-config'
import { createLogger, getLogLevel } from './utils/logger'
import { getConvexRuntimeConfig } from './utils/runtime-config'

/**
 * Start the auth-disabled browser runtime. The plugin below calls it at app
 * start; with `client.connect: 'on-demand'`, `useConvexActivation()` calls it
 * inside the Nuxt app context instead. The auth-enabled build uses
 * `plugin.auth.client`.
 */
export function setupConvexBrowserRuntime(nuxtApp: NuxtApp): void {
  const config = useRuntimeConfig()
  const convexConfig = getConvexRuntimeConfig()
  const publicConvex = config.public.convex as Record<string, unknown> | undefined
  const logger = createLogger(getLogLevel(publicConvex))
  if (readConvexRuntimeContext(nuxtApp)) return
  if (!convexConfig.url) {
    console.error(`[better-convex-nuxt] ${MISSING_CONVEX_URL_MESSAGE}`)
    return
  }

  const plugin = createBetterConvex({
    convexUrl: convexConfig.url,
    clientOptions: convexConfig.client,
  })
  nuxtApp.vueApp.use(plugin)
  const runtime = createConvexRuntimeContext(plugin.attachment(), logger)
  nuxtApp.provide('convexRuntime', runtime)
  nuxtApp.vueApp.onUnmount(runtime.dispose)
  useConvexAuthPendingState().value = false

  if (typeof window !== 'undefined' && import.meta.dev) {
    const identity = useConvexIdentityState()
    const waterfall = useState('convex:authWaterfall', () => null)
    const instanceId = useState<string>(
      'convex:devtoolsInstanceId',
      () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    )
    setupNuxtDevtoolsClient({
      runtime,
      token: computed(() => null),
      user: computed(() => identityUser(identity.value)),
      waterfall,
      instanceId: instanceId.value,
      logger,
      readAuthState: () => ({ isAuthenticated: false, pending: false }),
      onDispose: (dispose) => nuxtApp.vueApp.onUnmount(dispose),
    })
  }
}

/** Starts the browser runtime with the app (`client.connect: 'eager'`). */
export default defineNuxtPlugin({
  name: 'convex:core-client',
  setup: setupConvexBrowserRuntime,
})
