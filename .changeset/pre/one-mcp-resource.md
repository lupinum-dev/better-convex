---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Remove `auth.mcp`: `auth.mcpAuthorization(ctx)` is the one source of the MCP resource, issuer and supported scopes.
`auth.oauthOperator.createPublicClient` binds a client to the `oauth.mcp` resource when you leave out `resource`.

Migration: spread `auth.mcpAuthorization(ctx)` into the `handleMcpRequest` options instead of `auth.mcp.resource()`, `auth.mcp.issuer()` and `auth.mcp.scopesSupported()`, and drop `resource: { identifier: auth.mcp.resource().href, … }` from `createPublicClient`.
