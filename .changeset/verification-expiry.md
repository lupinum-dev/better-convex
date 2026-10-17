---
'@lupinum/better-convex-nuxt': patch
---

Fix email-code sign-in failing with a 500 for everyone once more than 128 expired codes exist

Anyone could cause this without an account by asking for 129 codes, and it stayed until an operator deleted rows. Better Auth no longer deletes expired rows during a request (`verification.disableCleanup`). The auth component deletes each code, link and OAuth state at its expiry with a new scheduled function, `expireVerification`, which also deletes older expired rows in batches of 128, so a blocked deployment recovers after the upgrade.
Using a code no longer fails when one address has more than 128 codes.
Migration: with a local auth component, export `expireVerification` from `convex/betterAuth/adapter.ts`. The schema and its indexes do not change.
