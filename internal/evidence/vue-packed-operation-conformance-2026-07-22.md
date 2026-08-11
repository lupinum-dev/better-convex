# Packed Vue operation conformance

Date: 2026-07-22

Task: `P4-006`

## Outcome

The maintained provider-neutral Vue consumer now proves the public query, pagination, mutation, and
action composables from the exact installed `better-convex-vue@0.8.0-beta.0` tarball. The proof runs
through a production Vite bundle in a real headless browser; it does not import package source or a
private controller export.

The deterministic fixture aliases only `convex/browser`, leaving plugin construction, public
composable lookup, identity fencing, controller state, error normalization, and disposal inside the
installed package. This remains a test transport, not a second runtime or public client-injection API.

## Executed proof

```text
pnpm exec vitest run \
  test/unit/query-controller.test.ts \
  test/unit/vue-package-runtime.test.ts \
  test/nuxt/client-lifecycle-conformance.nuxt.test.ts
pnpm check:vue-auth-consumer
```

The exact-package browser proof covers:

- live query settlement and reactive argument replacement;
- synchronous unsubscribe and protected-result clearing at an argument boundary;
- query error normalization and recovery;
- first-page pagination, an empty continuation page, the following tail page, and exhaustion;
- pagination retirement when arguments or identity change;
- successful mutation and action result/status behavior;
- non-throwing mutation results for plain unknown and structured Convex application errors;
- preservation of structured application-error data;
- a pending mutation completing after an identity change and rejecting with `IDENTITY_CHANGED`;
- synchronous query, pagination, and callable state retirement on identity change; and
- zero active subscriptions after application disposal.

The proof discovered and fixed one shared-controller defect: a live query argument change retained the
old result even when `keepPreviousData` was false. The controller now clears that result before the new
subscription starts, while the existing explicit `keepPreviousData: true` behavior remains covered.

## Deletion

The private source-importing Vite proof and its unit wrapper were deleted. Their useful invariant is now
covered by the stronger installed-tarball production consumer. The shared Nuxt conformance report helper
remains because the Nuxt SSR/client suite still consumes it.
