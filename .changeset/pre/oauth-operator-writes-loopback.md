---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix the OAuth operator accepting a query context, and refusing an MCP resource on the IPv6 loopback address `http://[::1]`.

`auth.oauthOperator.createPublicClient` and `deleteClient` now take a mutation or action context, like `createHostClient` and `setClientDisabled`. A query context is a type error, and every operator call throws `AUTH_WRITE_REQUIRES_MUTATION_OR_ACTION` at entry when it gets one. Such calls already failed later at runtime.
