---
'@lupinum/better-convex-nuxt': minor
---

Add a limit for new guests: a bucket of 10 per client address that refills one every 6 minutes, by default.

Set it with `experimental.anonymous.rateLimit: { window, max }` (`window` 60 to 86,400 seconds, `max` 1 to 1,000).
An IPv6 address counts by its /64 network, as in Better Auth's own limits.
