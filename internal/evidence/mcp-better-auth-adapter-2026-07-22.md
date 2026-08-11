# Better Auth MCP verifier adapter — 2026-07-22

## Outcome

The existing `better-convex-nuxt/convex-auth` backend now exposes one thin
`createBetterAuthMcpAccessVerifier` factory. It does not add Better Auth to `@better-convex/mcp`, copy
the OAuth verifier, or create another package.

The factory:

- snapshots its issuer, JWKS, scope, client, subject, and lifetime policy at construction;
- derives the required OAuth audience from the MCP handler's exact expected resource;
- delegates JOSE/JWKS and raw signed-claim enforcement to `verifyOAuthBearerToken`;
- returns only issuer, subject, client ID, resource, scopes, and expiration;
- omits the provider-private session ID, bearer token, and raw provider result.

The exact installed tuple used by this proof was:

```text
better-auth 1.7.0-rc.1
@better-auth/oauth-provider 1.7.0-rc.1
convex 1.42.2
```

## Executed security evidence

```text
pnpm exec vitest run --project=security \
  test/security/convex-auth-oauth-resource.test.ts \
  test/security/convex-auth-oauth-security.test.ts \
  test/security/convex-auth-oauth-provider-integration.test.ts
  3 files, 157 tests passed

```

The adapter matrix rejects the same-key Convex session token class, a missing token class, foreign
issuer, foreign or array resource audience, conflicting client identity, expired and malformed tokens,
and unsafe expected resource URLs. The provider suites also prove that missing mandatory client/resource
privilege callbacks, callback replacement, callback exceptions/timeouts, unsafe custom claims, unsupported
admin scopes, and a provider instantiated before hardening all fail closed.

## Build and exact-package evidence

```text
pnpm typecheck
pnpm docs:api-surface
pnpm run check:api-surface-docs
pnpm run build:package
pnpm run check:package-exports:dist
```

All passed. The packed-entry gate scanned 150 source files and deep-checked all nine Nuxt package
entries, including the exact new value and type exports under `better-convex-nuxt/convex-auth`.

## Honest completion boundary

This completes the Better Auth adapter profile (`P5-012`) but not the cross-provider token-substitution
gate (`P5-011`). The latter still depends on the concrete external verifier profile (`P5-013`) so the
same issuer/resource/token-class invariants can be demonstrated without Better Auth.
