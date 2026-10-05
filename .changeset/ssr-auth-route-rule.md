---
'@lupinum/better-convex-nuxt': patch
---

Add `auth.ssr` and the `convex: { ssrAuth }` route rule to render pages without the session.
Such pages ignore session cookies on the server, call no token exchange, and get no `Vary: Cookie` or `private` header, so a shared cache or ISR can store them.
