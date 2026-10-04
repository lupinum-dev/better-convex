---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix the Convex client skipping its proactive token refresh. Two session tokens minted in the same second were identical, and Convex schedules a refresh only after it receives a new token, so the first update after the token expired needed a reconnect. Each token now has a unique `jti`.

The client now keeps its first confirmed token until the scheduled refresh (Convex `initialAuthTokenReuse`). Before, it fetched a second token right after connecting, which cost one more token request per page load and re-ran every authenticated query.
