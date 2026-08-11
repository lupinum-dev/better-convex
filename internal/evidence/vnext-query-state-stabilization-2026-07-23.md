# vNext query-state stabilization evidence — 2026-07-23

## Scope

This closes post-audit candidates `PA-003`, `PA-004`, and `PA-005` for the shared Vue query surface.
Nuxt SSR remains an explicit adapter and is not claimed to use the private browser decision function.

## Corrected invariants

- Query and pagination use one private provider-neutral execution decision:
  `execute | idle | wait | error`.
- A live query is pending only while a first value can still settle it. Re-observing an already-settled
  subscription after an auth-epoch change does not restore pending.
- `clear()`, identity retirement, disablement, and disposal synchronously retire live work. Late
  callbacks cannot restore state.
- An authentication error has precedence over disabled/idle pagination state.
- A valid Convex `null` result is settled success; a private symbol represents absence of a result.
- Vue query arguments are positional and required. Pagination accepts only references with
  `paginationOpts` and a pagination-result return type.
- The auth adapter consumes the generated component API type. Dynamic Better Auth predicates are
  converted once to the generated Convex argument shape; broad `as never` call-site casts were deleted.

## Executed proof

```text
pnpm exec vitest run \
  test/unit/convex-auth-adapter-invariants.test.ts \
  test/unit/query-controller.test.ts \
  test/unit/query-state.test.ts \
  test/unit/vue-package-runtime.test.ts \
  test/unit/vue-query-options-types.test.ts \
  test/nuxt/useConvexQuery.nuxt.test.ts \
  test/nuxt/useConvexPaginatedQuery.nuxt.test.ts \
  test/nuxt/client-lifecycle-conformance.nuxt.test.ts \
  --config vitest.config.ts
  9 files, 94 tests passed

pnpm typecheck
  module, server, and fixture typechecks passed

pnpm format:check
  passed after canonical oxfmt
```

The behavioral matrix includes same-subscription auth-epoch reconciliation, `clear()` during pending,
late callbacks, valid `null`, identity retirement, authentication wait/error pagination states, cursor
tail retirement, and Nuxt query/pagination parity. The type fixture contains negative contracts for
omitted required arguments, ordinary query references, and non-pagination return types.

No beta.6 tarball was generated: the stabilization freeze reserves packed successor evidence for the
fresh beta.7 candidate after the repair set is complete.
