# Canonical query execution gate — 2026-07-22

## Decision

Use one reactive `'skip'` sentinel for Vue and Nuxt query and pagination execution. Do not add an
overlapping `enabled` option.

## Why this is the smaller contract

- Nuxt already exposes and tests reactive `skip`; keeping it avoids a breaking public change.
- `enabled` would still need adapter code to translate a second reactive input into the controller's
  execute/idle state.
- Applications can keep policy separate in their own adapter by returning `'skip'` from a computed
  argument source. Better Convex does not need to own that policy or offer two equivalent controls.
- A sentinel makes disabled state explicit at the call site and matches the argument-source reactivity
  that already drives subscription replacement.

The cost is a small union in query argument types. That cost is lower than a permanent second option,
precedence rules for `enabled` plus `skip`, and two sets of docs/tests.

## Fail-closed correction

The comparison found that an active regular query switching to `skip` unsubscribed but retained its
previous result in the readable boundary. The query controller now receives the adapter's mechanical
idle decision and synchronously clears:

- the active subscription;
- current boundary data and async error;
- previous-data snapshots used by `keepPreviousData`;
- queued operation authority through the existing operation revision.

Pagination already projected no results while idle and cleared its client pages. No second execution
gate or compatibility path was added.

## Verification

```text
pnpm exec vitest run --project=unit \
  test/unit/query-controller.test.ts \
  test/unit/vue-private-proof.test.ts
# 2 files, 8 tests passed

pnpm exec vitest run --project=nuxt \
  test/nuxt/useConvexQuery.nuxt.test.ts \
  test/nuxt/useConvexPaginatedQuery.nuxt.test.ts
# 2 files, 24 tests passed

pnpm test:types
pnpm run check:boundaries
# passed
```
