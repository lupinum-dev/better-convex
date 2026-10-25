---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix a password reset, an address verification or an OIDC logout failing for a person with more than 128 sessions, which left every session alive.
