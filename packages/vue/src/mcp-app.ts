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
  getCurrentInstance,
  markRaw,
  onMounted,
  onScopeDispose,
  shallowReadonly,
  shallowRef,
  type ShallowRef,
} from 'vue'

export type McpAppPhase = 'idle' | 'connecting' | 'ready' | 'error' | 'closed'
export type McpAppErrorCode = 'MCP_APP_CONNECT_FAILED' | 'MCP_APP_CLONE_FAILED'
export type McpAppHostVersion = ReturnType<App['getHostVersion']>

export interface UseMcpAppOptions {
  implementation: ConstructorParameters<typeof App>[0]
  capabilities?: ConstructorParameters<typeof App>[1]
}

export interface McpAppError {
  readonly code: McpAppErrorCode
  readonly message: string
}

export interface UseMcpAppReturn {
  readonly phase: Readonly<ShallowRef<McpAppPhase>>
  readonly error: Readonly<ShallowRef<McpAppError | undefined>>
  readonly hostCapabilities: Readonly<ShallowRef<McpUiHostCapabilities | undefined>>
  readonly hostContext: Readonly<ShallowRef<McpUiHostContext | undefined>>
  readonly hostVersion: Readonly<ShallowRef<McpAppHostVersion | undefined>>
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

const CONNECT_FAILURE = Object.freeze<McpAppError>({
  code: 'MCP_APP_CONNECT_FAILED',
  message: 'The MCP App could not connect to its host.',
})

const CLONE_FAILURE = Object.freeze<McpAppError>({
  code: 'MCP_APP_CLONE_FAILED',
  message: 'The MCP App received a value that could not be safely copied.',
})

const BROWSER_REQUIRED_MESSAGE = 'useMcpApp() requires a browser.'
const COMPONENT_REQUIRED_MESSAGE = 'useMcpApp() must be called during component setup.'
const NOT_READY_MESSAGE = 'MCP App is not ready.'
const CLOSED_MESSAGE = 'MCP App is closed.'

/**
 * Own one official MCP App for the current Vue component scope.
 *
 * The raw SDK App remains private so consumers cannot replace lifecycle handlers or close the
 * transport behind this composable. Only the two host operations required by the proven consumers
 * are exposed, with structured-clone boundaries and disposed-scope retirement.
 */
export function useMcpApp(options: UseMcpAppOptions): UseMcpAppReturn {
  if (typeof window === 'undefined') throw new Error(BROWSER_REQUIRED_MESSAGE)
  if (getCurrentInstance() === null) throw new Error(COMPONENT_REQUIRED_MESSAGE)

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
  const error = shallowRef<McpAppError>()
  const hostCapabilities = shallowRef<McpUiHostCapabilities>()
  const hostContext = shallowRef<McpUiHostContext>()
  const hostVersion = shallowRef<McpAppHostVersion>()
  const toolInput = shallowRef<McpUiToolInputNotification['params']>()
  const toolInputPartial = shallowRef<McpUiToolInputPartialNotification['params']>()
  const toolResult = shallowRef<McpUiToolResultNotification['params']>()
  const toolCancelled = shallowRef<McpUiToolCancelledNotification['params']>()
  let active = true
  let closeStarted = false
  let appClosed = false

  function clearProjectedState(): void {
    hostCapabilities.value = undefined
    hostContext.value = undefined
    hostVersion.value = undefined
    toolInput.value = undefined
    toolInputPartial.value = undefined
    toolResult.value = undefined
    toolCancelled.value = undefined
  }

  function removeListeners(): void {
    app.removeEventListener('toolinput', onToolInput)
    app.removeEventListener('toolinputpartial', onToolInputPartial)
    app.removeEventListener('toolresult', onToolResult)
    app.removeEventListener('toolcancelled', onToolCancelled)
    app.removeEventListener('hostcontextchanged', onHostContextChanged)
  }

  function closeApp(): void {
    if (closeStarted || appClosed) {
      closeStarted = true
      return
    }
    closeStarted = true
    void app.close().catch(() => {})
  }

  function terminalFailure(value: McpAppError): void {
    if (!active) return
    active = false
    removeListeners()
    clearProjectedState()
    error.value = value
    phase.value = 'error'
    closeApp()
  }

  function snapshot<T>(
    value: T,
  ): { readonly ok: true; readonly value: T } | { readonly ok: false } {
    try {
      return { ok: true, value: structuredClone(value) }
    } catch {
      terminalFailure(CLONE_FAILURE)
      return { ok: false }
    }
  }

  function receive<T>(target: ShallowRef<T | undefined>, value: T): void {
    if (!active) return
    const cloned = snapshot(value)
    if (cloned.ok) target.value = cloned.value
  }

  function onHostContextChanged(): void {
    const value = app.getHostContext()
    if (value !== undefined) receive(hostContext, value)
  }

  function cloneForBridge<T>(value: T): T {
    const cloned = snapshot(value)
    if (!cloned.ok) throw new Error(CLONE_FAILURE.message)
    return cloned.value
  }

  function requireReady(): void {
    if (!active || phase.value !== 'ready') {
      throw new Error(NOT_READY_MESSAGE)
    }
  }

  function requireActive(): void {
    if (!active) throw new Error(CLOSED_MESSAGE)
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
    removeListeners()
    clearProjectedState()
    error.value = undefined
    phase.value = 'closed'
  }

  function close(): void {
    retire()
    closeApp()
  }

  app.addEventListener('toolinput', onToolInput)
  app.addEventListener('toolinputpartial', onToolInputPartial)
  app.addEventListener('toolresult', onToolResult)
  app.addEventListener('toolcancelled', onToolCancelled)
  app.addEventListener('hostcontextchanged', onHostContextChanged)
  app.onclose = () => {
    appClosed = true
  }
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
      onHostContextChanged()
      if (active) phase.value = 'ready'
    } catch {
      terminalFailure(CONNECT_FAILURE)
    }
  })

  onScopeDispose(close)

  return Object.freeze({
    callServerTool,
    openLink,
    phase: shallowReadonly(phase),
    error: shallowReadonly(error),
    hostCapabilities: shallowReadonly(hostCapabilities),
    hostContext: shallowReadonly(hostContext),
    hostVersion: shallowReadonly(hostVersion),
    toolInput: shallowReadonly(toolInput),
    toolInputPartial: shallowReadonly(toolInputPartial),
    toolResult: shallowReadonly(toolResult),
    toolCancelled: shallowReadonly(toolCancelled),
  })
}
