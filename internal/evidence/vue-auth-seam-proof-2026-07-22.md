# Vue auth seam admission proof

Date: 2026-07-22

Task: `P4-002`

## Outcome

The lifecycle source cannot move safely before authentication is separated from private client-owner
controls. A private provider-neutral seam now proves the required direction:

```text
provider session observation + Convex token callback
  -> token-free desired identity snapshot
  -> Better Convex-owned setAuth/confirmation/replacement
  -> existing token-free controller identity observer
```

The provider never receives a raw client. The owner-facing port never exposes `fetchToken`. Public
identity snapshots contain no provider session token or Convex JWT.

The first-party proof uses Better Auth's existing public Vue session and bounded Convex token-exchange
contracts. A second callback-style provider implements the same candidate interface without importing
Better Auth.

## Security behavior executed

- initial loading, anonymous, authenticated, and error snapshots;
- synchronous old-primary retirement before authenticated confirmation;
- server-confirmed publication only after `setAuth` reports success;
- same-session refresh without an identity-generation change;
- same-user replacement session with a generation change;
- Alice-to-Bob and authenticated-to-anonymous retirement;
- later server credential rejection failing closed;
- stale `setAuth` configuration callbacks rejected;
- Better Auth session/token secrecy and fetched subject/session-user agreement;
- malformed provider state failing closed with a sanitized public error;
- throwing observer containment and idempotent disposal.

Two defects were found and fixed during the proof: a superseded `setAuth` callback needed a per-client
configuration guard, and a credential rejection after initial confirmation needed to trigger a new
fail-closed identity generation rather than only settle the already-resolved confirmation promise.

## Commands

```text
pnpm exec vitest run --project=unit \
  test/unit/auth-adapter-port.test.ts \
  test/unit/better-auth-browser-adapter.test.ts \
  test/unit/client-owner.test.ts \
  test/unit/client-owner-auth-integration.test.ts \
  test/unit/auth-generation-races.test.ts

pnpm exec vitest run --project=security \
  test/security/auth-atomic-publication.test.ts \
  test/security/auth-failure-recovery-regressions.test.ts \
  test/security/auth-identity-model.test.ts \
  test/security/auth-identity-runtime-model.test.ts \
  test/security/client-auth-first-confirmation.test.ts \
  test/security/client-auth-regressions.test.ts \
  test/security/client-auth-stale-fetcher.test.ts \
  test/security/live-query-primary-reacquisition.test.ts

pnpm run typecheck
pnpm run check:boundaries
```

Results: 5 unit files / 71 tests and 8 security files / 29 tests passed; module, server, and fixture
typechecks passed; 12 architecture rules over 247 files passed; focused lint and format passed.

The listed security commands describe the pre-cutover proof at the task's completion commit. The
Nuxt-owned `client-auth-regressions.test.ts` file was subsequently deleted with the old client engine;
current ASVS ownership and replacement proof are recorded in
[`asvs-client-lifecycle-cutover-2026-07-22.md`](./asvs-client-lifecycle-cutover-2026-07-22.md).

## Required next cutover proof

This proof intentionally does not replace the current production coordinator. `P4-003` must drive
the existing Better Auth sign-in, sign-out, refresh, SSR hydration, transient-retention, and
session-correlation suites through the new seam while performing the atomic Vue package/Nuxt cut. No
temporary cross-package source import is allowed.
