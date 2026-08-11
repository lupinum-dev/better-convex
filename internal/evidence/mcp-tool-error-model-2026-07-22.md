# MCP tool error model — 2026-07-22

## Outcome

Better Convex now has one small internal execution primitive, `runMcpTool`, for the gap the official SDK
cannot safely decide: unexpected application and infrastructure throws. It catches every thrown value and
returns one static tool failure:

```json
{
  "content": [{ "type": "text", "text": "Tool execution failed" }],
  "isError": true
}
```

It accepts no logger, classifier, mapper, raw error callback, or configuration. Expected domain outcomes
and deliberately projected actionable failures are return values and pass through unchanged. This avoids
an error taxonomy API and prevents message-text classification.

## Ownership matrix

| Failure                                      | Owner and representation                                    |
| -------------------------------------------- | ----------------------------------------------------------- |
| Malformed JSON-RPC / unknown protocol method | Official SDK protocol error                                 |
| Correctable tool input/output schema failure | Official SDK `isError: true` tool result                    |
| Expected domain outcome                      | Application-owned typed structured value                    |
| Safe downstream action the model can take    | Application-owned explicit sanitized `isError: true` result |
| Unknown application/infrastructure throw     | `runMcpTool` static opaque tool failure                     |
| Missing/invalid bearer                       | HTTP OAuth challenge before tool construction               |

## Executed evidence

```text
pnpm exec vitest run --project=unit \
  test/unit/mcp-tool-errors.test.ts \
  test/unit/mcp-schema-boundaries.test.ts
  2 files, 7 tests passed

pnpm --dir packages/mcp typecheck
pnpm exec eslint packages/mcp/src/tools.ts \
  test/unit/mcp-tool-errors.test.ts
```

The sentinel matrix covers an `Error`, an object containing authorization and stack fields, a plain
string throw, and a database-record message through a real official SDK client/server exchange. None
appears in serialized output and no `cause` is attached. A denied cross-tenant lookup and a missing row
produce the identical application-owned `not_found` projection.

## Boundary

`runMcpTool` does not make returned application data safe. Applications must construct minimal expected
results and actionable failures deliberately, and official output schemas validate those results. The
helper only makes unexpected throws opaque. Optional allowlisted diagnostics remain a separate `P5-018`
decision and may never alter this result.

The helper stays internal with the handler until the remaining operation, authorization, passthrough,
consumer, and conformance gates admit the complete MCP surface.
