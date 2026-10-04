---
'@lupinum/better-convex-nuxt': patch
---

Fix signed-in users with a fast system clock losing Convex auth. When the browser's clock ran about 15 minutes or more ahead, every fresh session token looked expired, so the page dropped from signed in to an auth error after hydration and its queries failed. A fetched token is now judged by its own lifetime (`exp` minus `iat`); Convex already corrects for clock differences.
