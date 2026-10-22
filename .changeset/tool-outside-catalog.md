---
'@lupinum/better-convex-functions': patch
'@lupinum/better-convex-agents': patch
---

Fix a tool whose module is not passed to `defineTools` being left out of the tool list without a word.

`launchProblems` now names each operation with a `tool` that no exported `defineTools` result collected, with the module, the export, the tool name and the fix.
