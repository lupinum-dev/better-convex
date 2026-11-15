---
'@lupinum/better-convex-nuxt': minor
---

Add `auth.deleteUser(ctx, userId)` to delete another user from a Convex mutation or action.

It runs Better Auth's own user deletion with the app's `onDelete` triggers, so a user projection erases the app user. It checks no permission: call it from an internal function after your own check.
