# MCP explicit operation mapping proof — 2026-07-22

## Outcome

Each MCP tool is registered directly with the official SDK and its callback invokes one fixed generated
Convex function reference with one fixed operation kind. Neither the tool input nor the request selects
a Convex function name, operation kind, dispatcher route, or raw function reference.

No Better Convex dispatcher, tool-definition DSL, registry, or wrapper was added. The application-owned
closure is the explicit mapping and remains visible in ordinary code review.

## Executed substitution matrix

`test/unit/mcp-operation-mapping.test.ts` runs through `handleMcpRequest`, the official
streamable HTTP client, and official server registration API. It proves:

- `search_notes` reaches only the fixed `notes:search` query reference;
- `rename_note` reaches only the fixed `notes:rename` mutation reference;
- injected `operation` and `functionName` fields fail strict input validation before either application
  operation runs;
- an unregistered tool name cannot select the internal function name;
- verified identity provenance is projected explicitly and raw bearer data is absent from operation
  arguments;
- query and mutation calls remain distinguishable in the application boundary.

Commands:

```text
pnpm exec vitest run test/unit/mcp-operation-mapping.test.ts test/unit/mcp-convex-handler.test.ts --reporter=dot
pnpm --filter @better-convex/mcp typecheck
pnpm run check:boundaries
```

## Admission decision

Rejected: a generic dispatcher or mapping helper would make the permitted target less obvious, create a
second operation registry, and increase substitution risk. Direct official registration plus fixed
generated Convex references is the maintained pattern.
