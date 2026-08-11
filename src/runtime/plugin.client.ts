import { createBetterConvex } from 'better-convex-vue'
import { computed } from 'vue'

import { defineNuxtPlugin, useRuntimeConfig, useState } from '#app'

import { identityToken, identityUser } from './auth/auth-identity'
import { setupNuxtDevtoolsClient } from './devtools/setup-client'
import { createConvexRuntimeContext, readConvexRuntimeContext } from './runtime-context'
import { useConvexIdentityState } from './utils/auth-identity-state'
import { useConvexAuthPendingState } from './utils/auth-pending-state'
import { createLogger, getLogLevel } from './utils/logger'
import { getConvexRuntimeConfig } from './utils/runtime-config'

/** Auth-disabled client entry. The auth-enabled build installs `plugin.auth.client` instead. */
export default defineNuxtPlugin({
  name: 'convex:core-client',
  setup(nuxtApp) {
    const config = useRuntimeConfig()
    const convexConfig = getConvexRuntimeConfig()
    const publicConvex = config.public.convex as Record<string, unknown> | undefined
    const logger = createLogger(getLogLevel(publicConvex))
    if (readConvexRuntimeContext(nuxtApp) || !convexConfig.url) return

    const plugin = createBetterConvex({ convexUrl: convexConfig.url })
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
        token: computed(() => identityToken(identity.value)),
        user: computed(() => identityUser(identity.value)),
        waterfall,
        instanceId: instanceId.value,
        logger,
        onDispose: (dispose) => nuxtApp.vueApp.onUnmount(dispose),
      })
    }
  },
})
