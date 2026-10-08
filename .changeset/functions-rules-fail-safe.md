---
'@lupinum/better-convex-functions': patch
---

Fix row rules and internal operations that let an honest mistake fail open.
`allOf()` and `anyOf()` without a rule throw at definition, and `internalQuery` and `internalMutation` check their `action` like the public builders.
A `custom` or `publicRead` rule gets a frozen copy of the row, so it cannot change the row that later write checks read.
An ID-shaped string in a union member that holds text no longer names a tenant.
