---
'@lupinum/better-convex-nuxt': patch
---

Fix signed-in users losing their Convex auth when Better Auth extends their session.
The token route now issues a token while it renews the session the request presented, and an SSR page or Nitro helper passes the renewed session cookie on to the browser, so the cookie keeps the stored expiry. A token response without a usable lifetime now signs the browser out instead of reusing the previous token.
