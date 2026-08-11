# Vue package atomic cutover proof

Date: 2026-07-22

Task: `P4-003`

Implementation commit: `6e35fea0b8745915a3b94f507141e94b49066650`

## Outcome

The proven client lifecycle now has one source under `packages/vue`. The root Nuxt package consumes
only the public `better-convex-vue`, `better-convex-vue/errors`, and
`better-convex-vue/embedded` entries. Nuxt retains SSR request execution, payload hydration, Better
Auth adaptation, and DevTools projection; it no longer owns a browser client or auth coordinator.

The cut removed the old Nuxt client engine and private source island in the same commit. The tracked
diff added 2,947 lines and deleted 8,345 lines. No compatibility engine, internal public subpath, raw
client control, token-bearing attachment, or second error implementation remains.

The Nuxt SSR adapter preserves identity-partitioned hydrated data and errors while the Vue controller
reconciles in the background. Hydrated errors mount without waiting for a WebSocket result, remain
sanitized `ConvexCallError` instances, and retire when a newer client result settles.

## Executed proof

```text
pnpm check
pnpm --dir packages/vue build
pnpm build:package
pnpm check:package-exports:dist --dist-only
pnpm check:no-old-auth-runtime
pnpm check:auth-disabled-build-graph
pnpm exec vitest run --project=e2e test/e2e/ssr-errors-consumer.e2e.test.ts
pnpm install --frozen-lockfile
git diff --check
```

Results:

- clean-HEAD `pnpm check`: 154 files / 1,768 tests passed, including formatting, lint, all
  typechecks, 12 architecture rules over 258 files, and unit/security/Convex/Nuxt/browser projects;
- Vue and Nuxt production builds passed;
- the Nuxt dist-entry gate deep-checked all 9 public entries;
- the auth-disabled production build contained no Better Auth client, removed auth engine, proxy, or
  middleware markers;
- the real SSR browser fixture preserved the public error fields and emitted no raw-cause sentinel;
- frozen installation and diff checks passed.

Exact installed Vue/Nuxt tarball-pair certification is intentionally not claimed by this task. The
Nuxt manifest uses exact `better-convex-vue@0.8.0-beta.0` rather than a publish-invalid `workspace:`
specifier; `P4-008` and `P4-013` own the reviewed package profiles and immutable candidate-set proof.

## Invariants retained

- one stable replacement-safe handle per Vue root;
- dedicated anonymous transport when authentication is enabled;
- provider-neutral auth adapters never receive a Convex client;
- synchronous identity-generation retirement and stale completion rejection;
- query, pagination, mutation, and action lifecycle shared by Vue and Nuxt;
- token-free, raw-client-free embedded attachment;
- exactly-once disposal across host and attached Vue roots;
- Nuxt SSR request isolation and identity-partitioned hydration;
- one framework-neutral public error class and normalizer.
