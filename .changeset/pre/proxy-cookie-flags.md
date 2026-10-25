---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Change the auth proxy to refuse every Better Auth cookie without `HttpOnly` or with `SameSite=None`, not only the session cookie. A deletion cookie is checked only for `Secure`.

The refusal of a query on a fixed metadata route now carries the code `BCN_AUTH_PROXY_METADATA_QUERY_REJECTED`.
