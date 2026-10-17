---
'@lupinum/better-convex-nuxt': patch
---

Add a limit per email address for email codes, so requests from many IP addresses cannot flood one inbox

Each address gets the same limit as each client IP (`emailOTP.rateLimit`, three per minute by default), counted across `/email-otp/send-verification-otp` and the code-based password reset routes. A blocked request returns `429` with `X-Retry-After`. The counter stores a hash of the address.
