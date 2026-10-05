---
'@lupinum/better-convex-nuxt': patch
---

Fix `useConvexAuth().ready()` returning `'pending'` during a sign-in while `status` still showed the previous value. `ready()` now returns the same status as `useConvexAuth().status`.
