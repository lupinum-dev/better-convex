# Nuxt attachment contract closure

- Date: 2026-07-22
- Task: `P4-019`
- Follows: `P4-017`, `P2-016`

## Outcome

The complete contract gate exposed two omissions after `useConvexAttachment()` was admitted:

1. the canonical generated public API reference was stale;
2. a consumer without generated `#convex/api` types could not typecheck direct access to Nuxt's internal
   `$convexRuntime` property.

Both were foundation defects rather than fixture exceptions. The composable now reads through the
existing `readConvexRuntimeContext()` boundary, and the public composables reference documents the exact
embedded-runtime use and security limits. The API generator owns the concise reference-table entry.

## Documentation contract

The documented attachment is client-only and frozen. It is passed to a separately bundled Vue
application and installed with `createBetterConvex({ runtime: attachment })`. Documentation explicitly
states that it contains stable call handles and identity/connection observation—not Better Auth state,
tokens, cookies, provider controls, logger, DevTools, disposal, or application authorization.

## Executed evidence

```text
pnpm docs:api-surface
pnpm run check:api-surface-docs
  PASS — generated reference is current

pnpm exec vitest run --project=nuxt test/nuxt/useConvexAttachment.nuxt.test.ts
  PASS — 1 file, 1 test

pnpm run check:missing-convex-api
  PASS — source consumer typechecks without generated Convex API

pnpm check:contracts
  PASS — old auth runtime absent
  PASS — Nuxt-owned client engine absent
  PASS — API docs, 23 workspace manifests, consumer smoke, missing-API fixture,
         auth-disabled production graph, Better Auth fixtures
  PASS — local Vue/Nuxt builds and all 9 packed Nuxt entry probes

pnpm check
  PASS — formatting, lint, module/server/fixture typechecks
  PASS — 12 architecture rules across 3 packages and 259 files
  PASS — 156 test files, 1,797 tests
```
