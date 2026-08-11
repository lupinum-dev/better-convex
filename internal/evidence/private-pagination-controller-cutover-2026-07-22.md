# Private pagination controller cutover — 2026-07-22

## Outcome

Pagination lifecycle ownership now lives in
`src/runtime/client-core/pagination-controller.ts`. The Nuxt composable retains the Nuxt boundary:
authentication and transport selection, `useAsyncData`, payload-backed error storage, cookie/token
selection, and terminal awaitability.

The cut deleted 429 lines of client lifecycle from `useConvexPaginatedQuery.ts`. It did not add a
second engine or a public API. Page metadata was deliberately not admitted without the two-consumer
evidence required by `P3-012`.

## Invariants proved

- An empty page with a continuation cursor remains loadable.
- Each live tail subscription updates its own page. This fixes the previous ambiguous lookup where all
  pages in one generation shared the same numeric generation ID.
- A live cursor change retires only the now-invalid following tail; a first-page cursor change retires
  every tail instead of displaying a duplicated or stranded cursor chain.
- Refresh fetches the first page and then re-chains every loaded page from fresh cursors before one
  atomic commit.
- Identity changes synchronously clear protected results, unsubscribe all pages, and reject an already
  queued refresh result.
- Disposal is idempotent and retired callbacks cannot repopulate state.
- Existing Nuxt first-page, SSR/client boundary, refresh, reset, status, and error behavior remains
  green through the thinner adapter.

## Verification

```text
pnpm exec vitest run --project=unit \
  test/unit/pagination-controller.test.ts \
  test/unit/paginated-query-pages.test.ts \
  test/unit/query-state.test.ts
# 3 files, 22 tests passed

pnpm exec vitest run --project=nuxt \
  test/nuxt/useConvexPaginatedQuery.nuxt.test.ts
# 1 file, 5 tests passed; 27 focused tests total

pnpm exec eslint \
  src/runtime/client-core/pagination-controller.ts \
  src/runtime/composables/useConvexPaginatedQuery.ts

pnpm test:types
# passed
```

No credential, identity token, Nuxt import, server primitive, or MCP concept entered the private
controller.
