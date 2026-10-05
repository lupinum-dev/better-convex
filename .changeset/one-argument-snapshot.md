---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix upload and operation arguments being read after the wait for authentication.
`upload()` args and context and every `op.query`, `op.mutation` and `op.action` call now copy their arguments when called, with the same rules as `mutate()`. Write state publishes `status` last, a form can no longer be submitted twice from a `pending` watcher, and a form cancelled during validation returns `CANCELLED`.
