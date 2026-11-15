---
'@lupinum/better-convex-functions': patch
---

Fix mutations without a `plan` that failed before their handler when an argument was a `v.int64()` value.

The default plan summary now writes the input in Convex's JSON form: int64 and `v.bytes()` values appear as `{"$integer": …}` and `{"$bytes": …}`.
