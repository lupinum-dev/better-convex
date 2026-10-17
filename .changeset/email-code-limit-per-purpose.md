---
'@lupinum/better-convex-nuxt': patch
---

Fix email-code and auth rate limits that refused too much

Count email-code requests per address and code purpose, so verification requests for a verified address no longer block sign-in codes.
Fix the leaky-bucket limit so a client that waits exactly `retryAfter` seconds is admitted, also when the window does not divide evenly by `max`.
