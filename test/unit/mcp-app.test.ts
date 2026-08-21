import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  type McpAppError,
  type McpAppErrorCode,
  type McpAppHostVersion,
  type McpAppPhase,
  type UseMcpAppOptions,
  type UseMcpAppReturn,
  useMcpApp,
} from '../../packages/mcp/src/vue'

const harness = vi.hoisted(() => {
  type Listener = (value: unknown) => void

  class FakeApp {
    static instances: FakeApp[] = []

    readonly listeners = new Map<string, Listener[]>()
    readonly listenersAtConnect: string[][] = []
    readonly connect = vi.fn(async () => {
      this.listenersAtConnect.push([...this.listeners.keys()].sort())
    })
    readonly close = vi.fn(async () => {
      this.onclose?.()
    })
    readonly callServerTool = vi.fn(
      async (_input?: unknown): Promise<unknown> => ({
        content: [{ type: 'text' as const, text: 'ok' }],
      }),
    )
    readonly openLink = vi.fn(async (_input?: unknown): Promise<unknown> => ({}))
    readonly implementation: unknown
    readonly capabilities: unknown
    readonly options: unknown
    hostCapabilities: Record<string, unknown> = { openLinks: {} }
    hostContext: Record<string, unknown> = {
      locale: 'en-US',
      styles: { variables: { '--color-text-primary': '#111111' } },
    }
    hostVersion = { name: 'test-host', version: '1.0.0' }
    onclose: (() => void) | undefined
    onerror: ((error: Error) => void) | undefined
    onteardown: (() => Promise<Record<string, never>>) | undefined

    constructor(implementation: unknown, capabilities: unknown, options: unknown) {
      this.implementation = implementation
      this.capabilities = capabilities
      this.options = options
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

    emit(name: string, value: unknown) {
      if (name === 'hostcontextchanged') {
        this.hostContext = { ...this.hostContext, ...(value as Record<string, unknown>) }
      }
      for (const listener of [...(this.listeners.get(name) ?? [])]) listener(value)
    }

    getHostCapabilities() {
      return this.hostCapabilities
    }

    getHostContext() {
      return this.hostContext
    }

    getHostVersion() {
      return this.hostVersion
    }
  }

  return {
    FakeApp,
    currentInstance: true,
    mounted: [] as Array<() => void | Promise<void>>,
    disposers: [] as Array<() => void>,
  }
})

vi.mock('@modelcontextprotocol/ext-apps', () => ({ App: harness.FakeApp }))
vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  return {
    ...vue,
    getCurrentInstance() {
      return harness.currentInstance ? {} : null
    },
    onMounted(callback: () => void | Promise<void>) {
      harness.mounted.push(callback)
    },
    onScopeDispose(callback: () => void) {
      harness.disposers.push(callback)
    },
  }
})

async function mountNext() {
  const callback = harness.mounted.shift()
  expect(callback).toBeDefined()
  await callback?.()
}

function disposeAllTwice() {
  for (const dispose of [...harness.disposers]) {
    dispose()
    dispose()
  }
}

describe('useMcpApp', () => {
  beforeEach(() => {
    harness.FakeApp.instances.length = 0
    harness.currentInstance = true
    harness.mounted.length = 0
    harness.disposers.length = 0
    vi.stubGlobal('window', { parent: {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exports the narrow lifecycle contract without exposing the official App', () => {
    expectTypeOf<McpAppPhase>().toEqualTypeOf<
      'idle' | 'connecting' | 'ready' | 'error' | 'closed'
    >()
    expectTypeOf<McpAppErrorCode>().toEqualTypeOf<
      'MCP_APP_CONNECT_FAILED' | 'MCP_APP_CLONE_FAILED'
    >()
    expectTypeOf<McpAppError>().toEqualTypeOf<{
      readonly code: McpAppErrorCode
      readonly message: string
    }>()
    expectTypeOf<UseMcpAppOptions>().toHaveProperty('implementation')
    expectTypeOf<UseMcpAppReturn>().toHaveProperty('error')
    expectTypeOf<UseMcpAppReturn>().not.toHaveProperty('app')
    expectTypeOf<UseMcpAppReturn['hostVersion']['value']>().toEqualTypeOf<
      McpAppHostVersion | undefined
    >()
  })

  it('rejects server and setup misuse before constructing the official App', () => {
    vi.unstubAllGlobals()
    expect(() => useMcpApp({ implementation: { name: 'server-app', version: '1.0.0' } })).toThrow(
      'useMcpApp() requires a browser.',
    )
    expect(harness.FakeApp.instances).toHaveLength(0)

    vi.stubGlobal('window', { parent: {} })
    harness.currentInstance = false
    expect(() => useMcpApp({ implementation: { name: 'scope-app', version: '1.0.0' } })).toThrow(
      'useMcpApp() must be called during component setup.',
    )
    expect(harness.FakeApp.instances).toHaveLength(0)
  })

  it('registers listeners before connect and projects merged host state plus all four events', async () => {
    const result = useMcpApp({
      implementation: { name: 'test-app', version: '1.0.0' },
      capabilities: { tools: {} },
    })
    const app = harness.FakeApp.instances[0]!

    expect(result.phase.value).toBe('idle')
    expect(result.error.value).toBeUndefined()
    expect(app.options).toEqual({ allowUnsafeEval: false, autoResize: false, strict: true })
    await mountNext()

    expect(app.listenersAtConnect).toEqual([
      ['hostcontextchanged', 'toolcancelled', 'toolinput', 'toolinputpartial', 'toolresult'],
    ])
    expect(result.phase.value).toBe('ready')
    expect(result.hostCapabilities.value).toEqual({ openLinks: {} })
    expect(result.hostVersion.value).toEqual({ name: 'test-host', version: '1.0.0' })
    expect(result.hostContext.value).toEqual(app.hostContext)
    expect(result.hostContext.value).not.toBe(app.hostContext)

    app.emit('hostcontextchanged', { theme: 'dark' })
    expect(result.hostContext.value).toMatchObject({ locale: 'en-US', theme: 'dark' })

    const input = { arguments: { query: 'alpha' } }
    const partial = { arguments: { query: 'a' } }
    const toolResult = { content: [{ type: 'text', text: 'match' }] }
    const cancelled = { reason: 'user action' }
    app.emit('toolinput', input)
    app.emit('toolinputpartial', partial)
    app.emit('toolresult', toolResult)
    app.emit('toolcancelled', cancelled)
    input.arguments.query = 'mutated'

    expect(result.toolInput.value).toEqual({ arguments: { query: 'alpha' } })
    expect(result.toolInputPartial.value).toEqual(partial)
    expect(result.toolResult.value).toEqual(toolResult)
    expect(result.toolCancelled.value).toEqual(cancelled)
  })

  it('keeps call and link failures local to the caller and clones successful bridge values', async () => {
    const result = useMcpApp({
      implementation: { name: 'operations-app', version: '1.0.0' },
    })
    const app = harness.FakeApp.instances[0]!
    await mountNext()

    const toolFailure = new Error('host tool denial detail')
    app.callServerTool.mockRejectedValueOnce(toolFailure)
    await expect(result.callServerTool({ name: 'denied_tool', arguments: {} })).rejects.toBe(
      toolFailure,
    )

    const linkFailure = new Error('host link denial detail')
    app.openLink.mockRejectedValueOnce(linkFailure)
    await expect(result.openLink({ url: 'https://example.com' })).rejects.toBe(linkFailure)
    expect(result.phase.value).toBe('ready')
    expect(result.error.value).toBeUndefined()

    const input = { name: 'search_notes', arguments: { query: 'alpha' } }
    const output = { content: [{ type: 'text' as const, text: 'one match' }] }
    app.callServerTool.mockResolvedValueOnce(output)
    const returned = await result.callServerTool(input)
    const received = app.callServerTool.mock.calls.at(-1)?.[0]

    expect(received).toEqual(input)
    expect(received).not.toBe(input)
    expect(returned).toEqual(output)
    expect(returned).not.toBe(output)
    expect(result.phase.value).toBe('ready')
    expect(result.error.value).toBeUndefined()
  })

  it('reports a static sanitized connect failure and closes exactly once', async () => {
    const result = useMcpApp({
      implementation: { name: 'failed-app', version: '1.0.0' },
    })
    const app = harness.FakeApp.instances[0]!
    app.connect.mockRejectedValueOnce(new Error('connect bearer secret'))

    await mountNext()

    expect(result.phase.value).toBe('error')
    expect(result.error.value).toEqual({
      code: 'MCP_APP_CONNECT_FAILED',
      message: 'The MCP App could not connect to its host.',
    })
    expect(Object.isFrozen(result.error.value)).toBe(true)
    expect(JSON.stringify(result.error.value)).not.toContain('bearer secret')
    expect(app.close).toHaveBeenCalledOnce()

    disposeAllTwice()
    expect(app.close).toHaveBeenCalledOnce()
    expect(result.phase.value).toBe('error')
  })

  it('does not double-close when the pinned App closes its own failed handshake', async () => {
    const result = useMcpApp({
      implementation: { name: 'double-connect-app', version: '1.0.0' },
    })
    const app = harness.FakeApp.instances[0]!
    app.connect.mockImplementationOnce(async () => {
      await app.close()
      throw new Error('initialize response secret')
    })

    await mountNext()

    expect(result.phase.value).toBe('error')
    expect(result.error.value?.code).toBe('MCP_APP_CONNECT_FAILED')
    expect(app.close).toHaveBeenCalledOnce()
    disposeAllTwice()
    expect(app.close).toHaveBeenCalledOnce()
  })

  it('makes an incoming clone failure terminal, sanitized, and non-delivering', async () => {
    const result = useMcpApp({
      implementation: { name: 'incoming-clone-app', version: '1.0.0' },
    })
    const app = harness.FakeApp.instances[0]!
    await mountNext()

    app.emit('toolinput', {
      arguments: {
        secret: 'clone secret',
        uncloneable: () => 'clone secret',
      },
    })

    expect(result.phase.value).toBe('error')
    expect(result.error.value).toEqual({
      code: 'MCP_APP_CLONE_FAILED',
      message: 'The MCP App received a value that could not be safely copied.',
    })
    expect(JSON.stringify(result.error.value)).not.toContain('clone secret')
    expect(result.hostCapabilities.value).toBeUndefined()
    expect(result.hostContext.value).toBeUndefined()
    expect(result.toolInput.value).toBeUndefined()
    expect(app.close).toHaveBeenCalledOnce()
    for (const listeners of app.listeners.values()) expect(listeners).toHaveLength(0)

    app.emit('toolresult', { content: [{ type: 'text', text: 'late' }] })
    expect(result.toolResult.value).toBeUndefined()
    disposeAllTwice()
    expect(app.close).toHaveBeenCalledOnce()
  })

  it('retires both outgoing input and result clone failures', async () => {
    const inputFailure = useMcpApp({
      implementation: { name: 'outgoing-input-app', version: '1.0.0' },
    })
    const inputApp = harness.FakeApp.instances[0]!
    await mountNext()

    await expect(
      inputFailure.callServerTool({
        name: 'unsafe_tool',
        arguments: { value: (() => 'input secret') as unknown },
      }),
    ).rejects.toThrow('The MCP App received a value that could not be safely copied.')
    expect(inputFailure.phase.value).toBe('error')
    expect(inputFailure.error.value?.code).toBe('MCP_APP_CLONE_FAILED')
    expect(inputApp.callServerTool).not.toHaveBeenCalled()
    expect(inputApp.close).toHaveBeenCalledOnce()

    const resultFailure = useMcpApp({
      implementation: { name: 'outgoing-result-app', version: '1.0.0' },
    })
    const resultApp = harness.FakeApp.instances[1]!
    resultApp.callServerTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'result secret' }],
      structuredContent: { uncloneable: () => 'result secret' },
    })
    await mountNext()

    await expect(
      resultFailure.callServerTool({ name: 'unsafe_result', arguments: {} }),
    ).rejects.toThrow('The MCP App received a value that could not be safely copied.')
    expect(resultFailure.phase.value).toBe('error')
    expect(resultFailure.error.value).toEqual(inputFailure.error.value)
    expect(JSON.stringify(resultFailure.error.value)).not.toContain('result secret')
    expect(resultApp.close).toHaveBeenCalledOnce()
  })

  it('retires an in-flight operation on teardown and disposes idempotently', async () => {
    const result = useMcpApp({
      implementation: { name: 'teardown-app', version: '1.0.0' },
    })
    const app = harness.FakeApp.instances[0]!
    await mountNext()

    let resolveTool!: (value: { content: Array<{ type: 'text'; text: string }> }) => void
    app.callServerTool.mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          resolveTool = resolve
        }),
    )
    const pending = result.callServerTool({ name: 'slow_tool', arguments: {} })

    await expect(app.onteardown?.()).resolves.toEqual({})
    expect(result.phase.value).toBe('closed')
    expect(result.error.value).toBeUndefined()
    resolveTool({ content: [{ type: 'text', text: 'late result' }] })
    await expect(pending).rejects.toThrow('MCP App is closed.')

    expect(app.close).not.toHaveBeenCalled()
    disposeAllTwice()
    expect(app.close).toHaveBeenCalledOnce()
    for (const listeners of app.listeners.values()) expect(listeners).toHaveLength(0)
  })
})
