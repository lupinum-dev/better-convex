import type { CallToolResult, InputRequiredResult } from '@modelcontextprotocol/server'

type McpToolResult = CallToolResult | InputRequiredResult

export interface McpToolErrorMetadata {
  readonly kind: 'tool'
  readonly name: string
}

export interface RunMcpToolOptions {
  readonly name: string
  readonly onToolError?: (metadata: McpToolErrorMetadata) => void | Promise<void>
}

function safeToolName(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim() !== value ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
    })
  ) {
    throw new TypeError('Invalid MCP tool name')
  }
  return value
}

/**
 * Converts unexpected throws from an opted-in tool callback into one static MCP tool failure.
 *
 * This deliberately narrow helper does not sanitize SDK input/output validation failures or callbacks
 * that do not call it. Expected domain outcomes remain ordinary official tool return values.
 */
export const runMcpTool = async (
  operation: () => McpToolResult | Promise<McpToolResult>,
  options?: RunMcpToolOptions,
): Promise<McpToolResult> => {
  const name = options === undefined ? undefined : safeToolName(options.name)
  try {
    return await operation()
  } catch {
    if (name !== undefined && options?.onToolError) {
      try {
        await options.onToolError(Object.freeze({ kind: 'tool', name }))
      } catch {
        // Diagnostics must not change the client-visible tool result.
      }
    }
    return {
      content: [{ type: 'text', text: 'Tool execution failed' }],
      isError: true,
    }
  }
}
