---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Change `upload()` to take one options object: `upload(file, { args, context })`.

Migration: replace `upload(file, args, { context })` with `upload(file, { args, context })`, and `upload(file, {}, { context })` with `upload(file, { context })`.
