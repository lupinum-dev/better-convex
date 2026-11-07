---
'@lupinum/better-convex-nuxt': minor
---

Change the command from `better-convex` to `better-convex-nuxt`, and add `better-convex-nuxt dev`, which runs Convex and Nuxt together.

`dev` starts a local backend without an account when `.env.local` selects no deployment, and passes the deployment URL to Nuxt.
`init` is now `auth init`, and it no longer adds the unused `organization()` plugin to the auth schema.
`convex dashboard` now runs through the command.
Migration: in `package.json` scripts and CI, replace `better-convex convex` with `better-convex-nuxt convex` and `better-convex init` with `better-convex-nuxt auth init`.
