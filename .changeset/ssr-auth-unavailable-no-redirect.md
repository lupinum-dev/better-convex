---
'@lupinum/better-convex-nuxt': patch
---

Stop sending a signed-in person to the sign-in page when the token exchange fails for a moment during server rendering

A 429, a 5xx, a network error or a timeout from `/api/auth/convex/token` on a request with a session cookie now renders the protected page with `useConvexAuth().status === 'error'` ("Authentication is temporarily unavailable") instead of redirecting.
The browser then waits out the failure as before and finishes auth on hydration.
A request without a session cookie, or a 401 or 403 answer, still redirects as before.
