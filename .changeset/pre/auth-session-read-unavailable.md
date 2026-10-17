---
'@lupinum/better-convex-nuxt': patch
---

Fix a person being sent to the sign-in page when the first session read in the browser fails for a moment

When the server could not tell who the person is and the browser's first session read then fails with a 5xx, a timeout or a network error, the browser now reports `AUTH_UNAVAILABLE` ("Authentication is temporarily unavailable"), so the route middleware leaves the page alone. A 401 still counts as signed out.
