# Exact-package cross-adapter lifecycle evidence — 2026-07-22

## Claim

The immutable `better-convex-vue@0.8.0-beta.0` and
`better-convex-nuxt@0.8.0-beta.0` candidate pair now passes the lifecycle matrix from installed
package bytes in production Vite and Nitro applications. The Nuxt browser proof closes the remaining
gap between the existing source-level cross-adapter conformance suite and the exact-package candidate
matrix.

This proof adds no runtime export or second lifecycle engine. Nuxt continues to consume the one client
lifecycle implementation shipped by `better-convex-vue`; the new code is a maintained consumer and a
closed release runner.

## Candidate identity

| Package                           | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `better-convex-vue@0.8.0-beta.0`  | `b9371c4b63444ecd1b146b72431d21865b7ff716fdd633336d85c243c5e2d4af` |
| `better-convex-nuxt@0.8.0-beta.0` | `172c36914ae7f2dbb78a11735caa421912af9fb1df3829aba3a8ad6a469b4334` |

Both artifacts are bound by `.release-artifacts/set/0.8.0-beta.0/artifact-set.json` to source commit
`be64776e5ddbf626e5fefdba1d3d0cfce3ed5c99`. The lifecycle runner rejects non-files and symlinks,
checks package identity, requires Nuxt's exact Vue dependency version, checks both generated lockfile
references, and compares both installed package trees with their extracted candidate bytes.

## Exact Nuxt browser proof

`test/fixtures/nuxt-lifecycle` is built as a production Nitro application from the exact pair. A
deterministic browser transport exercises public Nuxt composables without importing package source.
Headless Chromium proves:

- initial and live query results;
- first-page, empty-continuation, and tail-page pagination;
- argument-boundary data retirement and old-subscription disposal;
- query error normalization;
- mutation and action results;
- opaque plain failures and preserved structured Convex application errors;
- component-unmount cleanup with zero active subscriptions;
- an error-free production browser, request, and console trace; and
- a successful production SSR root render.

The deterministic transport is test infrastructure only. Its dependency symlink lets the shared fixture
resolve the consumer's installed Convex dependency; neither Better Convex package is workspace-linked,
and both package trees are independently byte-compared before build or execution.

## Cross-adapter coverage

The exact Vue candidate matrix continues to prove anonymous, authenticated, and separately bundled
embedded production Vite consumers. In particular it covers provider refresh, same-user new identity
generation, Alice-to-Bob and anonymous transitions, stale call retirement, token-free embedded identity
projection, and disposal. The Nuxt source conformance suite covers the identical shared lifecycle report,
while the exact Nuxt browser runner proves that the packed adapter actually executes query, pagination,
mutation, action, errors, argument retirement, and cleanup in production.

Nuxt-only SSR request isolation and auth hydration remain covered by their existing production E2E and
candidate tests; they are not incorrectly represented as plain-Vue behavior.

## Executed proof

```text
node scripts/check-candidate-apps.mjs --package vue \
  --tarball .release-artifacts/vue/0.8.0-beta.0/better-convex-vue-0.8.0-beta.0.tgz
# 3 maintained production Vite consumers passed

node scripts/check-candidate-apps.mjs --package nuxt \
  --tarball .release-artifacts/nuxt/0.8.0-beta.0/better-convex-nuxt-0.8.0-beta.0.tgz \
  --vue-tarball .release-artifacts/vue/0.8.0-beta.0/better-convex-vue-0.8.0-beta.0.tgz
# 7 pnpm applications, 1 npm consumer, and 1 production browser runner passed

pnpm exec vitest run test/unit/maintained-candidate-apps.test.ts \
  test/unit/release-workflow.test.ts test/unit/package-certification-manifest.test.ts
# 3 files, 57 tests passed

pnpm exec vue-tsc --noEmit
pnpm exec eslint scripts/check-nuxt-lifecycle-consumer.mjs \
  scripts/package-consumer-candidate.mjs scripts/check-candidate-apps.mjs \
  scripts/check-vue-auth-consumer.mjs scripts/vue-candidate-consumer.mjs \
  scripts/maintained-candidate-apps.mjs test/unit/maintained-candidate-apps.test.ts
```

```text
pnpm check
# format, lint, all typechecks, 12 boundary rules / 258 files,
# and 155 test files / 1,795 tests passed
```

## Result

`P9-003` is complete. Installed Vue and Nuxt package bytes now have production lifecycle evidence in
addition to source conformance, without adding a public compatibility layer, copied controller, or
workspace-only certification path.
