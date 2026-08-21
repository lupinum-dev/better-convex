import type { BetterConvexAttachment } from '@lupinum/better-convex-vue/embedded'
import type { ComputedRef } from 'vue'

import type { DevtoolsSink } from './devtools/sink'
import type { ConvexAuthStatus } from './utils/auth-status'
import type { Logger } from './utils/logger'

/** Nuxt-owned Better Auth presentation; it never controls a Convex client. */
export interface NuxtConvexAuthController {
  readonly pending: ComputedRef<boolean>
  readonly client: object
  ready(options?: { timeoutMs?: number }): Promise<ConvexAuthStatus>
  dispose(): void
}

/** Nuxt adapters around the one Vue-owned browser runtime. */
export interface ConvexRuntimeContext {
  readonly attachment: BetterConvexAttachment
  readonly logger: Logger
  getAuthController(): NuxtConvexAuthController | null
  attachAuthController(controller: NuxtConvexAuthController): void
  getDevtoolsSink(): DevtoolsSink | null
  attachDevtoolsSink(sink: DevtoolsSink): (() => void) | null
  dispose(): void
}

export function readConvexRuntimeContext(nuxtApp: unknown): ConvexRuntimeContext | undefined {
  if ((typeof nuxtApp !== 'object' && typeof nuxtApp !== 'function') || nuxtApp === null) {
    return undefined
  }
  return (nuxtApp as { $convexRuntime?: ConvexRuntimeContext }).$convexRuntime
}

export function createConvexRuntimeContext(
  attachment: BetterConvexAttachment,
  logger: Logger,
): ConvexRuntimeContext {
  let authController: NuxtConvexAuthController | null = null
  let devtoolsSink: DevtoolsSink | null = null
  let disposed = false

  const stopIdentityObservation = attachment.identity.subscribe(() => {
    devtoolsSink?.clearIdentityOwned()
  })

  const context: ConvexRuntimeContext = {
    attachment,
    logger,
    getAuthController: () => authController,
    attachAuthController(controller) {
      if (authController && authController !== controller) {
        throw new Error('[convex-runtime] auth controller is already attached')
      }
      authController = controller
    },
    getDevtoolsSink: () => devtoolsSink,
    attachDevtoolsSink(sink) {
      if (disposed) {
        sink.dispose()
        return null
      }
      devtoolsSink?.dispose()
      devtoolsSink = sink
      return () => {
        if (devtoolsSink !== sink) return
        devtoolsSink = null
        sink.dispose()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopIdentityObservation()
      authController?.dispose()
      devtoolsSink?.dispose()
      devtoolsSink = null
    },
  }
  return Object.freeze(context)
}
