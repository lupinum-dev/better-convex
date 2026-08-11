# Vue/Nuxt exact candidate-pair evidence — 2026-07-22

## Claim

The maintained Nuxt consumer matrix now certifies one package set: the packed
`better-convex-nuxt@0.8.0-beta.0` candidate and the exact
`better-convex-vue@0.8.0-beta.0` candidate declared by its packed manifest.
It does not substitute a workspace link, source directory, version range, or a
separately built Vue candidate per consumer.

## Enforcement

- The reviewed `nuxt-maintained-consumers` profile has one closed companion package ID: `vue`.
- The runner builds and packs that reviewed companion once.
- It rejects a Nuxt packed manifest whose production dependency is not exactly the packed Vue
  version.
- Every scratch consumer receives both immutable tarballs. The pnpm fixtures use a scratch-only
  override because pnpm otherwise resolves the unpublished exact transitive version from the
  registry; source fixtures and the packed Nuxt manifest remain unchanged.
- Each fresh pnpm lockfile and the npm lockfile must reference both local tarballs.
- Each installed Nuxt and Vue tree must match its extracted candidate by relative path, size, and
  SHA-256. Package-manager-created `node_modules` content is excluded from both sides.

## Executed proof

```text
pnpm exec vitest run test/unit/vue-package-runtime.test.ts test/unit/runtime-context.test.ts
pnpm --dir packages/vue run typecheck
pnpm run lint
pnpm run check:candidate-apps
```

Results:

- focused runtime tests: 2 files, 13 tests passed;
- Vue package typecheck and repository lint passed;
- seven pnpm consumers passed: `demo`, `agency`, `agentic-saas`, `mcp-agent`,
  `mcp-oauth-agent`, `public`, and `team`;
- the npm `consumer-smoke` fixture passed typecheck and a production Nitro build;
- configured starter test suites, production builds/renders, MCP generated-API probe, and private
  production source-map checks passed;
- final runner result: `Candidate app matrix passed (7 pnpm apps and one npm consumer, one exact
package set).`

The optional live Agency codegen freshness check was not part of this local run because
`AGENCY_CONVEX_DEPLOY_KEY` was absent. The candidate runner reported that omission explicitly; it
does not weaken the package-pair install, lock, byte, type, test, or production-build evidence.

## Defects caught before acceptance

The first complete pair run exposed two production-SSR boundary defects that source-focused tests
had not found:

1. `createConvexQueryAuthContext(null)` reached `readConvexRuntimeContext`, which previously read a
   property from `null`. Commit `833086c0` makes the context reader safely return `undefined` for
   non-app inputs and adds the corresponding unit matrix.
2. Nuxt mutation/action composables are legitimately created during SSR, but the shared Vue
   callable initially required an installed browser plugin at creation time. Commit `c06570c6`
   keeps the single shared lifecycle, permits inert server-side setup, and rejects actual execution
   without a browser runtime. It does not add a Nuxt-owned callable engine.

The final exact-tarball run passed only after both fixes were included in the packed bytes.

## Invariants closed

- Nuxt declares one exact public Vue dependency and consumes its public package entries.
- Maintained production consumers exercise the same Vue candidate that Nuxt depends on.
- No workspace/source resolution can satisfy the certification run unnoticed.
- SSR setup does not instantiate or require a browser runtime.
- The old Nuxt client lifecycle is not reintroduced by the SSR fixes.
