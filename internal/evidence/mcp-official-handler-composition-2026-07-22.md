# Official MCP handler composition — 2026-07-22

## Outcome

`P5-006` proves the selected Convex-native adapter can compose the exact official beta.5 handler and
bearer middleware without creating a Better Convex protocol implementation or tool registry.

An application factory still creates `McpServer` directly and registers `search_notes` and
`rename_note` directly with the official SDK. Better Convex contributes only:

1. official bearer-header parsing and challenge projection;
2. the already-proved provider-neutral verifier normalization;
3. a request-local closure carrying the Convex action context and safe access context into the
   application factory;
4. official `createMcpHandler` construction using its stateless legacy posture.

No tool name, schema, annotation, result, Convex function reference, or application authorization rule is
registered by Better Convex.

## Credential termination

The official bearer helper temporarily requires an `AuthInfo` containing the raw token. The adapter uses
that object only inside the authentication call and deliberately does not pass it to
`McpHttpHandler.fetch`. The official server factory and tool callback therefore observe no
`ctx.http.authInfo`; they receive only the frozen allowlisted `McpAccessContext` through the
application-owned closure.

Verifier failures are converted to the official `invalid_token` OAuth error with a static message. The
official challenge response is returned before an application server is created.

## Executed evidence

```text
pnpm exec vitest run --project=unit \
  test/unit/mcp-convex-handler.test.ts \
  test/unit/mcp-access-verifier.test.ts
  2 files, 7 tests passed

pnpm --dir packages/mcp typecheck
pnpm exec eslint packages/mcp/src/handler.ts \
  test/unit/mcp-convex-handler.test.ts
  passed
```

The handler proof executed a pinned `2026-07-28` official client through the web-standard official
transport and verified:

- official discovery and tool listing;
- explicit structured `search_notes` read;
- explicit structured `rename_note` write and canonical application-state mutation;
- expected `(issuer, subject)`, client, and scope provenance in the application closure;
- raw bearer/provider-reference absence from access values, tool context, and every captured response;
- wrong bearer returns `401` plus `WWW-Authenticate: Bearer`;
- denied requests cause zero application factory calls.

## Deliberate limits

The handler remains package-internal. It is not yet a public runtime export because the complete hosting
boundary still needs fixed Origin/Host behavior, body/response/timeout bounds, no-store policy, protected
resource metadata, exact challenge URI, and token-class tests (`P5-010`, `P5-011`, `P5-017`). This avoids
shipping a partially secure public entry and then maintaining compatibility for it.
