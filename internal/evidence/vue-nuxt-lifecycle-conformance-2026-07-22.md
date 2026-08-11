# Vue/Nuxt lifecycle conformance — 2026-07-22

## Shared report

`test/helpers/client-lifecycle-conformance.ts` defines one black-box report for behavior applicable to
both client adapters:

- query result acquisition;
- first and continuation pagination pages;
- mutation and action settlement;
- synchronous query, pagination, mutation, and action retirement on identity change;
- query, pagination, and identity-listener cleanup on disposal.

The Nuxt composables and the minified production-Vite bundle produce the same report. This is an outcome
contract, not a public controller API.

The separately bundled embedded Vue copy uses the same helper's attachment subset: stable client method
allowlist, Alice-to-Bob projection, retained safe last snapshot after disposal, zero listeners, and one
detach.

## Framework-specific matrix

| Invariant                                                   | Private Vite | Embedded Vite | Nuxt client | Nuxt browser auth | Nuxt SSR/hydration |
| ----------------------------------------------------------- | ------------ | ------------- | ----------- | ----------------- | ------------------ |
| Query/pagination/callable shared report                     | Passed       | N/A           | Passed      | N/A               | N/A                |
| Opaque runtime and separate Vue-copy identity projection    | N/A          | Passed        | Host side   | N/A               | N/A                |
| Identity change and late-work retirement                    | Passed       | Passed        | Passed      | Passed            | Request partition  |
| Auth cross-tab A→B→A→anonymous and post-disposal inertness  | Provider API | Provider API  | Port seam   | Passed            | N/A                |
| Request-isolated SSR error normalization/payload hydration  | N/A          | N/A           | N/A         | Browser hydrated  | Passed             |
| Production Nuxt server render after lifecycle source change | N/A          | N/A           | N/A         | N/A               | Passed             |

SSR/request cookies, payload storage, and Better Auth browser behavior are intentionally not presented
as plain-Vue invariants.

## Verification

```text
pnpm exec vitest run --project=unit \
  test/unit/vue-private-proof.test.ts \
  test/unit/attached-runtime.test.ts \
  test/unit/query-controller.test.ts \
  test/unit/pagination-controller.test.ts \
  test/unit/callable-lifecycle.test.ts
# 5 files, 28 tests passed

pnpm exec vitest run --project=nuxt \
  test/nuxt/client-lifecycle-conformance.nuxt.test.ts \
  test/nuxt/useConvexQuery.nuxt.test.ts \
  test/nuxt/useConvexQuery.identity.nuxt.test.ts \
  test/nuxt/useConvexPaginatedQuery.nuxt.test.ts \
  test/nuxt/useConvexMutation.nuxt.test.ts \
  test/nuxt/useConvexAction.nuxt.test.ts
# 6 files, 45 tests passed

pnpm exec vitest run --project=browser \
  test/browser/AuthIdentityLifecycle.browser.test.ts
# 1 file, 1 browser test passed

pnpm exec vitest run --project=e2e \
  test/e2e/ssr-errors-consumer.e2e.test.ts \
  test/e2e/smoke-ssr.e2e.test.ts
# 2 files, 2 production SSR/hydration tests passed
```

P3-019 remains responsible for exact packed-byte consumer certification after this source-level matrix.
