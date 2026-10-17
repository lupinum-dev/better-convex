---
'@lupinum/better-convex-nuxt': patch
---

Fix a signed-in, server-rendered page showing the person as signed out when the first session read in the browser fails temporarily

A 5xx, timeout or network error on that read keeps the server-rendered session; a 401 still signs out.
