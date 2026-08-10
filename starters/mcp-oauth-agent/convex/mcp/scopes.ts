export const MCP_SCOPES = Object.freeze(['mcp:read', 'mcp:write'] as const)

export type McpScope = (typeof MCP_SCOPES)[number]

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value)
}
