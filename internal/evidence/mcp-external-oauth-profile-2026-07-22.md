# External OAuth verifier profile — 2026-07-22

## Outcome

Provider neutrality is now proven with an independent, private test profile that uses `jose@6.2.3`
rather than Better Auth or the Better Auth OAuth Provider. No generic JWT verifier, vendor adapter, or new
public package API was added.

The profile follows:

- [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414.html) authorization-server discovery with exact
  configured/discovered issuer equality;
- [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068.html) signed JWT access-token requirements, including
  `typ=at+jwt`, asymmetric RS256 verification, issuer, resource audience, subject, client ID, issue time,
  expiry, token ID, and scope;
- the existing provider-neutral `McpAccessVerifier` result boundary and common exact issuer/resource
  normalization.

The test verifier is deliberately under `test/helpers`. JWT profile and discovery policy remain the
external provider integration's responsibility; `@better-convex/mcp` does not gain a
lowest-common-denominator JWT abstraction.

## Executed evidence

```text
pnpm exec vitest run --project=security \
  test/security/mcp-external-oauth-profile.test.ts
  1 file, 13 tests passed

pnpm run typecheck:module
pnpm exec vitest run --project=unit \
  test/unit/mcp-access-verifier.test.ts \
  test/unit/mcp-convex-handler.test.ts
  2 files, 10 tests passed

pnpm exec vitest run --project=oauth
  3 files, 157 tests passed

pnpm check:boundaries
  13 rules, 4 packages, 263 files passed
```

The external matrix rejects ID-token or absent token class, foreign issuer, foreign or multi-resource
audience, missing client, future issue time, excessive lifetime, unapproved scope, malformed token,
expired token, and a valid token signed by an untrusted key. Discovery issuer substitution fails before
token material is accepted. The accepted result contains only the allowlisted access provenance and
expiration.

## Revocation semantics

This is an offline self-contained-token profile. A simulated authorization-server grant revocation does
not retroactively invalidate an already issued JWT at the resource server; the JWT remains valid until
its bounded expiry unless that provider supplies and the adapter performs a live revocation mechanism.
This is consistent with [RFC 7009](https://www.rfc-editor.org/rfc/rfc7009.html), which permits
self-contained access-token deployments and provider-specific revocation behavior.

The same executed test separately disables the application's canonical credential record and proves the
next application effect is denied even while the JWT is cryptographically valid. Better Convex may claim
immediate application authorization revocation for this profile, but it must claim only expiry-bounded
authorization-server grant revocation.

## Dependency boundary

`jose@6.2.3` is an exact root development dependency used only for independent security evidence. It is
not a production dependency of `@better-convex/mcp`, `better-convex-vue`, or `better-convex-nuxt`.
