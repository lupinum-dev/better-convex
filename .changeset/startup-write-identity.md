---
'@lupinum/better-convex-vue': patch
---

Fix a mutation, form submission or operation started before the first auth result failing with `IDENTITY_CHANGED` when that result finds no session. It now waits and runs as the anonymous visitor, and identity-owned state is kept.
