---
'@lupinum/better-convex-nuxt': patch
---

Fix `better-convex-nuxt dev` leaving the local Convex backend running when it stops Convex itself, for example after Nuxt exits. The next `dev` no longer fails with "A local backend is still running".
