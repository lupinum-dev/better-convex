# MCP cross-provider token binding — 2026-07-22

## Outcome

The cryptographic token-substitution gate now passes through two concrete verifier profiles and the
common official-SDK-backed HTTP boundary:

```text
Better Auth OAuth Provider access token
  -> pinned provider JOSE/JWKS verifier
  -> raw signed-claim re-decode
  -> provider-neutral MCP access context

Independent RFC 8414/9068 access token
  -> jose remote public JWKS verifier
  -> exact RFC profile checks
  -> provider-neutral MCP access context

Common MCP handler
  -> configured issuer + configured resource re-binding
  -> expiration + identity + scope normalization
  -> HTTP Authorization: Bearer only
```

No common layer attempts to infer an unverified JWT profile, and no adapter may choose a foreign issuer
or resource after construction.

## Executed evidence

```text
pnpm exec vitest run --project=oauth
  3 files, 157 tests passed

pnpm exec vitest run --project=security \
  test/security/mcp-external-oauth-profile.test.ts
  1 file, 13 tests passed

pnpm exec vitest run --project=unit \
  test/unit/mcp-access-verifier.test.ts \
  test/unit/mcp-convex-handler.test.ts
  2 files, 10 tests passed

```

The combined matrix rejects:

- a Convex session token signed under the Better Auth deployment's related key infrastructure;
- an OIDC/ID-token-shaped JWT and tokens with absent access-token class;
- malformed, expired, future-issued, excessive-lifetime, wrong-key, and conflicting-client tokens;
- foreign issuer, foreign resource, array/multi-resource audience, wrong subject, and unsupported scope;
- credentials placed in URL query or JSON body instead of the `Authorization` header;
- an adapter result whose issuer or resource differs from the handler's fixed authorities.

The accepted context contains only exact issuer, subject, client ID, resource, normalized scopes, and
expiration. Bearer bytes, provider session/grant references, signed claims, and verifier causes do not
cross into application context or public failure bodies.

## Revocation claim boundary

This gate proves token validity and class separation, not a universal revocation mechanism. The Better
Auth deployment may additionally perform its certified live provider checks. The independent offline
profile promises provider-grant invalidation only by token expiry, while application-owned membership,
credential, delegation, tenant, and operation authorization must still be loaded live for every effect.
