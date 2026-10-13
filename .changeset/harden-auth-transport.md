---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix the auth transport defaults: server helpers set cache headers themselves, duplicate auth cookies are dropped, and the client IP header and OAuth admin routes are no longer exposed.

- `serverConvex(event)` and `getConvexUser(event)` add `Vary: Cookie` and `Cache-Control: private, no-store` when they read the session cookie.
- `convex.auth.trustedClientIpHeader` moves from the public to the server-only runtime config (`runtimeConfig.convex.trustedClientIpHeader`).
- A production build with a loopback `convex.auth.origin` now logs a warning.
- `BCN_AUTH_PROXY_IP_SECRET` must be at least 32 characters whenever it is set, not only when `NODE_ENV` is `production`.
- OAuth refresh tokens no longer have a 10 second reuse window, and `/oauth2/end-session/confirm` and the `/admin/oauth2` provisioning routes answer 404 over HTTP.

Migration: read the trusted client IP header from `useRuntimeConfig().convex` on the server if you read it from `public.convex.auth`, and lengthen a `BCN_AUTH_PROXY_IP_SECRET` shorter than 32 characters.
