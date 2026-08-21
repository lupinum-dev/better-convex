// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import { useAuth } from '../../src/runtime/devtools/ui/composables/useAuth'
import type { DevtoolsBridgeController } from '../../src/runtime/devtools/ui/composables/useBridge'

type MessageListener = (event: { data: unknown }) => void

describe('devtools auth diagnostics', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('accepts pushed auth state only from the selected application instance', async () => {
    const listeners = new Set<MessageListener>()
    const transport = {
      kind: 'broadcast-channel' as const,
      postMessage: vi.fn(),
      addEventListener: vi.fn((_type: string, listener: MessageListener) =>
        listeners.add(listener),
      ),
      removeEventListener: vi.fn((_type: string, listener: MessageListener) =>
        listeners.delete(listener),
      ),
      close: vi.fn(),
    }
    const bridge: DevtoolsBridgeController = {
      availableInstanceIds: ref(['tab-a']),
      boundInstanceId: ref('tab-a'),
      connected: ref(true),
      call: async <T = unknown>(
        method: Parameters<DevtoolsBridgeController['call']>[0],
      ): Promise<T> => {
        if (method === 'getEnhancedAuthState') {
          return {
            isAuthenticated: false,
            pending: false,
            user: null,
            tokenStatus: 'none',
          } as T
        }
        if (method === 'getConnectionState') {
          return {
            isConnected: true,
            hasEverConnected: true,
            connectionRetries: 0,
            inflightRequests: 0,
          } as T
        }
        return null as T
      },
      getTransport: () => transport,
      selectInstance: vi.fn(),
    }

    let auth!: ReturnType<typeof useAuth>
    const app = createApp(
      defineComponent({
        setup() {
          auth = useAuth(bridge)
          return () => h('div')
        },
      }),
    )
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await nextTick()
    await vi.waitFor(() => expect(listeners.size).toBe(1))

    const emit = (data: unknown) => {
      for (const listener of listeners) listener({ data })
    }
    emit({
      type: 'CONVEX_DEVTOOLS_AUTH',
      instanceId: 'tab-b',
      authState: { isAuthenticated: true, pending: false, user: null, tokenStatus: 'valid' },
    })
    expect(auth.authState.value?.isAuthenticated).toBe(false)

    emit({
      type: 'CONVEX_DEVTOOLS_AUTH',
      instanceId: 'tab-a',
      authState: { isAuthenticated: true, pending: false, user: null, tokenStatus: 'valid' },
      connectionState: {
        isConnected: false,
        hasEverConnected: true,
        connectionRetries: 1,
        inflightRequests: 0,
      },
      authWaterfall: null,
    })
    expect(auth.authState.value?.isAuthenticated).toBe(true)
    expect(auth.connectionState.value?.isConnected).toBe(false)

    app.unmount()
    expect(transport.removeEventListener).toHaveBeenCalledTimes(1)
  })
})
