# MCP base-package documentation — 2026-07-22

## Outcome

The maintained documentation now separates the provider-neutral
`@better-convex/mcp` resource boundary from the optional Better Auth delegated
OAuth profile.

The base guide records:

- the exact experimental package, official SDK, and locked RC versions;
- one deployment-owned Convex HTTP Action and explicit official-SDK operation
  registration;
- the verifier/application authorization ownership boundary;
- OAuth and preconfigured-bearer modes without making Better Auth mandatory;
- protocol, authentication, application, and infrastructure error ownership;
- immediate application-state revocation versus expiry-bounded offline token
  verification;
- safe diagnostic fields and forbidden credential/cause data;
- the complete intentionally unsupported base-package surface.

The delegated OAuth guide and starter no longer represent Inspector or
`mcp-remote` as release authorities. They describe the two direct public-client
S256 PKCE paths and distinguish the locked-RC official-client proof from the
older official conformance package's published `2025-11-25` scenarios.

## Deleted claims

- Inspector UI and `mcp-remote` as the maintained interoperability harness.
- The older conformance package as evidence for the locked RC envelope.
- The delegated Better Auth starter as the universal MCP product model.

Fixture identifiers retained for compatibility observation are explicitly not
release-tool dependencies.

## Executed evidence

```text
pnpm exec vitest run --project=mcp test/mcp/mcp-documentation.test.ts
  1 file, 4 tests passed

pnpm --dir docs typecheck
  passed

pnpm --dir docs build
  production Nitro build passed
  340 routes prerendered
  /docs/build/agents/mcp generated successfully
```

The build emitted only existing Nuxt component-directory, Rollup annotation,
and bundle-size warnings. It emitted no content, route, or link failure.
