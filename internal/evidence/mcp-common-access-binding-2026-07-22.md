# MCP common access binding prerequisite — 2026-07-22

## Outcome

The common MCP boundary now binds a verifier result to both constructor-selected authorities:

- the returned issuer must exactly equal the configured authorization-server issuer;
- the returned resource must exactly equal the configured MCP resource;
- expiration, client, subject, scopes, and canonical string requirements remain enforced;
- only the HTTP `Authorization: Bearer` header is consulted.

This prevents an otherwise-valid provider adapter from returning provenance for a foreign issuer while
the resource advertises a different authorization server. A bearer placed in the request query or JSON
body is ignored and receives the same `401` challenge as a missing credential.

## Executed evidence

```text
pnpm exec vitest run --project=unit \
  test/unit/mcp-access-verifier.test.ts \
  test/unit/mcp-convex-handler.test.ts
  2 files, 10 tests passed

pnpm --dir packages/mcp typecheck
pnpm exec eslint packages/mcp/src/access.ts packages/mcp/src/handler.ts \
  test/unit/mcp-access-verifier.test.ts test/unit/mcp-convex-handler.test.ts
  passed
```

The new negatives prove foreign issuer denial, zero application-factory calls, header-only transport,
and raw bearer absence from responses.

## Honest completion boundary

This does not complete `P5-011`. The base package treats verification as an injected capability and
cannot infer JWT class, signature, audience, or raw claim shape after the verifier returns. Those
properties must be proven against the real Better Auth adapter and one external adapter. The ledger now
makes those adapter tasks explicit dependencies instead of accepting a fake token-class matrix as
cryptographic evidence.
