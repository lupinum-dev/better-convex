# vNext MCP Better Auth live-validation evidence — 2026-07-23

## Scope and decision

This closes audit finding `F-009` and stabilization task `S4-003`.

`createBetterAuthMcpAccessVerifier` can no longer be constructed with signature-only verification.
It requires one server-only `validateLiveAccess` callback. After the fixed RS256, `at+jwt`, token
class, issuer, scalar audience, client/authorized-party, subject, session, lifetime, and scope checks
pass, the adapter invokes that callback with:

- the signed Better Auth session ID;
- subject and client ID;
- the exact configured MCP resource;
- the verified scope ceiling;
- the fixed issuer.

The application callback must re-read the current Better Auth session, user, OAuth client, consent,
and resource grant. A false result or throw becomes the same coarse invalid-token failure. The
provider-private session ID is discarded after the check and cannot enter `McpAccessContext`,
arguments, results, diagnostics, or the provider-neutral MCP package.

Independent/offline verifiers remain supported. Their provider-side revocation is truthfully bounded
by access-token expiry, while application membership, role, delegation, tenant, resource, and
operation authority are still re-read at every effect.

## Executed proof

```text
pnpm exec vitest run --project=security \
  test/security/convex-auth-oauth-resource.test.ts \
  test/security/mcp-external-oauth-profile.test.ts \
  test/security/mcp-credential-passthrough.test.ts
  3 files, 36 tests passed

pnpm exec vitest run --project=mcp test/mcp/mcp-live-authorization.test.ts
  1 file, 13 tests passed

pnpm typecheck:module
pnpm format:check
git diff --check
  passed
```

The matrix proves construction fails without the callback; valid signed tokens are denied when the
live callback rejects or throws; the same token is checked again and denied independently after
session, user, client, consent, or resource revocation; callback input is frozen; session ID and raw
token remain absent from the normalized result; cryptographic substitution cases still fail before
authority; the independent Ed25519 verifier remains provider-neutral; and current membership,
delegation, approval, and resource authority are checked at application effect time.

The live protected Better Auth/Convex deployment repetition remains part of the exact successor
candidate gate `S6-003`/`S6-004`.
