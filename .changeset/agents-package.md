---
'@lupinum/better-convex-agents': minor
---

Add `@lupinum/better-convex-agents`, the renamed `@lupinum/better-convex-mcp`: `defineTools` turns operations of `@lupinum/better-convex-functions` into tools, with approvals, agent limits, an activity feed and housekeeping.
`createMcpServer` (`/mcp`) publishes those tools to MCP hosts; a connection sees only the tools its scopes unlock.
`handleMcpRequest` now also serves 2025-era clients (Claude, ChatGPT) statelessly, with JSON responses.
Remove `defineMcpTool`, `registerMcpTool` and `runMcpTool`.
Migration: install `@lupinum/better-convex-agents` and `@lupinum/better-convex-functions`, import the transport from `@lupinum/better-convex-agents/mcp`, and use `tools.runTool(name, operation)` instead of `runMcpTool`; see MIGRATING.md.
