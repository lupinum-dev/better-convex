---
'@lupinum/better-convex-functions': patch
'@lupinum/better-convex-agents': patch
---

Change an agent's call that changes data and has no agent rule to wait for a person, and let `ctx.scheduler.cancel` cancel only the caller's own jobs.

Before, a mutation, action or internal mutation without an entry in `definePolicy({ agents })` ran for an agent on its own. A query without an entry still runs. The tool catalog shows such a write tool with `approval: 'always'`.
`ctx.scheduler.cancel` fails with `NOT_FOUND` for a job that another person or agent scheduled. An action cancels only the jobs it scheduled in the same call.
Migration: give `'allow'` to each write action that agents may run on their own, also to an internal mutation that an allowed tool runs.
