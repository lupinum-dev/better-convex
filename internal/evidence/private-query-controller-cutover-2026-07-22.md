# Private query controller cutover — 2026-07-22

## Outcome

The regular-query client lifecycle now has one owner:
`src/runtime/client-core/query-controller.ts`. The controller is private and
framework-neutral. It imports only Convex types, Vue reactivity, the existing
framework-neutral error model, and the private identity-key contract.

It owns:

- exactly one live subscription per controller;
- operation-revision, argument, boundary-key, identity-key, and identity-generation fencing;
- first-subscription-value settlement;
- identity-tagged previous data and stale-state calculation;
- transform and initial-data resolution;
- synchronous identity-boundary clearing;
- subscription replacement on execution-boundary changes;
- clear and idempotent disposal.

The Nuxt composable remains the adapter for `useAsyncData`, request cookies,
SSR HTTP execution, payload-backed error storage, auth gating, logging, and
DevTools. It delegates all live-query ownership and stale-work decisions to the
private controller. There is no registry, cache, polling path, or copied Vue
implementation.

## Hard cut

The previous controller logic was deleted from `useConvexQuery.ts` in the same
change. The unused `computeConvexQueryStale` helper and its isolated tests were
also deleted; stale state is now computed from the controller's canonical
identity-tagged settled snapshot.

A static scan finds regular-query `operationRevision`, `lastSettledRaw`, and
first-value ownership only in the private controller. Pagination retains its
separate lifecycle until P3-010.

## Executed proof

The pure controller suite proves:

- repeated setup keeps one listener;
- first values settle and transform correctly;
- queued Alice callbacks cannot commit after switching to Bob;
- identity changes synchronously clear data, errors, previous data, and the old listener;
- argument changes replace the listener and correctly expose retained data as stale;
- retired one-shot errors cannot overwrite current state;
- teardown settles pending first-value waits;
- repeated disposal unsubscribes exactly once;
- skip avoids subscription and clear retires queued callbacks.

The focused controller and Nuxt-query matrix passed: 6 files and 40 tests.
The broader query state/gate matrix passed: 7 files and 85 tests.

The complete repository check passed:

```text
pnpm check
```

Result: formatting, lint, module/server/fixture typechecks, 12 architecture
rules across 243 source files, and 160 test files / 1,813 tests passed.

## Public API admission

No public export was added. This remains a private proof seam. Public Vue query
APIs remain gated on the plain Vite, embedded, two-consumer, and exact-artifact
evidence later in Phase 3 and Phase 4.
