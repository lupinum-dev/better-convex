---
'@lupinum/better-convex-functions': minor
'@lupinum/better-convex-agents': minor
'@lupinum/better-convex-vue': minor
'@lupinum/better-convex-nuxt': minor
---

Add `why` and `fix` to failures, and the Convex request ID to `ConvexCallError`.

`fail(code, message, { why, fix })` tells the caller why a call failed and what to do; `NOT_FOUND` and `FAILED` take no help.
`ConvexCallError` has `why`, `fix` and `requestId`. The request ID matches the Convex logs, so a user can quote it.
MCP tool failures carry the same `why` and `fix`.
