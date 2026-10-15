---
'@lupinum/better-convex-nuxt': patch
---

Fix signed-in clients being sent to the sign-in page by the `/convex/token` rate limit

The auth rate limit now drains steadily (a leaky bucket with the same rate per rule), so steady traffic below the limit is never refused.
The browser no longer treats a 429 from the token exchange as a sign-out: it waits for Retry-After, with exponential backoff and jitter, while the session is still valid.
Retries after other transient token failures now back off instead of repeating at once.
