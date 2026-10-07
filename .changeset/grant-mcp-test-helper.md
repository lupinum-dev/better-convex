---
'@lupinum/better-convex-nuxt': patch
---

Add `grantMcp(t, authId, scopes)` to `better-auth/test`: it gives a person a live MCP grant in `convex-test` and returns the principal that tools receive. It shares the user and session with `signInAs`, in either order.
