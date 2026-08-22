import { ref, onMounted, onUnmounted, watch } from 'vue'

import type { EnhancedAuthState, ConnectionState, AuthWaterfall } from '../../types'
import type { DevtoolsBridgeController } from './useBridge'

/**
 * Keys to ignore when comparing auth state (these change frequently but don't affect UI)
 */
const VOLATILE_AUTH_KEYS = new Set(['expiresInSeconds', 'expiresAt', 'issuedAt'])

/**
 * Check if two objects have the same values (shallow comparison for our use case)
 */
function hasChanged<T extends object>(
  prev: T | null,
  next: T | null,
  ignoreKeys: Set<string> = new Set(),
): boolean {
  if (prev === null && next === null) return false
  if (prev === null || next === null) return true

  // Compare key properties that matter for UI updates
  const keys = Object.keys(next) as (keyof T)[]
  for (const key of keys) {
    // Skip volatile keys that change frequently but don't affect display
    if (ignoreKeys.has(key as string)) continue

    const prevVal = prev[key]
    const nextVal = next[key]

    // For nested objects (like user), compare by JSON string
    if (typeof nextVal === 'object' && nextVal !== null) {
      if (JSON.stringify(prevVal) !== JSON.stringify(nextVal)) return true
    } else if (prevVal !== nextVal) {
      return true
    }
  }
  return false
}

/**
 * Composable for managing auth and connection state from the DevTools bridge.
 */
export function useAuth(bridge: DevtoolsBridgeController) {
  const authState = ref<EnhancedAuthState | null>(null)
  const connectionState = ref<ConnectionState | null>(null)
  const authWaterfall = ref<AuthWaterfall | null>(null)
  let cleanup: (() => void) | null = null

  async function updateConnectionState() {
    try {
      const newState = await bridge.call<ConnectionState>('getConnectionState')
      // Only update if changed to prevent unnecessary re-renders
      if (hasChanged(connectionState.value, newState)) {
        connectionState.value = newState
      }
    } catch {
      // Ignore errors
    }
  }

  async function updateAuthState() {
    try {
      const newState = await bridge.call<EnhancedAuthState>('getEnhancedAuthState')
      // Only update if changed to prevent flickering
      // Ignore volatile keys like expiresInSeconds that change every second
      if (hasChanged(authState.value, newState, VOLATILE_AUTH_KEYS)) {
        authState.value = newState
      }
    } catch {
      // Ignore errors
    }
  }

  async function updateAuthWaterfall() {
    try {
      authWaterfall.value = await bridge.call<AuthWaterfall | null>('getAuthWaterfall')
    } catch {
      // Ignore errors
    }
  }

  onMounted(async () => {
    await Promise.all([updateConnectionState(), updateAuthState(), updateAuthWaterfall()])
    const transport = bridge.getTransport()
    if (!transport) return
    const handler = (event: { data: unknown }) => {
      if (!event.data || typeof event.data !== 'object') return
      const message = event.data as {
        type?: string
        instanceId?: string | null
        authState?: EnhancedAuthState
        connectionState?: ConnectionState
        authWaterfall?: AuthWaterfall | null
      }
      if (
        message.type !== 'CONVEX_DEVTOOLS_AUTH' ||
        message.instanceId !== bridge.boundInstanceId.value
      ) {
        return
      }
      if (message.authState && hasChanged(authState.value, message.authState, VOLATILE_AUTH_KEYS)) {
        authState.value = message.authState
      }
      if (message.connectionState && hasChanged(connectionState.value, message.connectionState)) {
        connectionState.value = message.connectionState
      }
      authWaterfall.value = message.authWaterfall ?? null
    }
    transport.addEventListener('message', handler)
    cleanup = () => transport.removeEventListener('message', handler)
  })

  watch(bridge.boundInstanceId, () => {
    authState.value = null
    connectionState.value = null
    authWaterfall.value = null
    if (bridge.boundInstanceId.value) {
      void Promise.all([updateConnectionState(), updateAuthState(), updateAuthWaterfall()])
    }
  })

  onUnmounted(() => {
    cleanup?.()
  })

  return {
    authState,
    connectionState,
    authWaterfall,
  }
}
