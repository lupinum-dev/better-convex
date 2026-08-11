# Ginko asset terminal-authorization stabilization — 2026-07-23

## Scope

- Ginko branch: `codex/better-convex-vnext-stabilization`
- Completion commit: `c4ddd26a`
- Stabilization task: `S5-002`

## Change

Asset-recovery actions still authenticate and authorize before reading or
writing storage, but their terminal database mutations now resolve the initiating
user against current canonical membership and role state.

- Artifact creation rechecks `canManageAssetRecovery` immediately before the
  artifact/activity transaction.
- Restore rechecks the same authority immediately before inserting the restored
  asset and activity attribution.
- Attribution comes from the newly resolved current member, not the identity
  object captured before action/storage awaits.
- Asset replacement keeps its existing `canManageAssets` terminal check and
  calls the shared record handler only from that already-authorized mutation;
  editors did not accidentally acquire or lose independent recovery authority.

No token role, client assertion, or frontend preflight grants authority.

## Executed proof

```text
./node_modules/.bin/vitest run test/component/asset-recovery.test.ts
./node_modules/.bin/vitest run \
  test/component/asset-replacement.test.ts \
  test/component/asset-recovery.test.ts
./node_modules/.bin/eslint \
  packages/convex/src/assetRecovery.ts \
  test/component/asset-recovery.test.ts \
  --max-warnings=0
./node_modules/.bin/oxfmt --check \
  packages/convex/src/assetRecovery.ts \
  test/component/asset-recovery.test.ts
```

Results:

- 17/17 recovery tests passed.
- 20/20 combined replacement/recovery tests passed.
- Focused lint and formatting passed.
- New regressions prove an owner demoted after action entry cannot record the
  recovery artifact, and a removed owner cannot restore an asset. Both failures
  leave canonical rows and activity unchanged.

The full workspace typecheck is intentionally deferred to `S6-004`: Ginko's
manifest points at unpublished exact Better Convex prereleases, and the
stabilization freeze forbids generating or substituting an earlier artifact.
The initial package-manager invocation failed closed on that unavailable
registry version; no dependency fallback was introduced.
