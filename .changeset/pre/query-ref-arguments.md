---
'@lupinum/better-convex-vue': patch
'@lupinum/better-convex-nuxt': patch
---

Add refs as individual query arguments: `useConvexQuery(api.projects.get, { projectId })` with `projectId` from `toRefs(props)` now type-checks, also in `useConvexPaginatedQuery`.
