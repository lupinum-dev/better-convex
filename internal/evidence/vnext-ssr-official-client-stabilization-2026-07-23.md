# vNext official SSR client stabilization evidence — 2026-07-23

## Scope and decision

This closes audit findings `F-003` and `F-004` and stabilization tasks `S2-001` and `S2-002`.

Nuxt SSR queries now use one request-scoped official `ConvexHttpClient`. The deleted handwritten
protocol no longer encodes arguments, interprets Convex response envelopes, or reconstructs
application errors. A private custom fetch owns only the boundaries Better Convex must enforce:

- an eight-second deadline that remains active while the response body is consumed;
- parent-request abort propagation;
- a one-MiB declared and streamed response limit;
- `cache: no-store`;
- opaque handling of non-Convex upstream failures.

The official client owns Convex value encoding and decoding, including IDs, bigint, bytes, special
numbers, nested null values, and structured `ConvexError` data. SSR payload data uses a private
envelope so a valid `null` result is distinct from missing hydration data.

The browser plugin now observes the shared runtime's identity generation once. Every generation
change—including same-subject session replacement—synchronously removes required and optional
query/pagination payloads, filters their stored errors, and clears their Nuxt async-data entries.
Anonymous data and anonymous errors remain reusable. The earlier anonymous-only duplicate purge was
deleted.

## Executed proof

```text
pnpm exec vitest run \
  test/unit/convex-cache-payload-keys.test.ts \
  test/unit/auth-adapter-port.test.ts \
  test/nuxt/useConvexQuery.nuxt.test.ts \
  test/nuxt/auth-execution-count-matrix.nuxt.test.ts \
  test/unit/convex-call-error.test.ts \
  --config vitest.config.ts
  5 files, 73 tests passed

pnpm exec vitest run test/e2e/ssr-errors-consumer.e2e.test.ts \
  --config vitest.config.ts
  1 production Nitro/browser test passed

pnpm typecheck:module
focused ESLint
git diff --check
  passed
```

The focused matrix proves official encoding and decoding for bigint, `ArrayBuffer`, `NaN`, positive
and negative infinity, negative zero, nested values and `null`; structured Convex application errors;
opaque unexpected upstream bodies; declared and streamed size rejection; parent abort; request and
body-consumption deadlines; valid-null hydration; same-user session generation advancement; and
protected-versus-anonymous payload/error filtering.

The existing live concurrent SSR identity matrix remains part of the full `S6-003` candidate proof.
This local change does not claim protected deployment evidence.
