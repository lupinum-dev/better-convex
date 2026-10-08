---
'@lupinum/better-convex-vue': patch
'@lupinum/better-convex-nuxt': patch
---

Change the paginated query's `reset()` to `restart()`; it restarts the list.

Migration: Rename `reset(` to `restart(` on results of `useConvexPaginatedQuery`.
