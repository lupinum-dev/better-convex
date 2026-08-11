# Nuxt embedded attachment proof

- Date: 2026-07-22
- Task: `P4-017`
- Decision: `D-016`

## Outcome

Nuxt now exposes the one frozen, token-free runtime attachment it already owns through
`useConvexAttachment()`. The composable reads the per-application attachment and creates no client,
observer, state, subscription, cache, credential bridge, or alternate lifecycle.

The broader internal `$convexRuntime` context remains private. The public value contains only the
stable required/anonymous call handles, identity observation and settlement, and optional connection
observation admitted by `better-convex-vue/embedded`.

## Consumer evidence

The read-only Ginko baseline was inspected at
`a760bfd03d5fc444c05d745df5d1212370cd1ecd` with a clean worktree. Its current Studio owns separate
query, paginated-query, and callable lifecycle implementations and passes a client plus auth
presentation state across its host boundary. This confirms the integration need without authorizing
changes to the external repository.

Before migration, Ginko's focused Studio lifecycle suite passed 29 tests across four files. Those tests
remain the hard-cut acceptance baseline for `P4-011` and `P4-012`; the later migration must replace the
generic engines with the attachment and delete them rather than preserve a compatibility adapter.

## Executed verification

```text
pnpm exec vitest run --project=unit test/unit/module-auto-imports.test.ts
  PASS — 1 file, 3 tests

pnpm exec vitest run --project=nuxt test/nuxt/useConvexAttachment.nuxt.test.ts
  PASS — 1 file, 1 test

pnpm typecheck
  PASS — module, server and security fixtures

pnpm lint
  PASS

pnpm format:check
  PASS — 1,126 files

pnpm check
  PASS — 156 files, 1,796 tests; lint, formatting, typechecks and 12 boundary rules

pnpm check:package-exports
  BUILD PASS — dist contains useConvexAttachment.js and its declaration
  EXPECTED INSTALL GATE — standalone install could not resolve unpublished better-convex-vue

node scripts/check-package-exports.mjs --package nuxt \
  --vue-tarball .release-artifacts/vue/0.8.0-beta.0/better-convex-vue-0.8.0-beta.0.tgz
  PASS — ephemeral current-tree package probe with the exact immutable Vue companion;
         150 source files scanned and 9 entries deep-checked
```

The Nuxt proof establishes:

- the composable returns the exact attachment owned by the current Nuxt application;
- query, mutation, action, and subscription handles exist for required and anonymous calls;
- identity snapshot, subscription, and settlement exist;
- logger, auth-controller, DevTools, and disposal controls do not cross the boundary;
- identity serialization contains no token-, cookie-, authorization-, secret-, or credential-shaped
  field.

The maintained production Nitro lifecycle fixture and runner now assert the frozen runtime, exact
plain-object allowlists, anonymous identity snapshot, and credential sentinels. They intentionally do
not run against the historical `0.8.0-beta.0` pair because those immutable tarballs predate this API.
`P4-018` owns the exact installed-byte production proof on the next versioned pair after the authorized
Ginko hard cut.

## Release integrity

No historical tag, release artifact, or candidate artifact was changed, replaced, or retained from the
ephemeral export probe. The existing `0.8.0-beta.0` hashes remain historical proof only. Publication now
depends on `P4-018`, which must build a new immutable Vue/Nuxt pair from clean post-migration HEAD and
run the amended production fixture against those exact bytes.
