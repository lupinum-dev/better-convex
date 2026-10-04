---
'@lupinum/better-convex-nuxt': patch
---

Change session reads (`GET /api/auth/get-session`) to skip the database rate limiter. They run on every page load and reconnect, and the counter cost one Convex write each; a missing or forged session cookie still fails before any database read.
