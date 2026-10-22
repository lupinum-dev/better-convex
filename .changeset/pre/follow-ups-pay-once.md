---
'@lupinum/better-convex-functions': patch
---

Fix a scheduled follow-up of the same action taking a second rate-limit token.

`ctx.scheduler.runAfter` and `runAt` pass on the buckets the call already paid, and an internal action passes them to the mutations it runs. A follow-up of another action or tenant still pays its own token. A chain that schedules itself again pays once per request.
