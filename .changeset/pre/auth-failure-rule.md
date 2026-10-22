---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix auth failures being handled differently on the server and in the browser, and a setup error being shown as an outage.

One rule now applies everywhere: 401 and 403 end the session; no answer, a timeout, 408, 429 and 5xx keep it and retry (`AUTH_UNAVAILABLE`); any other answer, such as a redirect, a 404 or a token without `sub`, is the new setup error `AUTH_MISCONFIGURED`, and the route middleware redirects.
A temporary failure during a session-changing call such as `updateUser()` keeps the session and rejects the call with `AUTH_UNAVAILABLE`.
A temporary failure of the first session read in the browser now retries on its own with backoff, and a page the server rendered anonymous stays anonymous.
`useConvexAuth().error.code` is now set (for example `AUTH_UNAVAILABLE` or `SITE_URL_MISSING`); check the code instead of the message.
