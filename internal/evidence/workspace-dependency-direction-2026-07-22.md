# Workspace dependency-direction evidence — 2026-07-22

## Outcome

`P2-008` adds one AST-backed package ownership gate to the existing architecture checker. It discovers
the root manifest and the deliberately bounded `pnpm-workspace.yaml` package roots, then enforces:

1. source cannot cross into another package through a relative path;
2. a bare import of another workspace package must be declared by the importing manifest; and
3. the declared workspace package graph must remain acyclic.

This does not add a second package registry. Package names and dependency edges come from the package
manifests; package roots come from the workspace manifest. Unsupported workspace glob shapes fail
closed instead of silently escaping ownership checks. The static package-certification descriptor
remains the narrower authority for packages that may be released.

The existing eleven architecture rules continue to own browser/server/framework direction. Future
private client-island rules remain a Phase 3 decision and were not guessed here.

## Existing leaks removed

The first repository-wide run found four playground-to-root source shortcuts:

- the auth adapter invariant fixture manually imported the component schema, generated type, and source
  module glob;
- the playground auth implementation imported `createUserSyncTriggers` from root `src`; and
- a playground test duplicated the root client-IP cryptography test through a private source import.

The fixture now uses the existing `better-convex-nuxt/convex-auth/test` and generated-component public
entries. The auth implementation uses the existing public user-sync-trigger entry. The redundant
client-IP test was deleted; the root unit and security suites remain its canonical proof. No allowlist,
shim, or new public export was added.

## Executed proof

```sh
pnpm run check:boundaries
```

Result: eleven architecture rules and the package-direction gate passed across two packages and 240
owned source files.

```sh
pnpm exec vitest run \
  test/unit/convex-auth-boundaries.test.ts \
  playground/convex/auth-adapter-invariants.test.ts \
  --reporter=dot
```

Result: three files and 36 tests passed. The AST regressions reject relative cross-package imports,
undeclared scoped-package subpath imports, and package graph cycles; declared public imports pass.

```sh
pnpm run typecheck
```

Result: module, server, local-component, two-factor, and auth-security-plugin typechecks passed after the
playground hard cut to public entries.

Focused formatting passed for every changed source and test. `git diff --check` passed before commit.

## Preserved boundary

This task creates no public package, API, dependency, compatibility path, or release profile. It does
not infer future Vue or MCP package direction. Those edges must be declared only when their packages
pass the RFC admission and phase gates.
