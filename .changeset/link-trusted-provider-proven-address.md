---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix a provider in `account.accountLinking.trustedProviders` linking to a user whose address nobody verified. The link now fails with `AUTH_LINK_UNVERIFIED_EMAIL` until the address is verified.
