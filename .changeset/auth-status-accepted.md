---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix `useConvexAuth()` showing a user as signed in before Convex accepted the token.
`status` now changes only after Convex accepts the session, uses `'pending'` instead of `'loading'`, and `pending` follows `status` as in every other composable. A client that keeps failing to start no longer retries in a loop, and a library authentication error keeps its code.

Migration: replace `status === 'loading'` with `status === 'pending'`. To disable a button while a sign-in or sign-out runs, keep your own `ref` around the call; `pending` no longer covers it. Plain Vue auth adapters report `'pending'` instead of `'loading'`.
