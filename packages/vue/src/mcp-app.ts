import {
  App,
  type McpUiHostCapabilities,
  type McpUiHostContext,
  type McpUiToolCancelledNotification,
  type McpUiToolInputNotification,
  type McpUiToolInputPartialNotification,
  type McpUiToolResultNotification,
} from '@modelcontextprotocol/ext-apps'
import {
  markRaw,
  onMounted,
  onScopeDispose,
  shallowReadonly,
  shallowRef,
  type ShallowRef,
} from 'vue'

type McpAppPhase = 'idle' | 'connecting' | 'ready' | 'error' | 'closed'

interface UseMcpAppOptions {
  implementation: ConstructorParameters<typeof App>[0]
  capabilities?: ConstructorParameters<typeof App>[1]
}

interface UseMcpAppReturn {
  readonly phase: Readonly<ShallowRef<McpAppPhase>>
  readonly hostCapabilities: Readonly<ShallowRef<McpUiHostCapabilities | undefined>>
  readonly hostContext: Readonly<ShallowRef<McpUiHostContext | undefined>>
  readonly hostVersion: Readonly<ShallowRef<ReturnType<App['getHostVersion']>>>
  readonly toolInput: Readonly<ShallowRef<McpUiToolInputNotification['params'] | undefined>>
  readonly toolInputPartial: Readonly<
    ShallowRef<McpUiToolInputPartialNotification['params'] | undefined>
  >
  readonly toolResult: Readonly<ShallowRef<McpUiToolResultNotification['params'] | undefined>>
  readonly toolCancelled: Readonly<ShallowRef<McpUiToolCancelledNotification['params'] | undefined>>
  callServerTool(
    input: Parameters<App['callServerTool']>[0],
  ): Promise<Awaited<ReturnType<App['callServerTool']>>>
  openLink(input: Parameters<App['openLink']>[0]): Promise<Awaited<ReturnType<App['openLink']>>>
}

/**
 * Own one official MCP App for the current Vue component scope.
 *
 * The raw SDK App remains private so consumers cannot replace lifecycle handlers or close the
 * transport behind this composable. Only the two host operations required by the proven consumers
 * are exposed, with structured-clone boundaries and disposed-scope retirement.
 */
export function useMcpApp(options: UseMcpAppOptions): UseMcpAppReturn {
  const app = markRaw(
    new App(options.implementation, options.capabilities, {
      allowUnsafeEval: false,
      // The exact SDK drops the ResizeObserver cleanup returned by
      // setupSizeChangedNotifications(). Keep it disabled until upstream owns disposal.
      autoResize: false,
      strict: true,
    }),
  )
  const phase = shallowRef<McpAppPhase>('idle')
  const hostCapabilities = shallowRef<McpUiHostCapabilities>()
  const hostContext = shallowRef<McpUiHostContext>()
  const hostVersion = shallowRef<ReturnType<App['getHostVersion']>>()
  const toolInput = shallowRef<McpUiToolInputNotification['params']>()
  const toolInputPartial = shallowRef<McpUiToolInputPartialNotification['params']>()
  const toolResult = shallowRef<McpUiToolResultNotification['params']>()
  const toolCancelled = shallowRef<McpUiToolCancelledNotification['params']>()
  let active = true
  let closeStarted = false

  function fail(): void {
    if (active) phase.value = 'error'
  }

  function snapshot<T>(value: T): T | undefined {
    try {
      return structuredClone(value)
    } catch {
      fail()
      return undefined
    }
  }

  function receive<T>(target: ShallowRef<T | undefined>, value: T): void {
    if (!active) return
    const cloned = snapshot(value)
    if (cloned !== undefined) target.value = cloned
  }

  function receiveHostContext(): void {
    const value = app.getHostContext()
    if (value !== undefined) receive(hostContext, value)
  }

  function cloneForBridge<T>(value: T): T {
    const cloned = snapshot(value)
    if (cloned === undefined) {
      throw new Error('MCP App value is not cloneable')
    }
    return cloned
  }

  function requireReady(): void {
    if (!active || phase.value !== 'ready') {
      throw new Error('MCP App is not ready')
    }
  }

  function requireActive(): void {
    if (!active) throw new Error('MCP App is closed')
  }

  async function callServerTool(
    input: Parameters<App['callServerTool']>[0],
  ): Promise<Awaited<ReturnType<App['callServerTool']>>> {
    requireReady()
    const result = await app.callServerTool(cloneForBridge(input))
    requireActive()
    return cloneForBridge(result)
  }

  async function openLink(
    input: Parameters<App['openLink']>[0],
  ): Promise<Awaited<ReturnType<App['openLink']>>> {
    requireReady()
    const result = await app.openLink(cloneForBridge(input))
    requireActive()
    return cloneForBridge(result)
  }

  function onToolInput(value: McpUiToolInputNotification['params']): void {
    receive(toolInput, value)
  }

  function onToolInputPartial(value: McpUiToolInputPartialNotification['params']): void {
    receive(toolInputPartial, value)
  }

  function onToolResult(value: McpUiToolResultNotification['params']): void {
    receive(toolResult, value)
  }

  function onToolCancelled(value: McpUiToolCancelledNotification['params']): void {
    receive(toolCancelled, value)
  }

  function retire(): void {
    if (!active) return
    active = false
    app.removeEventListener('toolinput', onToolInput)
    app.removeEventListener('toolinputpartial', onToolInputPartial)
    app.removeEventListener('toolresult', onToolResult)
    app.removeEventListener('toolcancelled', onToolCancelled)
    app.removeEventListener('hostcontextchanged', receiveHostContext)
    hostCapabilities.value = undefined
    hostContext.value = undefined
    hostVersion.value = undefined
    toolInput.value = undefined
    toolInputPartial.value = undefined
    toolResult.value = undefined
    toolCancelled.value = undefined
    phase.value = 'closed'
  }

  function close(): void {
    retire()
    if (closeStarted) return
    closeStarted = true
    app.onteardown = undefined
    void app.close().catch(() => {})
  }

  app.addEventListener('toolinput', onToolInput)
  app.addEventListener('toolinputpartial', onToolInputPartial)
  app.addEventListener('toolresult', onToolResult)
  app.addEventListener('toolcancelled', onToolCancelled)
  app.addEventListener('hostcontextchanged', receiveHostContext)
  app.onteardown = async () => {
    retire()
    return {}
  }

  onMounted(async () => {
    if (!active) return
    phase.value = 'connecting'
    try {
      await app.connect()
      if (!active) return
      const capabilities = app.getHostCapabilities()
      const version = app.getHostVersion()
      if (capabilities !== undefined) receive(hostCapabilities, capabilities)
      if (version !== undefined) receive(hostVersion, version)
      receiveHostContext()
      phase.value = 'ready'
    } catch {
      fail()
    }
  })

  onScopeDispose(close)

  return Object.freeze({
    callServerTool,
    openLink,
    phase: shallowReadonly(phase),
    hostCapabilities: shallowReadonly(hostCapabilities),
    hostContext: shallowReadonly(hostContext),
    hostVersion: shallowReadonly(hostVersion),
    toolInput: shallowReadonly(toolInput),
    toolInputPartial: shallowReadonly(toolInputPartial),
    toolResult: shallowReadonly(toolResult),
    toolCancelled: shallowReadonly(toolCancelled),
  })
}
