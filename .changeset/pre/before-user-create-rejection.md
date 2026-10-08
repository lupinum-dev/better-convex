---
'@lupinum/better-convex-nuxt': patch
---

Fix `beforeUserCreate`: the pending user no longer claims an `id` it never has, and a hook that throws or returns an invalid identity is now logged as `AUTH_USER_CREATE_REJECTED`. The docs now say that a rejected sign-up gets Better Auth's generic sign-up response, so the browser cannot tell who may sign up.
