---
'@lupinum/better-convex-nuxt': patch
---

Fix the `better-auth/test` helpers after a revoke or an expiry. `grantMcp` gives
a consent it makes again a fresh ID, so a principal from before the revoke stays
refused, as after a real reconnect. `signInAs` no longer reuses an expired
session; it signs in with a fresh one.
