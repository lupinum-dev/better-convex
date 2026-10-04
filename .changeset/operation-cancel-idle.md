---
'@lupinum/better-convex-vue': patch
---

Fix `useConvexOperation` showing `CANCELLED` as an error after `op.cancel()`. The state now returns to `'idle'`, as it does after `reset()` and a cancelled upload.
