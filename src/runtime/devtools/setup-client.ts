import type { Ref } from 'vue'

import type { ConvexRuntimeContext } from '../runtime-context'
import type { Logger } from '../utils/logger'
import type { AuthWaterfall, ConnectionState } from './types'

interface NuxtDevtoolsClientInput {
  runtime: ConvexRuntimeContext
  token: Ref<string | null>
  user: Ref<unknown>
  waterfall: Ref<AuthWaterfall | null>
  instanceId: string
  logger: Logger
  onDispose(dispose: () => void): void
}

function readConnection(runtime: ConvexRuntimeContext): ConnectionState {
  const connection = runtime.attachment.connection?.snapshot()
  if (!connection) {
    return {
      isConnected: false,
      hasEverConnected: false,
      connectionRetries: 0,
      inflightRequests: 0,
    }
  }
  const explicitInflight = connection.inflightMutations + connection.inflightActions
  return {
    isConnected: connection.isWebSocketConnected,
    hasEverConnected: connection.hasEverConnected,
    connectionRetries: connection.connectionRetries,
    inflightRequests:
      explicitInflight > 0 ? explicitInflight : Number(connection.hasInflightRequests),
  }
}

/** Install Nuxt's diagnostics adapter without exposing the Vue runtime's raw client or credentials. */
export function setupNuxtDevtoolsClient(input: NuxtDevtoolsClientInput): void {
  void Promise.all([import('./bridge-setup'), import('./sink')])
    .then(async ([{ setupDevToolsBridge }, { createDevtoolsSink }]) => {
      const sink = createDevtoolsSink()
      const detachSink = input.runtime.attachDevtoolsSink(sink)
      if (!detachSink) return
      let disposeBridge: () => void
      try {
        disposeBridge = await setupDevToolsBridge(
          sink,
          input.token,
          input.user,
          input.waterfall,
          () => readConnection(input.runtime),
          input.instanceId,
        )
      } catch (error) {
        detachSink()
        throw error
      }
      input.onDispose(() => {
        disposeBridge()
        detachSink()
      })
    })
    .catch((error) => input.logger.debug('DevTools bridge setup failed', error))
}
