# MCP App resource contract — 2026-07-22

## Decision correction

The server does not conditionally hide or deliver a `ui://` resource based on
the client's Apps capability. That would create two discovery truths and is not
the official progressive-enhancement model.

The selected contract is:

1. one explicit ordinary MCP tool has model-visible text and structured output;
2. its official `_meta.ui.resourceUri` points to one explicitly registered
   `ui://` resource;
3. the resource uses `text/html;profile=mcp-app` and exact official UI metadata;
4. Apps-capable hosts may render the resource;
5. baseline hosts ignore the UI metadata and remain useful through the same
   ordinary tool result;
6. both clients can inspect the same truthful resource contract;
7. unregistered UI resource locators fail through the official SDK.

Capability negotiation therefore controls host presentation, not server-side
authorization or resource existence. The bearer verifier and application
authorization remain identical for both clients.

## Implementation boundary

`@better-convex/mcp` continues to own only authenticated official-SDK handler
composition. Applications register the tool and resource directly on the
official `McpServer`. No Better Convex Apps server adapter, duplicate resource
registry, v1/v2 cast, capability fork, or hand-written UI transport was added.

This is required because the official Apps server helper at
`@modelcontextprotocol/ext-apps@1.7.4` is peer-coupled to the combined MCP SDK
v1, while the selected Better Convex server uses the split official MCP v2 SDK.
The wire metadata schemas from the exact Apps SDK validate the direct v2
registration without forcing both server runtimes into the package.

## Executed proof

`test/unit/vnext-mcp-apps-probe.test.ts` runs two official clients through
the request-scoped `handleMcpRequest()` boundary:

- one advertises the official `io.modelcontextprotocol/ui` extension and MIME
  type;
- one advertises no Apps capability.

The proof verifies identical tool metadata, identical resource bytes and
metadata, resource listing, exact MIME type, official tool/resource metadata
schema validation, rejection of an unknown `ui://` URI, useful baseline
fallback, and successful App rendering only in the capable host harness.

```text
pnpm exec vitest run test/unit/vnext-mcp-apps-probe.test.ts
  1 file, 1 end-to-end protocol/browser test passed
```

The same proof also enforces a 512 KiB HTML bound and credential-free App
boundary. Full cross-consumer packed certification remains `P7-011`–`P7-013`.
