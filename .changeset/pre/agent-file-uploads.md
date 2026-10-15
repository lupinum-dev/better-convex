---
'@lupinum/better-convex-functions': minor
'@lupinum/better-convex-agents': minor
---

Add upload links for agents: `request_upload`, `uploadRoute` and `claimUpload`

Turn them on with `defineTools(fns, modules, { functions, uploads: { scopes, types, maxBytes } })` and `http.route(uploadRoute(agents))`.
An agent sends a file's bytes outside MCP with a one-time token; the route checks size and type from the first bytes.
`claimUpload(ctx, uploadId, { types, maxBytes })` inside a mutation operation hands over the file only to the actor that sent it, once.
`libraryTables` gains the `uploads` table; `housekeeping` and account deletion clean it up.
