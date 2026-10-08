---
'@lupinum/better-convex-nuxt': minor
---

Add `siteOrigins` to `createBetterConvexAuth` so one Convex deployment serves sign-in for several Nuxt sites.
The auth proxy signs its `auth.origin` with `BCN_AUTH_PROXY_IP_SECRET`; Convex runs Better Auth with that origin when it is `SITE_URL` or listed. A wrongly signed or unlisted origin fails.
Migration: a Nuxt `auth.origin` that differs from the Convex `SITE_URL` now fails auth requests unless `siteOrigins` lists it. Set both to the same origin, or list it.
