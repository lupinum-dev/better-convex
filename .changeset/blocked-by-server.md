---
'@lupinum/better-convex-nuxt': minor
'@lupinum/better-convex-vue': minor
---

Add `blockedBy: 'server'` for a query that the server render did not load, so templates can show a skeleton instead of an empty result.

With `server: false`, or without a Convex URL or Convex session token on the server, the server render and hydration report `status: 'idle'` with `blockedBy: 'server'`; before, they reported `blockedBy: null`. The value becomes `null` when the browser starts the query.
The docs add a "Prefill a form from a query" recipe and show the last value with a notice after a live query error.
Migration: an exhaustive `switch` on `blockedBy` (`ConvexQueryBlockedBy`) must handle `'server'`.
