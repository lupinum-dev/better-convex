# Anonymous auth client-surface regression proof

## Invariant

An auth-enabled browser that settles anonymous must publish a usable anonymous
primary client without calling methods that are absent from the pinned
`convex@1.42.2` `ConvexClient` public surface.

Identity retirement remains replacement-based: an authenticated client is
closed before a fresh anonymous candidate is initialized. The candidate starts
anonymous and needs no credential-clearing call.

## Defect and hard cut

The shared Vue auth port declared and called `ConvexClient.clearAuth()`. The
pinned browser client exposes `setAuth()` but not `clearAuth()`, so anonymous
settlement failed closed and repeatedly retired replacement candidates. Test
doubles had copied the invented method and masked the mismatch.

The invalid method and every matching test-double method were deleted. A focused
test now initializes anonymous state through a client with the exact public auth
surface, and the full-stack realtime test proves two auth-enabled anonymous
browsers settle before subscribing and receiving a cross-tab mutation update.

## Executed evidence

- `pnpm exec vitest run test/unit/auth-adapter-port.test.ts test/unit/browser-runtime.test.ts`
  — 13 tests passed.
- `pnpm --dir packages/vue typecheck` — passed.
- `CONVEX_E2E_AUTO_START=true BCN_E2E_REQUIRE_LOCAL=true pnpm exec vitest run --project=e2e test/e2e/realtime-subscription.e2e.test.ts`
  — the production Nuxt browser path passed.
- `pnpm check` — formatting, lint, all typechecks, 12 package-boundary rules,
  156 files, and 1,799 tests passed.

The realtime fixture now uses the same explicit `http://localhost:3050` origin
for local Better Auth configuration, Nuxt public origin, and browser navigation;
origin disagreement therefore fails as configuration evidence instead of being
misreported as a realtime failure.
