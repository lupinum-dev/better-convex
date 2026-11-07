---
'@lupinum/better-convex-nuxt': patch
---

Change `better-convex-nuxt auth init` to keep the auth files when every one of them already exists, instead of stopping.

A rerun after you edited `convex/auth.ts`, or a run in a starter that ships its own auth files, now continues with the schema check, the secrets and the signing key. A partial setup still stops without changes.
