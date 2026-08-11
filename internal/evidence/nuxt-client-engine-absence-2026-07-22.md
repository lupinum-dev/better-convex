# Nuxt client-engine absence proof — 2026-07-22

Task: `P4-010`

## Outcome

The root Nuxt package contains adapters around `better-convex-vue`, plus Nuxt-owned SSR, payload,
Better Auth, server, and DevTools behavior. It does not contain a second browser client owner, query
controller, pagination controller, callable controller, identity port, or browser-runtime constructor.

The actual engine deletion and source move happened atomically in `6e35fea0`. This task adds the
permanent source-and-dist rejection gate that prevents the deleted paths, private package imports, or
bundled controller implementations from returning.

## Gate

`scripts/check-no-nuxt-client-engine.mjs` fails on:

- the old `src/runtime/client-core` or `src/runtime/auth/client-engine.ts` paths;
- imports from Vue package source or an internal package subpath;
- Nuxt source or dist bytes containing the lifecycle ownership symbols moved into
  `packages/vue/src/internal`;
- a requested dist proof when no production build exists.

The source check is part of `check:contracts`. The dist check runs after every root `prepack`, so a
candidate cannot pass merely because source imports look correct while the built Nuxt artifact embeds
a second engine.

## Executed proof

```text
node --check scripts/check-no-nuxt-client-engine.mjs
pnpm exec vitest run test/unit/no-nuxt-client-engine.test.ts
pnpm run check:no-nuxt-client-engine
pnpm exec vitest run --project=nuxt \
  test/nuxt/client-lifecycle-conformance.nuxt.test.ts \
  test/nuxt/useConvexQuery.nuxt.test.ts \
  test/nuxt/useConvexQuery.identity.nuxt.test.ts \
  test/nuxt/useConvexPaginatedQuery.nuxt.test.ts \
  test/nuxt/useConvexAction.nuxt.test.ts
pnpm run prepack
pnpm run lint
```

Results:

- absence-gate adversarial suite: 1 file, 3 tests passed;
- Nuxt shared/client adapter suite: 5 files, 34 tests passed;
- production Nuxt package build and all 9 dist entries passed;
- source and built-dist engine-absence checks passed;
- lint passed.

An untracked empty `src/runtime/client-core` directory left by the earlier move was removed. It held no
files and could not enter Git or npm, but the permanent path check now rejects even that stale local
shape.

## Ownership retained in Nuxt

Nuxt still owns the pieces that cannot be framework-neutral: request-isolated SSR HTTP execution,
auth-partitioned payload keys, hydration reconciliation, Better Auth presentation, server utilities,
and DevTools event projection. These are adapters and server concerns, not a second client lifecycle.
