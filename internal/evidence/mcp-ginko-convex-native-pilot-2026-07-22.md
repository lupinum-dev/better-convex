# Ginko Convex-native MCP consumer proof — 2026-07-22

## Scope

Ginko CMS branch `codex/better-convex-mcp-pilot` at commit `4dc7727b` consumes the reproducible
`@better-convex/mcp@0.1.0-beta.0` source candidate at package-only commit
`83b7f3f91901caececc356c078f2eb8c80ec710e`.

This is the first application-owned consumer proof, not the completed Ginko cutover. It maps one read
and one ordinary draft write through the selected Convex-native topology while retaining Ginko's
canonical component authorization and data model.

## Product boundary

- Better Convex owns HTTP/MCP transport, bearer termination, exact resource binding, request bounds,
  safe access context, official SDK dispatch, diagnostics, and opaque unexpected failures.
- Ginko owns credential records, current scopes, member/role/tenant checks, contract compatibility,
  optimistic concurrency, tool names/schemas, and effects.
- The raw credential is hashed before application lookup and is absent from Convex operation arguments,
  tool results, and error bodies.
- The ordinary draft write has no confirmation workflow and cannot publish content.

Ginko packages its domain tool catalog once behind `@lupinum/ginko-cms-convex/mcp`; generated host
files only bind canonical component operations and register the route. The old Nitro catalog remains
until the complete hard cut, so this proof does not complete `P5-021`.

## Executed evidence

```text
pnpm --config.verify-deps-before-run=warn run check

format, lint, package boundaries, setup/template drift, release hygiene,
component and Studio typechecks, production Vite build:
  passed

Vitest:
  187 files passed, 1 skipped
  1,245 tests passed, 1 skipped
```

The MCP-focused suite additionally proves:

- successful `get-entry` and `save-entry-draft` dispatch through the official locked-RC SDK;
- current credential and scope evaluation;
- current application denial after member revocation and cross-tenant access;
- typed optimistic-concurrency conflict projection;
- opaque unexpected application failures;
- no bearer value in Convex arguments or public results.

The release consumer additionally packed all seven application and framework packages, installed the
exact `@better-convex/mcp@0.1.0-beta.0` tarball into a temporary application, and executed the packed
Ginko `get-entry` and `save-entry-draft` tool catalog through the official SDK-backed handler. The
behavioral probe preserved the exact hyphenated Ginko tool names, returned the read and draft-write
results, and proved the bearer sentinel did not enter the captured application calls or results. The
same consumer generated all 28 host setup files and completed a production Nuxt/Nitro build.

The full check used the already certified local Vue/Nuxt beta.4 artifacts because those versions are
not published. The package consumer installed their exact certified tarballs and the exact MCP
tarball, rather than workspace links. A protected deployed-endpoint run remains a separate `P5-023`
release gate; it is not claimed by this consumer proof. Deletion of the old supported protocol stack
remains coupled to `P5-021`, where the neutral and Ginko replacement evidence can guard one hard cut.
