---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix signed-in people being shown as signed out when the token exchange fails for a moment

A 429, a 5xx, a network error or a timeout from `/api/auth/convex/token` no longer ends in a sign-out: the browser waits and asks again (1 s up to 30 s, with jitter) for at least 30 seconds, and at a scheduled refresh for as long as the current token still works.
After that it reports `AUTH_UNAVAILABLE` ("Authentication is temporarily unavailable") instead of "Convex rejected the authentication token".
Convex now refreshes Better Auth tokens 60 seconds before they expire, and its 10-second confirmation deadline starts only after a token is fetched.
Add the optional `tokenRefreshLeewaySeconds` to `BetterConvexAuthAdapter` for the same choice in a custom adapter.
