---
'@lupinum/better-convex-functions': patch
---

Fix work that an allowed agent tool scheduled failing with `AGENT_DISABLED` after the agent's turn moved on, its run ended or its MCP access token expired.

Scheduled work is part of the call that scheduled it. It still checks the agent's grant, the person and their role, so turning the agent off or disconnecting the host stops it.
