import type { CallToolResult } from '@modelcontextprotocol/server'

/**
 * Converts unexpected application or infrastructure throws into one static MCP tool failure.
 * Expected domain outcomes and deliberately projected actionable failures remain ordinary return values.
 */
export async function runMcpTool(
  operation: () => CallToolResult | Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await operation()
  } catch {
    return {
      content: [{ type: 'text', text: 'Tool execution failed' }],
      isError: true,
    }
  }
}
