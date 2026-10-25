---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix `organization.requireEmailVerificationOnInvitation: undefined` turning off the rule that an invitation needs a verified address. Only `false` turns it off.
