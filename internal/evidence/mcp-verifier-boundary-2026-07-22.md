# Provider-neutral MCP verifier boundary — 2026-07-22

## Outcome

`P5-003` proves the narrow verifier contract admitted by `D-022` without introducing a universal
principal or exposing provider-owned state. A verifier receives the raw bearer and an exact expected
resource, performs provider-specific validation, and returns only:

- canonical issuer;
- subject;
- client ID;
- exact resource;
- normalized scope ceilings;
- integer expiration.

The internal normalization boundary requires exact object keys, canonical HTTPS issuer/resource
strings, a future integer expiration, bounded control-free identity values, and bounded unique sorted
scopes. The returned result, access object, and scope array are frozen.

## Private provider state

Provider references are not transported in `VerifiedMcpAccess`. A provider adapter retains any session,
grant, consent, or credential reference in its request-local closure, uses it while verifying current
provider state, and discards it before returning the allowlisted result. An enumerable extra field on a
verifier result fails closed instead of being silently projected.

This is sufficient for the selected Convex-native topology: verification and any live provider check
occur at the bearer boundary. Application operations receive credential provenance and re-read their own
canonical authority; they do not need the provider's private row identifier.

## Executed evidence

```text
pnpm exec vitest run --project=unit test/unit/mcp-access-verifier.test.ts
  1 file, 5 tests passed

pnpm --dir packages/mcp typecheck
pnpm exec eslint packages/mcp/src/access.ts test/unit/mcp-access-verifier.test.ts
pnpm check:boundaries
  passed
```

The tests cover:

- exact allowlisted output, normalization, and deep freezing;
- a Better Auth-shaped verifier using a private grant reference held only in closure;
- a materially external Ed25519 verifier possessing only the public verification key;
- wrong resource, expired access, noncanonical issuer, malformed scope, and extra-provider-field denial;
- upstream error, raw bearer, stack sentinel, and provider-reference absence from normalized errors and
  serialization.

## Deliberate limits

- This does not admit or locate the real Better Auth adapter; that remains `P5-004`.
- Scope ceilings are carried but do not authorize application effects. No Better Convex scope helper is
  justified: the official SDK owns resource-level required-scope enforcement, while an application's
  authorization can directly inspect the frozen normalized array. Challenge projection remains `P5-010`.
- The normalizer remains package-internal until the official handler adapter uses it. No standalone public
  verifier wrapper was added.
- Exact packed runtime proof follows with the handler; this task proves the contract and secret boundary,
  not final MCP interoperability.

This evidence therefore also closes the revised `P5-005` outcome: the allowlisted context is constructed
and proved, while the proposed redundant helper is deleted from the plan rather than added to the API.
