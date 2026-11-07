---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix every Convex composable failing with "plugin is not installed" in `nuxt dev` when the module comes from npm.

Vite loaded two copies of the Vue package in the browser. The module now keeps it out of Vite's dependency pre-bundling.
The error now also names a second copy of the package as a possible cause.
