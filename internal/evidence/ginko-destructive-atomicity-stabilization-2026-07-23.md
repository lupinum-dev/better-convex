# Ginko destructive workflow and entry atomicity stabilization — 2026-07-23

## Scope

- Ginko branch: `codex/better-convex-vnext-stabilization`
- Completion commit: `47277927eafdce3f1afa0aaf4b6bccd25764cabc`
- Stabilization task: `S5-005`

## Outcome

Ginko now starts its existing high-impact asset-deletion workflow at the
authoritative backend preview:

- the destructive dialog stays closed until the preview resolves;
- the dialog renders the backend summary, warnings, and effects rather than a
  locally inferred impact;
- confirmation executes exactly the prepared single-asset operation and its
  confirmation token;
- execution still recomputes current authority, references, and confirmation
  binding in the terminal mutation;
- sequential bulk trash and its UI/state path were deleted.

Operation confirmation nonces now use platform `randomUUID()` or 256 bits from
`getRandomValues()`. A runtime without secure randomness fails closed; there is
no timestamp/`Math.random()` fallback.

Entry creation is now the sole owner of staged-asset claiming:

- the create contract accepts up to 100 deduplicated staged asset IDs;
- every staged asset must be active, collection-scoped, owned by the current
  actor, unclaimed, and in the target collection;
- all staged assets are validated before writes;
- canonical entry creation and every asset claim occur in the same Convex
  mutation;
- an invalid asset rejects the transaction, leaving no entry and no partial
  claims;
- the Studio clears staged IDs only after successful creation, preserving
  finalized uploads for a retry or the existing bounded cleanup path after a
  failure;
- explicit global uploads are not staged.

The former `attachAssetsToEntry` contract, component mutation, Studio bridge
export, host facades, generated component reference, and post-create network
call were deleted.

## Executed proof

```text
./node_modules/.bin/vitest run \
  test/runtime/studio-asset-trash-dialog.test.ts \
  test/runtime/studio-contract-write-gate.test.ts \
  test/component/assets.test.ts \
  test/unit/operation-hash.test.ts \
  test/refactor/canonical-editorial-core.test.ts \
  test/module/ginko-cli.test.ts \
  test/module/module-bridge.test.ts \
  test/module/package-boundaries.test.ts \
  test/module/package-exports.test.ts

./node_modules/.bin/tsc \
  -p packages/convex/tsconfig.json --noEmit

npm --prefix packages/contract run build
npm --prefix packages/convex run build

./node_modules/.bin/nuxt-module-build build packages/cms
node packages/cms/scripts/build-extras.mjs
node packages/cms/dist/cli/ginko-cms.js init --mcp --cwd playground
node packages/cms/dist/cli/ginko-cms.js init --mcp --cwd test/fixtures/basic

./node_modules/.bin/vite build \
  --config packages/cms/studio-app/vite.config.ts
```

Results:

- 9 files and 118 focused tests passed.
- The Convex component typecheck and clean component build passed.
- The contract, production Nuxt module, and production Studio Vite builds
  passed.
- Tests prove preview-before-dialog ordering, exact prepared-operation
  execution, backend impact rendering, successful atomic claim, full rollback
  when a later staged asset is invalid, cross-owner/cross-collection denial,
  and secure-randomness fallback/fail-closed behavior.
- Template, playground, and basic-fixture asset facades are byte-identical.
- Source and built package scans contain no `attachAssetsToEntry`,
  `bulk-trash`, or sequential `trashAssets` path.

The basic fixture initializer intentionally exits non-zero because that fixture
does not declare host-only direct dependencies; managed hashes were still
updated. Remote playground codegen was not invoked because it would upload
repository source to the configured Convex deployment. The tracked generated
component metadata was updated offline and the component built successfully.
Canonical host codegen and exact-tarball/live repetition remain `S6-003` and
`S6-004`.

The standalone Studio typecheck still reaches the previously recorded
Ginko-wrapper mismatch with Better Convex's stricter paginated-query reference
contract. That unrelated hard cut is not hidden or cast around; it remains in
the next stabilization task with the facets execution proof (`S5-006`).
