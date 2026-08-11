import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

interface HostMountOptions {
  initialInput?: Record<string, unknown>
  openLinks: boolean
  url: string
}

interface HostSnapshot {
  initialized: number
  messageBytes: string
  openLinkCalls: number
  openLinkUrls: string[]
  teardownResponses: number
  toolArgumentKeys: string[][]
  toolNames: string[]
  wrongSourcePosts: number
}

interface ActiveHost {
  bridge: AppBridge
  iframe: HTMLIFrameElement
  messageListener: (event: MessageEvent) => void
}

declare global {
  interface Window {
    __BCN_MCP_APPS_HOST__: {
      mount(options: HostMountOptions): Promise<void>
      sendCancelled(reason: string): Promise<void>
      sendInput(input: Record<string, unknown>): Promise<void>
      sendPartialInput(input: Record<string, unknown>): Promise<void>
      sendResult(result: CallToolResult): Promise<void>
      sendWrongSource(result: CallToolResult): Promise<void>
      setTheme(theme: 'dark' | 'light'): Promise<void>
      snapshot(): HostSnapshot
      teardown(): Promise<void>
    }
  }
}

let active: ActiveHost | undefined
let initialized = 0
let openLinkCalls = 0
const openLinkUrls: string[] = []
let teardownResponses = 0
let messageBytes = ''
let wrongSourcePosts = 0
const toolArgumentKeys: string[][] = []
const toolNames: string[] = []

function resetMetrics(): void {
  initialized = 0
  openLinkCalls = 0
  openLinkUrls.length = 0
  teardownResponses = 0
  messageBytes = ''
  wrongSourcePosts = 0
  toolArgumentKeys.length = 0
  toolNames.length = 0
}

async function callMcpTool(params: {
  arguments?: Record<string, unknown>
  name: string
}): Promise<CallToolResult> {
  const response = await fetch('/__better_convex_mcp_tool__', {
    body: JSON.stringify(params),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!response.ok) throw new Error('The proof host could not call the MCP server')
  return (await response.json()) as CallToolResult
}

async function mount(options: HostMountOptions): Promise<void> {
  if (active) throw new Error('The MCP Apps proof host already has a mounted view')
  resetMetrics()

  const iframe = document.createElement('iframe')
  iframe.dataset.testid = 'notes-dashboard-frame'
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.title = 'Notes dashboard MCP App'
  document.body.append(iframe)

  const bridge = new AppBridge(
    null,
    { name: 'better-convex-apps-proof-host', version: '0.0.0' },
    {
      ...(options.openLinks ? { openLinks: {} } : {}),
      serverTools: {},
    },
    {
      hostContext: {
        displayMode: 'inline',
        platform: 'web',
        theme: 'light',
      },
    },
  )

  bridge.oncalltool = async (params) => {
    toolNames.push(params.name)
    toolArgumentKeys.push(Object.keys(params.arguments ?? {}).sort())
    if (params.name !== 'search_notes') {
      return {
        content: [{ type: 'text', text: '{"code":"APP_TOOL_DENIED"}' }],
        isError: true,
      }
    }
    return callMcpTool({
      ...(params.arguments === undefined ? {} : { arguments: params.arguments }),
      name: params.name,
    })
  }
  bridge.onopenlink = async (params) => {
    openLinkCalls += 1
    openLinkUrls.push(params.url)
    return { isError: true }
  }

  let resolveInitialized: (() => void) | undefined
  let rejectInitialized: ((error: unknown) => void) | undefined
  const ready = new Promise<void>((resolve, reject) => {
    resolveInitialized = resolve
    rejectInitialized = reject
  })
  bridge.oninitialized = () => {
    initialized += 1
    void (
      options.initialInput === undefined
        ? Promise.resolve()
        : bridge.sendToolInput({ arguments: options.initialInput })
    ).then(resolveInitialized, rejectInitialized)
  }

  const messageListener = (event: MessageEvent) => {
    if (event.source === iframe.contentWindow) messageBytes += JSON.stringify(event.data)
  }
  window.addEventListener('message', messageListener)

  const transport = new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!)
  const send = transport.send.bind(transport)
  transport.send = async (message, options_) => {
    messageBytes += JSON.stringify(message)
    await send(message, options_)
  }
  let initializationTimeout: number | undefined
  try {
    await bridge.connect(transport)
    active = { bridge, iframe, messageListener }
    iframe.src = options.url
    await Promise.race([
      ready,
      new Promise<never>((_resolve, reject) => {
        initializationTimeout = window.setTimeout(
          () => reject(new Error('MCP App initialization timed out')),
          5_000,
        )
      }),
    ])
  } catch (error) {
    try {
      await bridge.close()
    } catch {
      // Preserve the primary mount failure; cleanup below is still mandatory.
    } finally {
      window.removeEventListener('message', messageListener)
      iframe.remove()
      active = undefined
    }
    throw error
  } finally {
    if (initializationTimeout !== undefined) window.clearTimeout(initializationTimeout)
  }
}

async function teardown(): Promise<void> {
  const current = active
  if (!current) return
  try {
    await current.bridge.teardownResource({})
    teardownResponses += 1
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  } finally {
    try {
      await current.bridge.close()
    } finally {
      window.removeEventListener('message', current.messageListener)
      current.iframe.remove()
      active = undefined
    }
  }
}

window.__BCN_MCP_APPS_HOST__ = {
  mount,
  sendCancelled: async (reason) => {
    if (!active) throw new Error('No MCP App is mounted')
    await active.bridge.sendToolCancelled({ reason })
  },
  sendInput: async (input) => {
    if (!active) throw new Error('No MCP App is mounted')
    await active.bridge.sendToolInput({ arguments: input })
  },
  sendPartialInput: async (input) => {
    if (!active) throw new Error('No MCP App is mounted')
    await active.bridge.sendToolInputPartial({ arguments: input })
  },
  sendResult: async (result) => {
    if (!active) throw new Error('No MCP App is mounted')
    await active.bridge.sendToolResult(result)
  },
  sendWrongSource: async (result) => {
    const sibling = document.createElement('iframe')
    sibling.hidden = true
    document.body.append(sibling)
    const nonce = crypto.randomUUID()
    const message = encodeURIComponent(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: result,
      }),
    )
    let resolveAcknowledged: (() => void) | undefined
    const acknowledged = new Promise<void>((resolve) => {
      resolveAcknowledged = resolve
    })
    const acknowledgementListener = (event: MessageEvent) => {
      if (
        event.source === sibling.contentWindow &&
        event.data?.type === 'bcn-mcp-apps-wrong-source-posted' &&
        event.data?.nonce === nonce
      ) {
        wrongSourcePosts += 1
        resolveAcknowledged?.()
      }
    }
    window.addEventListener('message', acknowledgementListener)
    let acknowledgementTimeout: number | undefined
    try {
      sibling.srcdoc = `<script>parent.document.querySelector('[data-testid="notes-dashboard-frame"]').contentWindow.postMessage(JSON.parse(decodeURIComponent(${JSON.stringify(message)})), '*');parent.postMessage({type:'bcn-mcp-apps-wrong-source-posted',nonce:${JSON.stringify(nonce)}}, '*')</script>`
      await Promise.race([
        acknowledged,
        new Promise<never>((_resolve, reject) => {
          acknowledgementTimeout = window.setTimeout(
            () => reject(new Error('Wrong-source MCP App message was not posted')),
            5_000,
          )
        }),
      ])
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    } finally {
      if (acknowledgementTimeout !== undefined) window.clearTimeout(acknowledgementTimeout)
      window.removeEventListener('message', acknowledgementListener)
      sibling.remove()
    }
  },
  setTheme: async (theme) => {
    if (!active) throw new Error('No MCP App is mounted')
    await active.bridge.sendHostContextChange({ theme })
  },
  snapshot: () => ({
    initialized,
    messageBytes,
    openLinkCalls,
    openLinkUrls: [...openLinkUrls],
    teardownResponses,
    toolArgumentKeys: toolArgumentKeys.map((keys) => [...keys]),
    toolNames: [...toolNames],
    wrongSourcePosts,
  }),
  teardown,
}
