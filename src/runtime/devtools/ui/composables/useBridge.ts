import { onMounted, onUnmounted, ref, type Ref } from 'vue'

import { createUiDevtoolsTransport, type DevtoolsTransport } from '../../transport'
import type { ConvexDevToolsBridge } from '../../types'

type BridgeMethod = keyof ConvexDevToolsBridge

interface PendingRequest {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

export interface DevtoolsBridgeController {
  readonly availableInstanceIds: Ref<string[]>
  readonly boundInstanceId: Ref<string | null>
  readonly connected: Ref<boolean>
  call<T = unknown>(method: BridgeMethod, ...args: unknown[]): Promise<T>
  getTransport(): DevtoolsTransport | null
  selectInstance(instanceId: string): void
}

/** Create one bridge controller for the current DevTools UI application. */
export function useBridge(): DevtoolsBridgeController {
  const availableInstanceIds = ref<string[]>([])
  const boundInstanceId = ref<string | null>(null)
  const connected = ref(false)
  const transport = ref<DevtoolsTransport | null>(null)

  const pendingRequests = new Map<number, PendingRequest>()
  let messageId = 0
  let cleanupListener: (() => void) | null = null

  const call = async <T = unknown>(method: BridgeMethod, ...args: unknown[]): Promise<T> =>
    new Promise((resolve, reject) => {
      const selectedInstanceId = boundInstanceId.value
      if (!transport.value || !selectedInstanceId) {
        reject(new Error('Select an application instance before calling the bridge'))
        return
      }

      const id = ++messageId
      const timeout = setTimeout(() => {
        const pending = pendingRequests.get(id)
        if (!pending) return
        pendingRequests.delete(id)
        pending.reject(new Error('Request timeout'))
      }, 5000)
      pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      })

      transport.value.postMessage({
        type: 'CONVEX_DEVTOOLS_REQUEST',
        id,
        method,
        args,
        instanceId: selectedInstanceId,
      })
    })

  const selectInstance = (instanceId: string): void => {
    if (!availableInstanceIds.value.includes(instanceId)) {
      throw new Error(`Unknown application instance: ${instanceId}`)
    }
    boundInstanceId.value = instanceId
    connected.value = true
  }

  onMounted(() => {
    const currentTransport = createUiDevtoolsTransport('convex-devtools')
    transport.value = currentTransport

    const handler = (event: { data: unknown }) => {
      if (!event.data || typeof event.data !== 'object') return
      const message = event.data as {
        type?: string
        id?: number
        error?: string
        result?: unknown
        instanceId?: string | null
      }

      if (message.type === 'CONVEX_DEVTOOLS_READY' && message.instanceId) {
        if (!availableInstanceIds.value.includes(message.instanceId)) {
          availableInstanceIds.value = [...availableInstanceIds.value, message.instanceId].sort()
        }
        return
      }

      if (
        message.type !== 'CONVEX_DEVTOOLS_RESPONSE' ||
        typeof message.id !== 'number' ||
        message.instanceId !== boundInstanceId.value
      ) {
        return
      }

      const pending = pendingRequests.get(message.id)
      if (!pending) return
      pendingRequests.delete(message.id)
      clearTimeout(pending.timeout)
      if (message.error) pending.reject(new Error(message.error))
      else pending.resolve(message.result)
    }

    currentTransport.addEventListener('message', handler)
    cleanupListener = () => currentTransport.removeEventListener('message', handler)
    currentTransport.postMessage({ type: 'CONVEX_DEVTOOLS_INIT' })
  })

  onUnmounted(() => {
    cleanupListener?.()
    cleanupListener = null
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('DevTools bridge disposed'))
    }
    pendingRequests.clear()
    transport.value?.close()
    transport.value = null
    availableInstanceIds.value = []
    boundInstanceId.value = null
    connected.value = false
  })

  return {
    availableInstanceIds,
    boundInstanceId,
    connected,
    call,
    getTransport: () => transport.value,
    selectInstance,
  }
}
