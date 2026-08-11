# ADR: Better Auth MCP adapter placement

- Status: accepted for experimental implementation
- Date: 2026-07-22
- Decision: keep the adapter in `better-convex-nuxt/convex-auth`
- Supersedes gate: `G-003`

## Outcome

The first-party Better Auth adapter belongs in the existing
`better-convex-nuxt/convex-auth` backend entry. It will be a thin structural implementation of
`McpAccessVerifier`; it will not be a runtime dependency of `better-convex-mcp`, and it will not require
`better-convex-mcp` to import Better Auth.

The implementation task may admit one provider-specific factory, provisionally shaped as:

```ts
const verifier = createBetterAuthMcpAccessVerifier({
  issuer,
  jwksUrl,
  allowedScopes,
  validateLiveAccess: async ({ sessionId, subject, clientId, resource, scopes }) => {
    return await validateCurrentBetterAuthGrant({
      sessionId,
      subject,
      clientId,
      resource,
      scopes,
    })
  },
})
```

Its returned object is TypeScript-structurally compatible with the provider-neutral verifier interface.
The final option names and exact exported types remain `P5-012` implementation evidence, not an API
promise made by this placement record.

## Why this is the smallest correct boundary

The existing Convex-auth entry already owns:

- exact `better-auth@1.7.0-rc.1` and `@better-auth/oauth-provider@1.7.0-rc.1` behavior;
- JWKS signature verification;
- raw signed-claim re-decoding after the provider client normalizes `azp`;
- fixed `at+jwt`, issuer, audience, lifetime, token-use, client, subject, and scope checks;
- the mandatory OAuth provider-profile hardening and privilege callbacks.

Signature validation is necessary but not sufficient for the maintained adapter. Its construction
requires one request-local, server-only callback that re-reads the current Better Auth session, user,
client, consent, and resource grant. The callback receives the provider-private session ID inside this
adapter boundary; the returned provider-neutral MCP access context does not.

The MCP package owns none of those provider rules. Moving them into MCP would copy a high-consequence
verifier or make Better Auth part of the provider-neutral dependency graph.

The returned verifier does not need a compile-time import from `better-convex-mcp`: TypeScript's
structural contract allows the provider entry to return the exact method/result shape. This preserves
both package directions:

```text
better-convex-mcp
  → official MCP SDK only

better-convex-nuxt/convex-auth
  → existing Better Auth/OAuth dependencies
  → no MCP runtime import required
```

## Rejected placements

### `better-convex-mcp/better-auth`

Rejected. It would add Better Auth and OAuth-provider peer/optional dependency policy to the base MCP
artifact or duplicate the root verifier. A subpath does not erase package-level install and maintenance
cost.

### `better-convex-mcp-better-auth`

Rejected. A fourth public package is not justified for one small adapter already owned by the current
provider integration.

### `better-convex-nuxt/server`

Rejected. The verifier executes in the Convex-native resource boundary and must remain usable without
Nitro, H3, or a Nuxt request.

### Generic JWT verifier in the MCP base

Rejected. JWT profile, raw claim shape, key discovery, revocation semantics, and token-class separation
are provider-specific security policy. The external consumer proves provider neutrality through its own
verifier rather than a lowest-common-denominator JWT abstraction.

## Executed dependency evidence

```text
pnpm list --filter better-convex-mcp --prod --json --depth Infinity
  direct production dependency: @modelcontextprotocol/server only

node scripts/check-candidate-apps.mjs --package mcp
  exact-tarball clean consumer passed

pnpm check:boundaries
  13 rules, 4 packages, 263 files passed
```

The MCP candidate installed and typechecked without Nuxt or Better Auth. Its installed bytes matched the
packed candidate. This proves the base remains provider neutral before the adapter is implemented.

## Consequences

- `P5-012` adds and certifies the thin factory beside `verifyOAuthBearerToken` rather than moving or
  copying the verifier.
- `P5-011` runs its cryptographic substitution matrix through that real factory.
- Better Auth remains optional to MCP users and mandatory only for consumers selecting this adapter.
- A future non-Nuxt Better Auth package may justify relocating the provider integration as a hard cut;
  this ADR does not create a compatibility shim in anticipation.
