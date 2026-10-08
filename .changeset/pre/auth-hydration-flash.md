---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix server-rendered query data flashing empty or pending after hydration when auth is enabled.
A page the server rendered anonymously now starts as confirmed anonymous, so the browser's first auth check no longer clears its data, and a query that already has a result for its arguments stays `success` while auth confirms. A session found after an anonymous render still clears the data and runs the query as that user.
