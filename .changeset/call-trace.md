---
'@lupinum/better-convex-functions': minor
---

Add `trace` to call events: work that a call schedules or runs carries the call's trace ID, so one search finds the whole chain.

Convex gives scheduled work a new request ID and no link to the call that scheduled it. With `observe`, the trace travels with the actor to internal operations, internal actions and jobs.
Migration: rename a job argument called `trace`; the name is now reserved.
