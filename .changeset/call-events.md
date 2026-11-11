---
'@lupinum/better-convex-functions': minor
---

Add `defineFunctions({ observe: true })`: each call writes one JSON line with its action, actor, tenant, outcome, code and rows written, for a Convex log stream.

Queries write a line only when they fail. `ctx.log.set` adds the app's own IDs to the line, and does nothing without `observe`.
One transaction writes one line: operations a query or mutation runs with `ctx.run*` write none of their own; the caller's line counts their rows and fields.
Migration: rename a job argument called `inner`; the name is now reserved.
