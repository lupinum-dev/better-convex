---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
'@lupinum/better-convex-agents': patch
---

Change the Better Auth peers to 1.7.7 (critical Magic Link account-takeover fix) and the MCP server peer to 2.3.1.

Update `@nuxt/kit`, `convex-helpers` and `ohash`.
Migration: install `better-auth`, `@better-auth/core` and `@better-auth/oauth-provider` at exactly `1.7.7`, and `@modelcontextprotocol/server@2.3.1` when you use MCP.
