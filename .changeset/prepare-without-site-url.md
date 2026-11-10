---
'@lupinum/better-convex-nuxt': patch
---

Fix `nuxt prepare` and `nuxt typecheck` failing with "auth.origin is missing" when `SITE_URL` is not set, for example in a `postinstall` script on a fresh clone. They now warn and generate types; `nuxt dev` and `nuxt build` still require the origin.
