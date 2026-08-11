# MCP structured-result and resource proof — 2026-07-22

## Decision

`@better-convex/mcp` adds no result builder, resource registry, or resource-template wrapper. The pinned
official MCP SDK already owns all three protocol surfaces needed by the selected Convex-native handler:

- tool output-schema validation;
- `structuredContent` plus ordinary text content in the same result;
- exact resource and resource-template registration and reads.

Applications write the short human/model fallback because only the application knows which fields make
the result useful. Serializing the structured object as the fallback is not required and is deliberately
avoided in the maintained handler proof.

## Executed proof

The official client calls `handleMcpRequest` through the official streamable HTTP
transport and proves:

- `search_notes` returns schema-validated structured content and `1 note matched: Alpha.` as its complete
  text fallback;
- `rename_note` returns schema-validated structured content and a concise write receipt as text;
- a client that reads only `content` receives a useful result without inspecting `structuredContent`;
- `resources/templates/list` advertises the exact `note://{id}` template;
- `resources/read` resolves `note://note-1` after the write through the same request-scoped application
  state;
- the resource URI and MIME type survive the official SDK unchanged;
- existing schema-boundary tests reject oversized and shape-invalid structured output;
- existing transport tests bound the complete encoded response to 1 MiB.

Commands:

```text
pnpm exec vitest run test/unit/mcp-convex-handler.test.ts test/unit/mcp-schema-boundaries.test.ts test/unit/mcp-transport.test.ts --reporter=dot
pnpm --filter @better-convex/mcp typecheck
pnpm run check:boundaries
```

## Public API admission result

Rejected: a Better Convex result helper or resource abstraction would duplicate official SDK behavior,
create a second registration vocabulary, and could not generate an application-meaningful fallback.
Direct SDK registration remains the smaller and more protocol-faithful contract.
