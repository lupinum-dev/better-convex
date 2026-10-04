---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
'@lupinum/better-convex-mcp': patch
---

Fix the MCP Inspector example in "Connect ChatGPT and Claude" (also in the packaged agent docs): the Inspector client now allows `offline_access`, which Inspector requests by default. Without it, authorization failed with `invalid_scope`.
