---
'@lupinum/better-convex-nuxt': minor
---

Add `user.isAnonymous` to the `beforeUserCreate` callback, so an invite-only app can let guests from `experimental.anonymous` through and still check everyone else. It is always `false` without that option.
