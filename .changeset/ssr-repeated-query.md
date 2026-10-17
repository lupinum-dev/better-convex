---
'@lupinum/better-convex-nuxt': patch
---

Fix a query that a layout and its page both use calling Convex again during one server render

The page reads the layout's result, so the payload matches the rendered HTML and the layout's status no longer turns `pending`.
