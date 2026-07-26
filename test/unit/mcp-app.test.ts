import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  type Listener = (value: unknown) => void

  class FakeApp {
    static instances: FakeApp[] = []

    readonly listeners = new Map<string, Listener[]>()
    readonly connect = vi.fn(async () => {})
    readonly close = vi.fn(async () => {})
    readonly callServerTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    readonly openLink = vi.fn(async () => ({}))
    onerror: ((error: Error) => void) | undefined
    onteardown: (() => Promise<Record<string, never>>) | undefined

    constructor() {
      FakeApp.instances.push(this)
    }

    addEventListener(name: string, listener: Listener) {
      const listeners = this.listeners.get(name) ?? []
      listeners.push(listener)
      this.listeners.set(name, listeners)
    }

    removeEventListener(name: string, listener: Listener) {
      const listeners = this.listeners.get(name) ?? []
      this.listeners.set(
        name,
        listeners.filter((candidate) => candidate !== listener),
      )
    }

    getHostCapabilities() {
      return {}
    }

    getHostContext() {
      return {}
    }

    getHostVersion() {
      return { name: 'test-host', version: '1.0.0' }
    }
  }

  return {
    FakeApp,
    mounted: [] as Array<() => void | Promise<void>>,
    disposers: [] as Array<() => void>,
  }
})

vi.mock('@modelcontextprotocol/ext-apps', () => ({ App: harness.FakeApp }))
vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  return {
    ...vue,
    onMounted(callback: () => void | Promise<void>) {
      harness.mounted.push(callback)
    },
    onScopeDispose(callback: () => void) {
      harness.disposers.push(callback)
    },
  }
})

import { useMcpApp } from '../../packages/vue/src/mcp-app'

async function mount() {
  for (const callback of [...harness.mounted]) await callback()
}

describe('useMcpApp', () => {
  beforeEach(() => {
    harness.FakeApp.instances.length = 0
    harness.mounted.length = 0
    harness.disposers.length = 0
  })

  it('keeps recoverable protocol errors non-terminal and preserves an in-flight result', async () => {
    const result = useMcpApp({
      implementation: { name: 'test-app', version: '1.0.0' },
    })
    const app = harness.FakeApp.instances[0]!
    await mount()
    expect(result.phase.value).toBe('ready')

    let resolveTool!: (value: { content: Array<{ type: 'text'; text: string }> }) => void
    app.callServerTool.mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          resolveTool = resolve
        }),
    )
    const pending = result.callServerTool({ name: 'commit_once', arguments: {} })
    app.onerror?.(new Error('Unknown response id'))
    resolveTool({ content: [{ type: 'text', text: 'committed result' }] })

    await expect(pending).resolves.toEqual({
      content: [{ type: 'text', text: 'committed result' }],
    })
    expect(result.phase.value).toBe('ready')

    app.onerror?.(new Error('Unknown progress token'))
    await expect(result.callServerTool({ name: 'next_call', arguments: {} })).resolves.toEqual({
      content: [{ type: 'text', text: 'ok' }],
    })
    expect(app.callServerTool).toHaveBeenCalledTimes(2)
  })

  it('keeps connect rejection and teardown terminal and closes exactly once', async () => {
    const failed = useMcpApp({
      implementation: { name: 'failed-app', version: '1.0.0' },
    })
    const failedApp = harness.FakeApp.instances[0]!
    failedApp.connect.mockRejectedValueOnce(new Error('connect failed'))
    await mount()
    expect(failed.phase.value).toBe('error')

    harness.mounted.length = 0
    const connected = useMcpApp({
      implementation: { name: 'connected-app', version: '1.0.0' },
    })
    const connectedApp = harness.FakeApp.instances[1]!
    await mount()
    expect(connected.phase.value).toBe('ready')

    await expect(connectedApp.onteardown?.()).resolves.toEqual({})
    expect(connected.phase.value).toBe('closed')

    for (const dispose of [...harness.disposers]) {
      dispose()
      dispose()
    }
    expect(failedApp.close).toHaveBeenCalledOnce()
    expect(connectedApp.close).toHaveBeenCalledOnce()
    for (const listeners of connectedApp.listeners.values()) expect(listeners).toHaveLength(0)
  })
})
