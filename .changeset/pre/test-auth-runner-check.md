---
'@lupinum/better-convex-nuxt': patch
---

Change `createBetterConvexTestAuth` from `better-auth/test` to refuse to run outside a test runner (`AUTH_TEST_RUNNER_REQUIRED` unless `VITEST` is set or `NODE_ENV` is `test`), like `signInAs` and `grantMcp`. Before, a local development backend on `localhost` passed its loopback check and installed Better Auth's test helpers.

Tests: this change can make a wrong app test fail, for example a script that calls `createBetterConvexTestAuth` outside Vitest. Run it under your test runner. A change to a test entry that only makes a wrong test fail ships in a normal release with a line like this one.
