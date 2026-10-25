---
'@lupinum/better-convex-functions': patch
'@lupinum/better-convex-agents': patch
---

Fix a `trustedRoutes` prefix such as `/api/auth` also vouching for `/api/authz/…` in `unguardedFunctions` and `launchProblems`. A prefix now covers whole path segments.
