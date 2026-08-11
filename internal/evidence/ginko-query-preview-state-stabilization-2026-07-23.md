# Ginko query and publish-preview state stabilization — 2026-07-23

## Scope

- Ginko branch: `codex/better-convex-vnext-stabilization`
- Completion commit: `2303909f9f26fcdb608c6c23cb36c15b85c75441`
- Stabilization task: `S5-006`

## Outcome

Ginko's asset facets query now supplies `{}` explicitly. The shared Better
Convex query adapter no longer interprets the missing argument as `skip`, so
the real no-argument backend query executes.

The three asset APIs consumed by the shared pagination controller now require
`paginationOpts` in their Convex function-reference types:

- `getAssetManagerData`;
- `listAssetsByOwner`;
- `listAssetUsages`.

Ginko's thin pagination policy wrapper applies the same compile-time
`paginationOpts` reference constraint as `better-convex-vue`. The controller
continues to own and inject the pagination arguments; application callers
supply only the non-pagination arguments. A non-paginated query can no longer
enter the wrapper through its declared API.

Starting a new publish preview now synchronously:

1. clears the previous preview;
2. marks impact as requested;
3. enters a truthful pending impact state with no locales, effects, cache tags,
   or old summary;
4. installs only the newly returned preview after readiness and preview calls
   complete.

Blocked, failed, stale, and successful transitions therefore cannot render an
earlier assessment as current.

## Executed proof

```text
npm --prefix packages/contract run build
npm --prefix packages/convex run build

./node_modules/.bin/vue-tsc \
  -p packages/cms/studio-app/tsconfig.json --noEmit
./node_modules/.bin/tsc \
  -p packages/convex/tsconfig.json --noEmit

./node_modules/.bin/vitest run \
  test/runtime/studio-asset-selection.test.ts \
  test/runtime/studio-publish-preview-state.test.ts \
  test/runtime/cms-studio-query.test.ts \
  test/runtime/studio-workflow-components.test.ts \
  test/runtime/readiness-action-handler.test.ts \
  test/component/assets.test.ts \
  test/module/module-bridge.test.ts \
  test/module/package-boundaries.test.ts \
  test/module/package-exports.test.ts

./node_modules/.bin/vite build \
  --config packages/cms/studio-app/vite.config.ts
```

Results:

- Both Studio and Convex component typechecks passed.
- Contract and component builds passed.
- 9 files and 146 focused behavior/package tests passed.
- The production Studio Vite build passed.
- The facets proof observes the actual argument received by
  `useCmsStudioQuery`.
- The publish proof holds the backend readiness request unresolved, verifies
  the old preview is already absent and the public state is pending, then
  resolves the request and verifies only the fresh preview becomes current.
- Direct component tests now supply the required pagination object and retain
  all scope/authorization negatives.

Tracked component metadata was updated offline because invoking configured
Convex codegen would upload repository source. Exact candidate host codegen and
installed-byte repetition remain `S6-003` and `S6-004`.
