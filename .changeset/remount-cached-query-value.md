---
'@lupinum/better-convex-vue': patch
'@lupinum/better-convex-nuxt': patch
---

Fix a loading flash when a component mounts a query that is already live elsewhere on the page.
The query now starts with the result the client already holds, in the same render, instead of showing `pending` for one frame.
