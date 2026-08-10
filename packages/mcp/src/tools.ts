import type { CallToolResult, InputRequiredResult } from '@modelcontextprotocol/server'

type McpToolResult = CallToolResult | InputRequiredResult

/**
 * Converts unexpected throws from an opted-in tool callback into one static MCP tool failure.
 *
 * This deliberately narrow helper does not sanitize SDK input/output validation failures or callbacks
 * that do not call it. Expected domain outcomes remain ordinary official tool return values.
 */
export const runMcpTool = async (
  operation: () => McpToolResult | Promise<McpToolResult>,
): Promise<McpToolResult> => {
  try {
    return await operation()
  } catch {
    return {
      content: [{ type: 'text', text: 'Tool execution failed' }],
      isError: true,
    }
  }
}
