# vNext read-only JWKS stabilization evidence — 2026-07-23

## Scope and decision

This closes audit finding `F-005` and stabilization task `S3-004`.

The pinned Better Auth JWT endpoint creates a key when `getAllKeys()` returns empty. Better Convex no
longer routes public discovery through that write-capable endpoint:

- same-origin `/api/auth/jwks` GET and HEAD are handled by the Better Convex plugin before Better Auth's
  endpoint;
- the handler performs one adapter read, validates and projects public RS256 members, applies the fixed
  retained-key grace, and returns;
- empty discovery returns a coarse `503` with `private, no-store`;
- unsupported methods return `405`;
- malformed stored state fails closed without returning row data;
- the old after-hook cache mutation was deleted.

Automatic key creation is also disabled in the shared JWT adapter. An empty deployment must use the
existing internal `jwksOperatorFunctions(createAuth).rotateSigningKey` action. That action generates and
encrypts through the official Better Auth implementation, then commits through the single atomic Convex
rotation mutation. This is the existing documented pre-traffic ceremony and avoids a second bootstrap
path.

## Executed proof

```text
pnpm exec vitest run test/security/convex-auth-jwks-rotation.test.ts \
  --config vitest.config.ts
  1 file, 21 tests passed

pnpm exec vitest run test/convex/jwks-rotation.test.ts \
  --config vitest.config.ts
  1 file, 4 tests passed

pnpm exec vitest run --project=security \
  test/security/convex-auth-jwks-rotation.test.ts \
  test/security/convex-auth-oauth-provider-integration.test.ts \
  test/security/convex-auth-internal-session.test.ts \
  test/security/proxy-regressions.test.ts
  4 files, 110 tests passed

pnpm typecheck:module
focused ESLint
pnpm format:check
git diff --check
  passed
```

The behavioral matrix proves eight concurrent anonymous empty GETs create zero rows; HEAD and rejected
POST leave a provisioned database byte-for-byte unchanged; direct implicit Better Auth creation rejects;
operator generation preserves versioned private-key encryption; public responses contain no private
members; retired keys remain visible until the exact 21-minute boundary; old secret versions verify
retained keys; concurrent atomic rotation retains one current winner and every prior verification key.

The live-backend rotation and issuance ceremony remains in the full auth concurrency and staging gates
required by `S6-003`; this change does not claim protected deployment evidence.
