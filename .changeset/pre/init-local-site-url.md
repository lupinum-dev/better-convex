---
'@lupinum/better-convex-nuxt': patch
---

Fix `better-convex init` setting `SITE_URL` only in Convex. It now also writes it to `.env.local` when the file has none, so `convex.auth.origin` matches on ports other than 3000. An existing value is kept and offered as the default.
