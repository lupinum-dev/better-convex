---
'@lupinum/better-convex-nuxt': patch
---

Fix a deploy-time `NUXT_PUBLIC_CONVEX_URL` keeping the build's Convex site URL, which sent auth requests to a different deployment than the WebSocket.
The module now stores only an explicit `siteUrl` and derives it from the effective URL at runtime. Runtime config is normalized once per config object instead of on every read, and an environment override that disables `convex.auth` in an auth build now fails with a message that names the cause.
