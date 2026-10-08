---
'@lupinum/better-convex-nuxt': patch
---

Fix the signed-in user's Convex token appearing in the SSR page payload. The server keeps it for its own queries; the browser already fetched its own token.
