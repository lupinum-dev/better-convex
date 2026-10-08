---
'@lupinum/better-convex-agents': minor
---

Add `callTool` to `@lupinum/better-convex-agents/test`: it calls a tool in convex-test exactly as the MCP door does, and rejects with the tool's own error.
Remove `testAuth`, `mcpClient` and `refs` from `./test`. `testAuth` faked the auth component, so app tests checked the fake instead of the real revocation.
Migration: use `register`, `signInAs` and `grantMcp` from `@lupinum/better-convex-nuxt/better-auth/test`, and call tools with `callTool(t, tools, principal, name, input)`.
