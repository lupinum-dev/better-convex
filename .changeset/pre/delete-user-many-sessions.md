---
'@lupinum/better-convex-nuxt': patch
---

Fix deleting a user with 128 or more sessions failing with `AUTH_BULK_OPERATION_LIMIT_EXCEEDED`

A user with more than 64 sessions is now deleted without its sessions. They stop working at once, because every session check reads the user, and the scheduled `expireSession` function deletes them right after, 128 per run. Session `onDelete` triggers do not run for those sessions, as for expired ones.
