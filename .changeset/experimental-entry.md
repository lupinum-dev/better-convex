---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Change `useConvexOperation` to an experimental API: import it from `@lupinum/better-convex-nuxt/experimental` or `@lupinum/better-convex-vue/experimental`.

Migration: add `import { useConvexOperation } from '@lupinum/better-convex-nuxt/experimental'`; Nuxt no longer auto-imports it.
