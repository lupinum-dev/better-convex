---
'@lupinum/better-convex-functions': patch
'@lupinum/better-convex-agents': patch
---

Fix a tool dropping `null` for an optional field that accepts `null`, so a model could not clear the field. A `null` for a field that cannot be `null` still means the field is left out.
