---
'@lupinum/better-convex-vue': patch
'@lupinum/better-convex-nuxt': patch
---

Fix `reactive(useConvexQuery(...))` and `reactive()` around every other composable: results are no longer frozen, so `reactive()` unwraps their refs.
