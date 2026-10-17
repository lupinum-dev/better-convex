---
'@lupinum/better-convex-nuxt': patch
---

Fix signed-in people being sent to the sign-in page when the token exchange fails for a moment

A 429, a 5xx, a network error or a timeout from `/api/auth/convex/token` now renders the protected page with `useConvexAuth().status === 'error'` ("Authentication is temporarily unavailable") instead of redirecting, on the server, on hydration and on later navigation.
The browser waits out the failure and recovers on its own.
No session cookie, a 401 or 403 answer, or any other auth error still redirects as before.
