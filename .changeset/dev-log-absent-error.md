---
'@lupinum/better-convex-vue': patch
---

Fix the development log "failed with an unclassified error: undefined" when code normalizes an error that is not there

`normalizeConvexError(undefined)` and `normalizeConvexError(null)` still return the `unknown` error, but no longer log in development: there is no original error to show.
