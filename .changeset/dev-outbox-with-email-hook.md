---
'@lupinum/better-convex-nuxt': minor
---

Change the dev outbox to also log auth email when the `email` hook is set, on a loopback `SITE_URL`.

The library writes the log line first and then calls the hook, so local work shows the code even when the hook has no provider key. On any other `SITE_URL` nothing is logged, as before.
