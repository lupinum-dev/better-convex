---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
'@lupinum/better-convex-mcp': patch
---

Fix the MCP Inspector example in "Connect ChatGPT and Claude" and in the packaged agent docs. Inspector requests `offline_access` by default, and the example client now allows it. Before, authorization failed with `invalid_scope`.
