---
'@lupinum/better-convex-nuxt': patch
---

Fix one Convex call per component during SSR when several components request the same query and arguments at the same time; they now share one call.
