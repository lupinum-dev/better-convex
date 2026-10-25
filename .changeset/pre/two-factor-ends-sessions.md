---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix turning on two-factor leaving the person's other sessions signed in. A session that signed in with a stolen password before then never had to pass the second factor.
