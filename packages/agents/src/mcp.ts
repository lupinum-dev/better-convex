/**
 * The MCP door (`@lupinum/better-convex-agents/mcp`): `createMcpServer` publishes the tools of
 * `defineTools` to MCP hosts; `handleMcpRequest` is the transport and token boundary under it,
 * also usable on its own.
 */
export type {
  McpAccessContext,
  McpAccessVerifier,
  McpVerificationExpectation,
  VerifiedMcpAccess,
} from './access.js'
export { handleMcpRequest, McpUnsupportedCapabilityError } from './handler.js'
export type {
  HandleMcpRequestOptions,
  McpConfigureServerContext,
  McpRequestStateContext,
  McpRequestTools,
} from './handler.js'
export { projectMcpToolError } from './errors.js'
export type { McpToolErrorMetadata, McpToolResult, ProjectMcpToolErrorOptions } from './errors.js'
export { createMcpServer, type McpDoorAuth, type McpPrincipal } from './door.js'
