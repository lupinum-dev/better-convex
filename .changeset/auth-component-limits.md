---
'@lupinum/better-convex-nuxt': patch
---

Fix stale rate-limit cleanup, revoked-session counts and test sign-in, legacy account fields, newest OAuth connections, renewal scope limits, incomplete auth initialization, and team browser-check signing keys.

For local auth components, regenerate the schema and export `pruneRateLimits` from the component adapter.
