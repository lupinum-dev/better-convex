---
'@lupinum/better-convex-vue': patch
---

Add Node.js 26 to the supported Node versions of the Vue package

The Vue package now declares `^22.19.0 || ^24.11.0 || >=26.0.0`, so installing the Nuxt package on Node 26 no longer warns, or fails with `engine-strict`, about the Vue package.
