---
'@lupinum/better-convex-nuxt': patch
---

Add `grantMcp(t, authId, scopes)` to `better-auth/test`: it gives a person a live MCP grant in `convex-test` and returns the principal that tools receive. It shares the user and session with `signInAs`, in either order.

`signInAs` and `grantMcp` now refuse to run outside a test runner (`AUTH_TEST_RUNNER_REQUIRED` unless `VITEST` is set or `NODE_ENV` is `test`), so a wrapper deployed by mistake cannot create sessions or grants.
