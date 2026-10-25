---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix `better-convex init` leaving `.env.local` readable by other local users after it adds the proxy secret. The file is now mode 600.
