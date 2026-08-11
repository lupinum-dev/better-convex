# MCP topology semantic conformance — 2026-07-20

## Scope

This closes private-lab task `P1-008`. It proves that the independently implemented Nitro-native and
Convex-native candidates expose the same neutral application semantics through the official MCP SDK. It
does not hide their different runtime, identity, transport, or deployment boundaries behind an
abstraction and does not select a winner.

The only shared topology input is the immutable data in
`internal/labs/mcp-topology/conformance-vectors.ts`. Each candidate retains its own server construction,
authorization boundary, operation mapping, transport, and application adapter.

## Executed matrix

The unchanged shared vectors prove both candidates:

- list exactly `delete_workspace`, `generate_report`, `rename_note`, and `search_notes`;
- return the allowed tenant's note and read its `note://` resource;
- produce a text fallback that is exactly the JSON serialization of validated structured content;
- apply an idempotent rename once and return the same result for an exact replay;
- reject reuse of the same request key with different arguments as `IDEMPOTENCY_CONFLICT`;
- deny a cross-tenant search as the application-owned `ACCESS_DENIED` outcome;
- reject a caller-supplied `subject` as malformed input through the strict official tool schema.

Candidate-specific assertions remain intentionally outside the shared vectors. The Nitro probe continues
to prove concurrent request-scoped actors and response-token absence. The Convex probe continues to prove
that a canonical database role change takes effect on the next call without reminting the lab bearer.

## Reproduction

```sh
pnpm exec vitest run test/unit/vnext-mcp-nitro-probe.test.ts --reporter=verbose
pnpm exec vitest run --config internal/labs/mcp-topology/convex/vitest.config.ts --reporter=verbose
pnpm exec eslint internal/labs/mcp-topology/conformance-vectors.ts internal/labs/mcp-topology/convex/probe.test.ts test/unit/vnext-mcp-nitro-probe.test.ts
```

Result on 2026-07-20: the Nitro test passed one test over the official HTTP client/handler transport; the
Convex test passed one test against a freshly deployed local Convex HTTP action; focused lint passed. The
Convex command requires permission to bind and call an isolated loopback backend.

## Conclusion

There is no semantic reason yet to favor either topology. Both can preserve explicit application-owned
operations, current authorization, strict identity-free input, structured MCP results, useful text
fallbacks, and truthful idempotency outcomes. The next differentiating evidence is adversarial HTTP
transport behavior, followed by OAuth resource-server behavior and the Nitro-only exact-call proof cost.
