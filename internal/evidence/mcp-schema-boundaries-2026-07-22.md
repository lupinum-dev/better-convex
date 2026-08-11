# MCP and canonical schema boundaries — 2026-07-22

## Outcome

No Better Convex schema wrapper was added. Explicit tool registrations use the official SDK's strict
input and output schemas, while canonical application operations independently validate the same domain
constraints before reading or writing state.

The proof establishes this flow:

```text
untrusted tool arguments
  -> official MCP strict/bounded input schema
  -> explicit application operation
  -> canonical application/Convex validation
  -> minimized public projection
  -> official MCP output schema
  -> bounded transport response
```

Schema validation is not authorization. The application still loads current actor, tenant, resource,
role, delegation, and operation state independently.

## Executed evidence

```text
pnpm exec vitest run --project=unit \
  test/unit/mcp-schema-boundaries.test.ts
  1 file, 2 tests passed

pnpm exec vitest run \
  --config internal/labs/mcp-topology/convex/vitest.config.ts
  1 file, 1 deployed Convex-native probe passed
```

The unit proof uses distinct edge and canonical schemas. It proves:

- unknown fields, oversized strings, and wrong types are rejected before the operation callback;
- direct canonical-operation calls reject the same oversized and unknown-field inputs;
- valid canonical rows are projected without a private owner-email sentinel;
- output that exceeds the declared public schema becomes an SDK-owned tool error;
- neither rejected input values nor invalid output values are echoed in the tool result.

The deployed Convex-native fixture uses strict Zod schemas at official MCP registration and Convex
validators plus operation-specific bounds in its internal query/mutation functions. Its full modern and
legacy tool/resource workload, HTTP adversarial matrix, tenant isolation, mutation, and live role-change
checks passed after the shared proof.

## Simplification result

The official SDK already owns edge input and output validation. Convex already owns canonical argument
validation, and the application owns domain bounds. Adding another registry, parser, or generic schema
adapter would duplicate those sources of truth. The admitted pattern is direct explicit schemas at both
real boundaries.

The SDK currently represents correctable input/output schema failures as `isError: true` tool results.
`P5-008` separately defines and proves the safe error projection; this task does not stabilize the SDK's
English validation text as a Better Convex contract.
