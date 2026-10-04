---
'@lupinum/better-convex-vue': patch
'@lupinum/better-convex-nuxt': patch
---

Change `mutate()` and `run()` to accept a ref for each argument, like query arguments.
The call reads the ref's value once, when you call it, and sends that value.
