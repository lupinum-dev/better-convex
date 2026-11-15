---
'@lupinum/better-convex-functions': patch
---

Fix mutations without a `plan` that failed before their handler when an argument was a `v.int64()` value.

The default plan summary now writes an int64 as its decimal string and `v.bytes()` values as their size (`"<2 bytes>"`).
