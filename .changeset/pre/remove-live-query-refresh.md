---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Remove `refresh()` from `useConvexQuery` and `useConvexPaginatedQuery`; it never re-ran a live query.

Migration: Delete `refresh()` calls. Convex re-runs queries when their data changes. Use `loadMore()` to retry a failed later page.
