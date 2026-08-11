# MCP preconfigured bearer profile — 2026-07-22

## Decision

`@better-convex/mcp` now distinguishes two authorization profiles at construction:

- `oauth` serves and binds the locked-RC OAuth protected-resource and authorization-server metadata;
- `preconfigured-bearer` accepts an application-managed bearer credential already configured in the
  client, and deliberately serves no OAuth discovery metadata.

The second profile exists because Ginko's current MCP credential is a revocable application API key,
not an OAuth access token. Treating it as OAuth would advertise endpoints and protocol behavior that do
not exist. Requiring a new authorization server would replace a working application-owned credential
model without improving the selected Convex resource boundary.

The profile does not create or store credentials. It requires a canonical HTTPS credential issuer,
passes the raw bearer only to the provider-neutral verifier, binds the result to the exact MCP resource,
enforces expiration and optional scopes through the official SDK, and gives application callbacks only
the existing frozen allowlisted access context.

## Primary-source basis

- MCP authorization specification `2025-11-25`: OAuth-protected servers publish RFC 9728 metadata and
  challenges so clients can discover the authorization server.
- Official TypeScript SDK client documentation at the locked-RC checkpoint: callers with API keys,
  gateway tokens, or other externally managed bearer credentials may supply a token callback without
  running the OAuth flow.

The profile therefore does not claim OAuth conformance. It is the explicit out-of-band credential path
supported by MCP clients.

## Executed evidence

```text
pnpm exec vitest run test/unit/mcp-convex-handler.test.ts \
  test/unit/mcp-operation-mapping.test.ts \
  test/security/mcp-credential-passthrough.test.ts \
  test/mcp/mcp-boundaries.test.ts
  4 files, 22 tests passed

pnpm --filter @better-convex/mcp typecheck
  passed

pnpm --filter @better-convex/mcp build
  passed
```

The focused proof covers a successful official client connection, missing-token challenge without
`resource_metadata`, absent OAuth discovery routes, exact issuer/resource/scopes, malformed issuer
construction failure, and unchanged OAuth behavior.
