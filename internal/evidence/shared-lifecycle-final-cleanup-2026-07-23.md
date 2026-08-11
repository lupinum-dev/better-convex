# Shared lifecycle final cleanup — 2026-07-23

## Outcome

The remaining client-lifecycle correctness work was completed inside the existing shared Vue engine.
No new public controller, registry, compatibility path, or second source of lifecycle state was added.

## Pagination correctness

Two failing regressions were added before the fixes:

- manual refresh now stops at the first terminal page and immediately retires and unsubscribes any
  previously retained tail;
- a same-identity argument boundary now clears a hydrated first-page seed synchronously instead of
  presenting data for the previous arguments.

The focused pagination and Nuxt lifecycle suites passed after both fixes.

## Deleted producerless state

- `defineSharedConvexQuery` no longer requires an unused caller-authored key;
- unused query, mutation, and action logger event families were removed;
- DevTools no longer guesses `dataSource`, subscription state, or update counts from configuration.

The remaining DevTools fields are backed by actual runtime state.

## One upload transport

Single-file upload and upload-queue execution now share one internal URL-request, abort, and XHR
transport pipeline. The public composables retain their separate user-facing lifecycles. Abort detection
uses the mechanical `AbortError` name so it remains correct across JavaScript realms.

## Full and packed proof

- `pnpm check`: 164 files and 1,890 tests passed, including formatting, lint, type checks, and all
  architecture rules.
- `pnpm check:vue-anonymous-consumer`: exact tarball installed, typechecked, and production-built.
- `pnpm check:vue-auth-consumer`: exact tarball installed, production-built, and browser lifecycle passed.
- `pnpm check:vue-embedded-consumer`: independently installed host and embedded applications passed
  production builds and the cross-Vue-copy browser lifecycle.
- `pnpm prepack` and `pnpm check:consumer-smoke:dist`: the Nuxt package, deep exports, single-runtime
  boundary, and installed distribution consumer passed.

## Commits

- `6c82e61d` — retire stale pagination tails and hydrated argument-boundary data;
- `7f61370e` — remove the unused shared-query key;
- `e5694f3d` — remove producerless logger and DevTools state;
- `37c7ac4b` — share one upload transport pipeline.
