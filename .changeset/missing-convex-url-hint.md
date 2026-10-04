---
'@lupinum/better-convex-nuxt': patch
---

Fix a missing Convex URL giving no hint. The build now warns, and the browser logs which environment variable to set, instead of only failing later with "plugin is not installed".
