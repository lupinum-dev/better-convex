---
'@lupinum/better-convex-nuxt': patch
---

Add `allowExpiredToken` to `auth.requireMcpPrincipal`: it skips only the access token's own expiry, so work a person approves after the agent's 10-minute token expired can still run. The session, client, resource and consent must still be live.
