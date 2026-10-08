---
'@lupinum/better-convex-vue': patch
'@lupinum/better-convex-nuxt': patch
---

Fix errors without a cause: in development, an error that becomes `Unknown Convex error` is now logged once with its original cause.
Production output and the public `ConvexCallError` stay the same.
