---
'@lupinum/better-convex-nuxt': patch
---

Fix a page opened again in the browser showing the data of its earlier visit

Since rc.5, a query read the value an earlier page had left in Nuxt's payload after client-side navigation, with `status` `'success'`, until the live result arrived. A form filled from that first value kept the old data.
Outside hydration the browser now fetches the query as before rc.5; one server render still calls a repeated query once.
