/**
 * The public surface of `@lupinum/better-convex-agents`: tools derived from the operations of
 * `defineFunctions`, with approvals, agent limits and the activity feed. The MCP door is
 * `./mcp`; test helpers are in `./test`. This entry imports only `convex` and the functions
 * package, so an app without MCP hosts does not load the MCP SDK.
 */
export { defineTools, type CatalogEntry } from './tools'
