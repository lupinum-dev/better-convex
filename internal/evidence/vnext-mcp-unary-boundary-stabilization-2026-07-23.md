# vNext MCP unary boundary stabilization evidence — 2026-07-23

## Scope and decision

This closes audit findings `F-006`, `F-007`, and `F-008` and stabilization tasks `S4-001` and
`S4-002`.

The MCP resource now authenticates the original request and then discards it. The official SDK
receives a new bounded request containing only:

- the already validated method and exact configured URL;
- `accept` and `content-type`;
- `MCP-Protocol-Version`, `MCP-Method`, `MCP-Name`, and `MCP-Param-*` routing headers;
- the bounded body and shared deadline/abort signal.

Authorization, cookies, proxy authorization, forwarding credentials, content length, and unrelated
headers cannot reach `createServer`, tool callbacks, or resource callbacks. The sanitized
`McpAccessContext` remains the only application-visible access provenance.

The adapter now selects the official SDK's strict modern route. It forces tool/resource
`listChanged` and resource `subscribe` capabilities to false, rejects stateful subscription methods
before application construction, and rejects application servers that register capabilities outside
tools and resources. The legacy stateless route is deleted from the selected profile.

Every supported response must be finite `application/json`. SSE and other response media types fail
closed; declared and streamed output remain bounded to one MiB; the 30-second deadline remains active
through body consumption; caller abort cancels body reads. Diagnostic sinks are awaited and their
failures remain non-authoritative.

## Executed proof

```text
pnpm exec vitest run --project=security \
  test/security/mcp-credential-passthrough.test.ts
  1 file, 1 test passed

pnpm exec vitest run --project=unit \
  test/unit/mcp-access-verifier.test.ts \
  test/unit/mcp-convex-handler.test.ts \
  test/unit/mcp-operation-mapping.test.ts \
  test/unit/mcp-schema-boundaries.test.ts \
  test/unit/mcp-tool-errors.test.ts \
  test/unit/mcp-transport.test.ts \
  test/unit/vnext-mcp-sdk-transport.test.ts
  7 files, 46 tests passed

pnpm exec vitest run --project=mcp
  8 files, 60 tests passed

pnpm --dir packages/mcp typecheck
pnpm --dir packages/mcp build
node scripts/check-boundaries.mjs
node scripts/fixtures/mcp-packed-credential-proof.mjs
  passed
```

The packed-candidate consumer now copies and executes the same credential-sentinel proof after exact
installed-byte comparison. It is wired into `scripts/check-mcp-package-consumer.mjs`; execution
against a successor tarball remains deliberately deferred to `S6-003` because the stabilization
freeze prohibits generating a beta.6/beta.0 artifact.

The official-client matrix proves discovery, explicit tools, resource templates and reads, exact
access provenance, false stateful capability flags, denied direct subscription methods, modern-only
serving, schema/output validation, request and response bounds, timeout, abort, and static failure
projection. Unique bearer, cookie, proxy, forwarded credential, provider-reference, raw cause, and
diagnostic-failure sentinels are absent from callback headers, arguments, results, diagnostics, logs,
and response bodies.
