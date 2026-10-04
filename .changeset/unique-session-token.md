---
'@lupinum/better-convex-nuxt': patch
---

Fix the Convex client skipping its proactive token refresh. Two session tokens minted in the same second were identical, and Convex schedules a refresh only after it receives a new token, so the first update after the token expired needed a reconnect. Each token now has a unique `jti`.
