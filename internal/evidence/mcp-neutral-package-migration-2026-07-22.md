# Neutral consumer MCP package migration — 2026-07-22

## Outcome

The deployed neutral notes consumer now imports `handleMcpRequest` and `runMcpTool` from
`@better-convex/mcp`. Its direct official SDK registrations remain application-owned, but the fixture no
longer owns a bearer middleware, metadata handler, request-body reader, timeout loop, protocol handler,
or per-request SDK cleanup path.

The hard cut removed 199 lines from the former fixture MCP file and replaced them with 136 lines focused
on schemas, explicit tools/resources, safe text projection, and canonical Convex operations. There is no
legacy switch, generic dispatcher, duplicate parser, or token bridge.

## Gaps found and closed by the migration

The real consumer exposed four missing hosting obligations:

1. Loopback HTTP resources are required for anonymous local Convex development. Remote plaintext
   resources remain rejected.
2. A resource can declare baseline required scopes; the official verifier now returns the correct `403
insufficient_scope` challenge before protocol parsing.
3. The selected resource route is exact. Query-bearing, wrong-path, encoded, and browser-Origin requests
   fail empty and `no-store` before verification or application construction.
4. Every request-created official SDK handler is closed in `finally`.

No general transport configuration or second registry was added.

## Executed evidence

```text
pnpm exec vitest run --config internal/labs/mcp-topology/convex/vitest.config.ts --reporter=verbose
  1 deployed Convex test passed
  OAuth metadata/challenges, token classes, scopes, route/framing/body limits, abort recovery,
  modern/legacy negotiation, tools, resources, Apps metadata, live role change, tenant isolation,
  idempotency, concurrency, and bearer absence passed

pnpm exec vitest run test/unit/mcp-access-verifier.test.ts \
  test/unit/mcp-convex-handler.test.ts test/unit/mcp-operation-mapping.test.ts \
  test/unit/mcp-tool-errors.test.ts --reporter=dot
  focused package boundary passed

node scripts/check-package-exports.mjs --package mcp
  source and packed runtime/type graphs matched the reviewed official-SDK dependency

node scripts/check-candidate-apps.mjs --package mcp
  exact tarball installed in a clean Node 22 type/runtime consumer;
  installed bytes and two-value runtime export allowlist matched
```

The package still claims only experimental locked-RC behavior. Final specification and protected
artifact certification remain later gates.
