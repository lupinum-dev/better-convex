/**
 * DevTools bridge setup for the Nuxt DevTools integration.
 *
 * This module sets up the communication bridge between the main window
 * and the DevTools iframe using BroadcastChannel.
 */

import { toRaw, watchEffect } from 'vue'
import type { Ref } from 'vue'

import { createDevtoolsAuthState } from './auth-diagnostics'
import type { DevtoolsSink } from './sink'
import { createAppDevtoolsTransport, cloneDevtoolsPayload } from './transport'
import type {
  ConvexDevToolsBridge,
  ConvexUser,
  EnhancedAuthState,
  AuthState,
  AuthWaterfall,
  ConnectionState,
} from './types'

type HotImportMeta = ImportMeta & {
  hot?: {
    dispose: (callback: () => void) => void
  }
}

/**
 * Setup the DevTools bridge on the window object.
 * Only called in dev mode from plugin.client.ts.
 *
 * @param sink - Per-app bounded diagnostics store
 * @param convexToken - Ref to the current auth token
 * @param convexUser - Ref to the current user data
 * @param convexAuthWaterfall - Ref to the SSR auth waterfall timing data
 * @param readConnectionState - Safe projection of the active Vue runtime connection
 * @param readAuthState - Canonical auth controller projection
 * @param providedInstanceId - Stable application identifier used for explicit UI selection
 */
export async function setupDevToolsBridge(
  sink: DevtoolsSink,
  convexToken: Ref<string | null>,
  convexUser: Ref<unknown>,
  convexAuthWaterfall: Ref<AuthWaterfall | null>,
  readConnectionState: () => ConnectionState,
  readAuthState: () => Pick<AuthState, 'isAuthenticated' | 'pending'>,
  providedInstanceId?: string,
): Promise<() => void> {
  const bridge: ConvexDevToolsBridge = {
    version: '1.1.0',

    getQueries: () => sink.getQueries(),

    getQueryDetail: (id: string) => sink.getQuery(id),

    subscribeToQueries: (callback) => sink.subscribeToQueries(callback),

    getMutations: () => sink.getMutations(),

    subscribeToMutations: (callback) => sink.subscribeToMutations(callback),

    getAuthState: (): AuthState => {
      // Use toRaw to unwrap Vue proxy (BroadcastChannel can't clone proxies)
      const rawUser = toRaw(convexUser.value) as ConvexUser | null
      // Check for valid user by looking for required fields (more stable than Object.keys().length)
      // Object.keys() on Vue proxies can be unreliable and cause flickering
      const hasUser = !!(rawUser && typeof rawUser === 'object' && (rawUser.id || rawUser.email))
      // Create a plain object copy to avoid proxy cloning issues
      const plainUser = hasUser ? cloneDevtoolsPayload(rawUser) : null

      const state = createDevtoolsAuthState(readAuthState(), convexToken.value, plainUser)
      return {
        isAuthenticated: state.isAuthenticated,
        pending: state.pending,
        tokenStatus: state.tokenStatus,
        user: state.user,
      }
    },

    getEnhancedAuthState: (): EnhancedAuthState => {
      const rawUser = toRaw(convexUser.value) as ConvexUser | null
      const hasUser = Boolean(
        rawUser && typeof rawUser === 'object' && (rawUser.id || rawUser.email),
      )
      const plainUser = hasUser ? cloneDevtoolsPayload(rawUser) : null
      return createDevtoolsAuthState(readAuthState(), convexToken.value, plainUser)
    },

    getConnectionState: readConnectionState,

    getAuthWaterfall: (): AuthWaterfall | null => {
      // Return the SSR auth waterfall timing data (hydrated from server)
      const waterfall = convexAuthWaterfall.value
      if (!waterfall) return null
      // Create a plain object copy to avoid proxy cloning issues
      return cloneDevtoolsPayload(toRaw(waterfall))
    },

    getAuthProxyStats: async () => {
      // The proxy runs on the Nitro server, so it is read through the DevTools endpoint.
      try {
        const response = await fetch('/__convex_devtools__/proxy-stats')
        if (!response.ok) return null
        return await response.json()
      } catch {
        return null
      }
    },
  }

  // Generate a unique instance ID for this tab/window to prevent cross-tab interference
  const instanceId = providedInstanceId ?? Math.random().toString(36).slice(2, 10)
  const transport = createAppDevtoolsTransport('convex-devtools')
  const stopAuthDiagnostics = watchEffect(() => {
    transport.postMessage({
      type: 'CONVEX_DEVTOOLS_AUTH',
      authState: bridge.getEnhancedAuthState(),
      connectionState: bridge.getConnectionState(),
      authWaterfall: bridge.getAuthWaterfall(),
      instanceId,
      transport: transport.kind,
    })
  })

  // Handle messages from DevTools iframe via transport (BroadcastChannel or postMessage fallback)
  const onMessage = (event: { data: unknown }) => {
    const data = event.data
    if (!data || typeof data !== 'object') return

    const message = data as {
      type?: string
      id?: number
      method?: string
      args?: unknown[]
      instanceId?: string | null
    }

    if (message.type === 'CONVEX_DEVTOOLS_INIT') {
      // DevTools iframe is requesting connection
      transport.postMessage({
        type: 'CONVEX_DEVTOOLS_READY',
        instanceId,
        transport: transport.kind,
      })
    } else if (message.type === 'CONVEX_DEVTOOLS_REQUEST') {
      if (message.instanceId && message.instanceId !== instanceId) {
        return
      }
      // DevTools iframe is calling a bridge method
      const { id, method, args } = message
      if (typeof id !== 'number' || typeof method !== 'string') {
        return
      }
      try {
        const bridgeMethod = bridge[method as keyof ConvexDevToolsBridge]
        if (typeof bridgeMethod === 'function') {
          Promise.resolve((bridgeMethod as (...args: unknown[]) => unknown)(...(args || [])))
            .then((result) => {
              transport.postMessage({
                type: 'CONVEX_DEVTOOLS_RESPONSE',
                id,
                result,
                instanceId,
                transport: transport.kind,
              })
            })
            .catch((err) => {
              transport.postMessage({
                type: 'CONVEX_DEVTOOLS_RESPONSE',
                id,
                error: err instanceof Error ? err.message : String(err),
                instanceId,
                transport: transport.kind,
              })
            })
        } else if (bridgeMethod !== undefined) {
          // Property access
          transport.postMessage({
            type: 'CONVEX_DEVTOOLS_RESPONSE',
            id,
            result: bridgeMethod,
            instanceId,
            transport: transport.kind,
          })
        } else {
          transport.postMessage({
            type: 'CONVEX_DEVTOOLS_RESPONSE',
            id,
            error: `Unknown method: ${method}`,
            instanceId,
            transport: transport.kind,
          })
        }
      } catch (err) {
        transport.postMessage({
          type: 'CONVEX_DEVTOOLS_RESPONSE',
          id,
          error: err instanceof Error ? err.message : String(err),
          instanceId,
          transport: transport.kind,
        })
      }
    }
  }
  transport.addEventListener('message', onMessage)

  // Subscribe to mutations and forward to DevTools via BroadcastChannel
  // Capture unsubscribe handle for HMR cleanup
  const unsubscribeMutations = sink.subscribeToMutations((mutations) => {
    transport.postMessage({
      type: 'CONVEX_DEVTOOLS_MUTATIONS',
      mutations,
      instanceId,
      transport: transport.kind,
    })
  })

  // Subscribe to queries and forward to DevTools via BroadcastChannel
  // Capture unsubscribe handle for HMR cleanup
  const unsubscribeQueries = sink.subscribeToQueries((queries) => {
    transport.postMessage({
      type: 'CONVEX_DEVTOOLS_QUERIES',
      queries,
      instanceId,
      transport: transport.kind,
    })
  })

  // HMR cleanup: close the BroadcastChannel and unsubscribe when module is hot-replaced
  // This prevents ghost instances from responding to messages and subscription leaks
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    unsubscribeMutations()
    unsubscribeQueries()
    stopAuthDiagnostics()
    transport.removeEventListener('message', onMessage)
    transport.close()
  }

  const hot = (import.meta as HotImportMeta).hot
  hot?.dispose(dispose)
  return dispose
}
