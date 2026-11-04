---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Change the Better Auth peers to 1.7.16, the security release of 2026-11-03

Better Auth 1.7.16 fixes 12 advisories, among them revoked sessions that stayed valid with the cookie cache, OAuth sign-in that read a string `email_verified` as verified, and email-change and verification links that worked for another account. See https://better-auth.com/blog/security-release-2026-11-03.

Migration: install `better-auth`, `@better-auth/core` and `@better-auth/oauth-provider` at exactly `1.7.16`. With pnpm's 24-hour quarantine, add those exact versions to `minimumReleaseAgeExclude` until 2026-11-05, or install after that date.

The module now depends on `@nuxt/kit` 4.6.4 and `jose` 6.2.15, and is tested on Nuxt 4.6.4 (with nitropack 2.13.6, which fixes Nuxt and Nitro advisories).
