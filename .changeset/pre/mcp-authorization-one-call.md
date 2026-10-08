---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Add `auth.mcpAuthorization(ctx)`: the MCP door's resource, issuer, scopes and token verifier from the `oauth.mcp` profile in one call.
Pass `auth` to `createMcpServer` from `@lupinum/better-convex-agents/mcp`, or spread the result into the `handleMcpRequest` options.
