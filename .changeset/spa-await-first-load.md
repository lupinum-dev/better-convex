---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix `await useConvexQuery()` and `useConvexPaginatedQuery()` on the first load of an `ssr: false` page.
The query now starts at once and the await waits for its first result. Before, it returned at once with `status: 'idle'` and no data, because Nuxt reports `isHydrating` on that render too.
