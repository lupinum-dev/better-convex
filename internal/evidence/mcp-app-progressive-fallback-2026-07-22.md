# MCP App progressive fallback — 2026-07-22

## Outcome

The neutral `search_notes` tool has one semantic result independent of MCP Apps:

```json
{
  "content": [{ "type": "text", "text": "1 note matched." }],
  "structuredContent": {
    "matches": [
      {
        "id": "note-a",
        "title": "Alpha",
        "body": "Alpha body",
        "revision": 1,
        "uri": "note://note-a",
        "workspaceId": "workspace-a"
      }
    ]
  }
}
```

An official client that advertises no Apps extension calls the tool and receives
that exact bounded text and structured result. It does not need to render or
understand the `ui://` resource. An Apps-capable host receives the same tool
contract and may additionally render the notes dashboard.

The tool's `_meta.ui` field is presentation metadata. It does not alter tool
visibility, bearer verification, scope ceilings, application authorization,
output validation, or fallback semantics.

```text
pnpm exec vitest run test/unit/vnext-mcp-apps-probe.test.ts
  1 file, 1 protocol/browser test passed
```

This proves progressive enhancement for the neutral model-visible tool. Ginko's
publish-impact fallback remains part of `P7-010` and the shared matrix.
