# Ginko simplification hard cut — 2026-07-23

## Scope

This evidence closes BCN ledger task `P9-022` on Ginko branch
`codex/better-convex-vnext-stabilization`. The work preserves Ginko-owned
authorization and effects while deleting presentation and adapter state that
had no producer or distinct policy owner.

## Completion commits

- `2fd3ed1f` — deleted the synthetic asset-folder union, drill path,
  breadcrumbs, back navigation, folder render branches, and their source-only
  test. Backend asset rows now flow directly to list and grid views.
- `6586ab2b` — reduced readiness kinds to the ten values actually produced by
  the backend. Studio dispatch now switches on exact executable kinds; route,
  review-request, and public-page suggestions can no longer invoke an
  unrelated broad-target action.
- `1184aa7d` — made the existing Studio settings projection carry the installed
  contract hashes and transition state. Studio locales and compatibility now
  read one projection; the separate external/MCP contract-inspection query
  remains because it has a distinct non-Studio consumer boundary.
- `0cc43f1b`, `84af23af` — replaced `unknown[]` operation blockers, warnings,
  and effects with typed, runtime-validated values. Domain-specific identifiers
  live under `details`; the focused preview module keeps the operation executor
  below its reviewed size budget.
- `5d9da7fc` — deleted the one-consumer `useAccess` wrapper and made
  `useCmsStudioAccess` own the canonical access query directly.

The publishing workflow already satisfied the accepted one-owner correction:
`useEntryPublishing` owns one resettable `publishSession`, and
`test/runtime/entry-publishing.test.ts` proves stale preview retirement,
outcome clearing, and complete reset. No replacement state machine was added.

## Executed proof

- Focused asset tests: 3 files, 9 tests passed.
- Focused readiness tests: 5 files, 111 tests passed; contract type tests passed.
- Contract projection tests: 4 files, 90 tests passed; Studio `vue-tsc` passed.
- Operation protocol/permanent-delete/hard-cut/size proofs: 4 files, 16 tests
  passed; Convex `tsc` passed.
- Identity/access refresh tests: 3 files, 6 tests passed; Studio `vue-tsc`
  passed.
- Direct repository gates passed:
  - `oxfmt --check`;
  - component-auth, Convex-surface, live-token, docs-install,
    compatibility-matrix, and release-hygiene checks;
  - ESLint with zero warnings.
- Full Ginko test matrix passed: 181 files passed, 1 intentionally skipped;
  1,200 tests passed, 1 intentionally skipped.
- Production Studio Vite build passed: 3,353 modules transformed.

`pnpm check` itself was not used as the final command because pnpm's dependency
status hook attempted to download the intentionally unpublished
`better-convex-vue@0.8.0-beta.15`. The exact candidate tarballs were restored
from Ginko's ignored `.pack/candidate` directory, and the underlying canonical
format, policy, lint, type, build, and test gates were executed directly. This
is a local unpublished-candidate limitation, not a waived product failure.

## Result

All accepted `PA-012`–`PA-016` consequences are now either deleted, corrected,
or narrowed to an already-proven direct owner. Ginko remains the owner of CMS
permissions, publishing policy, destructive previews, canonical state, and
effects. No BCN public API was added.
