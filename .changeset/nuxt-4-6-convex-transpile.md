---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix server-rendered pages that answer 500 "Cannot find module .../convex/dist/esm/index.js" on Nuxt 4.6.0 and 4.6.1

The module now adds `convex` to `build.transpile`, so Nitro no longer copies a broken import path into the server bundle. Remove any `nitro.externals` workaround you added for this.
`@nuxt/kit` moves to 4.6.1.
