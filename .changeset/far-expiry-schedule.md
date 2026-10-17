---
'@lupinum/better-convex-nuxt': patch
---

Fix creating a session or verification row that expires more than 5 years ahead

Convex refuses to schedule a job that far ahead, so the write failed. The expiry job now runs within a year and schedules itself again until the row expires.
