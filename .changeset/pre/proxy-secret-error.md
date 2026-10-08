---
'@lupinum/better-convex-nuxt': patch
---

Fix a missing or too short `BCN_AUTH_PROXY_IP_SECRET` being reported as "Auth proxy could not reach the configured Convex auth server". The auth proxy now rejects with code `BCN_AUTH_PROXY_IP_SECRET_INVALID` before contacting Convex.
