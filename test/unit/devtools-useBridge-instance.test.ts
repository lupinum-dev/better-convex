// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

type MessageListener = (event: { data: unknown }) => void

interface FakeTransport {
  kind: 'broadcast-channel' | 'post-message'
  postMessage: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  emit: (data: unknown) => void
}

let fakeTransport: FakeTransport

vi.mock('../../src/runtime/devtools/transport', () => ({
  createUiDevtoolsTransport: vi.fn(() => fakeTransport),
}))

function createFakeTransport(): FakeTransport {
  const listeners = new Set<MessageListener>()
  return {
    kind: 'broadcast-channel',
    postMessage: vi.fn(),
    addEventListener: vi.fn((_type: string, listener: MessageListener) => {
      listeners.add(listener)
    }),
    removeEventListener: vi.fn((_type: string, listener: MessageListener) => {
      listeners.delete(listener)
    }),
    close: vi.fn(),
    emit(data: unknown) {
      for (const listener of listeners) {
        listener({ data })
      }
    },
  }
}

async function mountBridge() {
  // Re-imported after `vi.resetModules()` so each test gets fresh bridge state.
  const { useBridge } = await import('../../src/runtime/devtools/ui/composables/useBridge')
  let bridge!: ReturnType<typeof useBridge>
  const app = createApp(
    defineComponent({
      setup() {
        bridge = useBridge()
        return () => h('div')
      },
    }),
  )
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, bridge }
}

describe('devtools useBridge instance binding', () => {
  beforeEach(() => {
    vi.resetModules()
    fakeTransport = createFakeTransport()
  })

  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('requires explicit selection and ignores responses from other instances', async () => {
    const { app, bridge } = await mountBridge()

    expect(fakeTransport.postMessage).toHaveBeenCalledWith({ type: 'CONVEX_DEVTOOLS_INIT' })

    fakeTransport.emit({ type: 'CONVEX_DEVTOOLS_READY', instanceId: 'tab-a' })
    fakeTransport.emit({ type: 'CONVEX_DEVTOOLS_READY', instanceId: 'tab-b' })
    expect(bridge.availableInstanceIds.value).toEqual(['tab-a', 'tab-b'])
    expect(bridge.boundInstanceId.value).toBeNull()
    bridge.selectInstance('tab-a')

    const requestPromise = bridge.call('getQueries')
    const requestMessage = fakeTransport.postMessage.mock.calls.find(
      ([msg]) =>
        msg &&
        typeof msg === 'object' &&
        (msg as { type?: string }).type === 'CONVEX_DEVTOOLS_REQUEST',
    )?.[0] as
      | {
          type: string
          id: number
          instanceId: string | null
        }
      | undefined

    expect(requestMessage).toBeDefined()
    expect(requestMessage?.instanceId).toBe('tab-a')

    // Wrong tab response should be ignored.
    fakeTransport.emit({
      type: 'CONVEX_DEVTOOLS_RESPONSE',
      id: requestMessage!.id,
      instanceId: 'tab-b',
      result: ['wrong'],
    })

    let settled = false
    void requestPromise.finally(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    // Bound tab response should resolve the request.
    fakeTransport.emit({
      type: 'CONVEX_DEVTOOLS_RESPONSE',
      id: requestMessage!.id,
      instanceId: 'tab-a',
      result: ['ok'],
    })

    await expect(requestPromise).resolves.toEqual(['ok'])
    app.unmount()
  })

  it('rejects pending requests and closes the transport on UI teardown', async () => {
    const { app, bridge } = await mountBridge()

    fakeTransport.emit({ type: 'CONVEX_DEVTOOLS_READY', instanceId: 'tab-a' })
    bridge.selectInstance('tab-a')
    const pending = bridge.call('getQueries')
    app.unmount()

    await expect(pending).rejects.toThrow('disposed')
    expect(fakeTransport.removeEventListener).toHaveBeenCalledTimes(1)
    expect(fakeTransport.close).toHaveBeenCalledTimes(1)
  })
})
