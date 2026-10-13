---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix the auth transport defaults: server helpers set cache headers themselves, duplicate auth cookies are dropped, and the client IP header and OAuth admin routes are no longer exposed.

- `serverConvex(event)` and `getConvexUser(event)` add `Vary: Cookie` and `Cache-Control: private, no-store` when they read the session cookie.
- `convex.auth.trustedClientIpHeader` moves from the public to the server-only runtime config (`runtimeConfig.convex.trustedClientIpHeader`).
- A production build with a loopback `convex.auth.origin` now logs a warning.
- With the OAuth provider, `BCN_AUTH_PROXY_IP_SECRET` must be at least 32 characters whenever it is set, and it is required unless `SITE_URL` is a loopback origin. `NODE_ENV` no longer decides this.
- `/oauth2/end-session/confirm` and the `/admin/oauth2` provisioning routes are now listed as disabled over HTTP. The provider only calls them from server code and never routed them, so this is defence in depth, not a behavior change.

Migration: read the trusted client IP header from `useRuntimeConfig().convex` on the server if you read it from `public.convex.auth`, and set a `BCN_AUTH_PROXY_IP_SECRET` of at least 32 characters on every non-loopback deployment that uses the OAuth provider.
