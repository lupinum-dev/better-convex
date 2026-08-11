# MCP App authorization chain — 2026-07-22

## Outcome

An MCP App receives no direct authority. The executed neutral chain is:

```text
Vue iframe
  -> official App.callServerTool()
  -> official AppBridge host policy
  -> ordinary authenticated MCP client.callTool()
  -> @better-convex/mcp bearer verification
  -> ordinary tool registration
  -> current application authorization
  -> canonical application operation
```

No Convex client, bearer, cookie, service proof, provider reference, or
application actor enters the iframe.

## Executed cases

The production-browser notes App now executes these cases through the official
App/AppBridge transport:

1. `search_notes` for an authorized tenant reaches the application once and
   returns the authorized note.
2. `search_notes` for a real workspace owned by another tenant reaches the
   application once, is denied by current application state, and does not expose
   the cross-tenant note.
3. `search_notes` after bearer revocation reaches the host and MCP resource but
   is rejected by the verifier before the tool callback. An execution counter
   proves the application operation did not run.
4. `rename_note` is absent from the App host allowlist. The official bridge
   returns a denied result and the call never reaches the MCP client.

The first three calls are visible to the host as exact allowlisted
`{ name, arguments }` requests. No hidden context is forwarded. Only the first
two execute the application search callback. The denied write does not change
the count of calls reaching MCP.

This division is intentional: host policy reduces what an iframe may request,
bearer verification authenticates the MCP caller, and canonical application
state authorizes the effect. No layer treats host approval, Apps capability,
tool annotations, or OAuth scope as sufficient application authority.

## Proof

```text
pnpm exec vitest run test/unit/vnext-mcp-apps-probe.test.ts
  1 file, 1 protocol/browser test passed
```

The proof also scans App HTML, messages, requests, DOM, console captures, and
page errors for unique credential and raw-client sentinels. The broader
two-consumer Apps security matrix remains `P7-011`–`P7-013`.
