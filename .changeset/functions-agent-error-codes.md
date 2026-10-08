---
'@lupinum/better-convex-functions': patch
'@lupinum/better-convex-agents': patch
---

Fix tools showing an agent the code and message of any `ConvexError`: an agent now sees only the codes of `ErrorCode`, and any other code becomes `FAILED`.
