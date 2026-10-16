---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix server rendering of a paginated first page that Convex marks `SplitRequired`

The server splits the page once into two bounded pages and renders their rows instead of a `PAGINATION_SPLIT_REQUIRED` error.
When a half still needs a split, the list renders as not fetched and the browser loads it.
After hydration the rows stay on screen while the live list splits the page.
