# MCP live application authorization — 2026-07-22

## Invariant

An MCP access token or preconfigured credential establishes credential provenance and a scope ceiling.
It does not grant current application authority. Every effect must re-read the application's canonical
actor, tenant, resource, and grant state; writes perform that check inside the mutation that applies the
effect.

Better Convex deliberately provides no roles database or authorization DSL. The official-SDK handler
passes only frozen issuer, subject, client, resource, and scope metadata to explicit application tool
registrations. The application operation remains the authority boundary.

## Executed evidence

```text
pnpm exec vitest run test/mcp/mcp-live-authorization.test.ts \
  test/unit/mcp-operation-mapping.test.ts \
  test/security/mcp-credential-passthrough.test.ts

3 files, 15 tests passed
```

The existing OAuth/MCP application matrix rejects current session deletion, client disable/deletion,
consent deletion, membership removal, role downgrade, delegation revocation/expiry, tenant change,
client-resource unlink, resource disable, insufficient token/client/resource/consent/delegation scope,
foreign resource ownership, and absent/expired/used/mismatched approval.

Ginko branch `codex/better-convex-mcp-pilot` additionally passed its full 1,245-test check at commit
`1023ef40`. Its component tests prove that credential hash resolution, current scopes, expiry, and
revocation are read from canonical rows; editor draft writes require a current member role, scope, and
active agent run in the same component mutation; viewer writes and direct MCP publication fail. Its
Convex-native MCP pilot proves current member denial and cross-tenant denial stay opaque at the protocol
boundary.

No authority field was added to a token, handler cache, projection, or Better Convex table.
