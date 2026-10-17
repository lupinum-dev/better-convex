---
'@lupinum/better-convex-nuxt': patch
---

Fix the browser retrying the token exchange on every focus and tab event after an auth outage

When authentication is reported temporarily unavailable, the browser now tries again on its own, after 2 s and then up to 60 s apart (never sooner than Retry-After), until it gets a token.
Better Auth's re-reads of the unchanged session (window focus, reconnect, other tabs) no longer start another full token attempt in every tab; a changed session still applies at once.
