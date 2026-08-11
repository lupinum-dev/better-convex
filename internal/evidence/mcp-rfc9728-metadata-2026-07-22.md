# MCP RFC 9728 metadata and challenge binding — 2026-07-22

## Outcome

`P5-010` composes the exact official SDK metadata helpers around one constructor-selected MCP resource
URL and one constructor-selected OAuth authorization-server metadata document.

At construction the adapter:

- clones the resource and OAuth metadata;
- constructs the official `AuthMetadataOptions`;
- invokes `buildOAuthProtectedResourceMetadata` to fail early on invalid issuer configuration;
- derives the single path-aware protected-resource metadata URL with the official helper.

At request time `oauthMetadataResponse` owns both well-known documents. The same derived metadata URL is
passed to the official bearer challenge builder. Request URL authority, Host, query parameters, body
fields, and token contents never select the advertised resource or issuer.

## Executed evidence

```text
pnpm exec vitest run --project=unit test/unit/mcp-convex-handler.test.ts
  1 file, 4 tests passed

pnpm --dir packages/mcp typecheck
pnpm exec eslint packages/mcp/src/handler.ts \
  test/unit/mcp-convex-handler.test.ts
  passed
```

The runtime assertions prove:

- `GET /.well-known/oauth-protected-resource/mcp` returns exact resource, authorization server,
  resource name, and scopes;
- `GET /.well-known/oauth-authorization-server` returns the exact configured authorization metadata;
- a denied MCP request receives `401` with the exact fixed path-aware `resource_metadata` URI;
- an attacker-selected request origin, `resource` query, and `resource` JSON member appear nowhere in
  the challenge;
- a non-HTTPS non-local authorization-server issuer fails before any request.

## Remaining boundary

The official metadata router's method/CORS behavior is retained rather than copied. Origin/Host policy,
no-store shaping, body/response/timeout bounds, exact issuer equality between verified access and the
advertised server, and the full token-class substitution matrix remain `P5-011`/`P5-017`. The handler is
still package-internal until those gates pass.
