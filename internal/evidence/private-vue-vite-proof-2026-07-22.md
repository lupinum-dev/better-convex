# Private Vue/Vite lifecycle proof — 2026-07-22

## Outcome

A private neutral fixture production-bundles the framework-neutral controllers directly with Vite. It
executes query, pagination, mutation, and action behavior from the same source files used by Nuxt. It
also proves synchronous Alice-to-Bob state retirement, stale callback rejection, and exact cleanup.

This is implementation evidence, not a proposed public Vue API. It adds no plugin, injection key,
configuration surface, or package.

The existing `vue-copy-proof` host/embedded fixture already production-bundles two distinct Vue copies
and attaches through the opaque runtime. It was reused for `P3-015`; adding a second embedded fixture
would have created duplicated proof glue without a new invariant.

## Boundary proof

- The plain minified bundle contains no Nuxt `#imports`, `@nuxt`, H3, Nitro, or Better Auth runtime.
- The embedded boundary contains only the stable query/mutation/action/onUpdate handle and token-free
  identity snapshot/observer.
- The host's raw client, token sentinel, and error cause do not enter the attached snapshot, serialized
  runtime, or embedded bundle.
- Separate host and embedded bundles use distinct Vue module identities.
- Identity transitions update the consuming Vue copy and disposal detaches exactly once.

## Verification

```text
pnpm exec vitest run --project=unit \
  test/unit/vue-private-proof.test.ts \
  test/unit/attached-runtime.test.ts
# 2 files, 2 production-build/runtime tests passed

pnpm test:types
pnpm run check:boundaries
# passed
```

The fixture-only direct imports are scheduled for deletion when the proven source moves once into the
Vue package in Phase 4.
