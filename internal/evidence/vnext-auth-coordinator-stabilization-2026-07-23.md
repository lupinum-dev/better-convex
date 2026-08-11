# vNext authentication coordinator stabilization — 2026-07-23

## Invariants

- Identity-changing browser operations execute in invocation order.
- One Better Auth public session observation drives identity state and session reconciliation.
- One refresh promise and one Convex confirmation exist per identity generation.
- A current-client rejection, including the first confirmation or refresh, retires protected state
  synchronously and advances identity generation exactly once.

## Change

- Replaced the counter-only pending helper and unused serial queue with one coordinator containing the
  queue, pending accounting, and generation-keyed refresh deduplication.
- Moved session-reconciliation notification into the existing Better Auth browser adapter parser and
  deleted the second `useSession()` observer.
- Removed the adapter notification plus explicit refresh double-confirmation path.
- Deduplicated client confirmation for the same client/generation.
- Made first confirmation, refresh rejection, setup failure, and timeout fail closed.
- Deleted `serial-queue.ts`, `session-observer.ts`, and their duplicated observer suite.

## Executed proof

```text
pnpm exec vitest run --project=unit \
  test/unit/auth-adapter-port.test.ts \
  test/unit/auth-operation-coordinator.test.ts \
  test/unit/better-auth-browser-adapter.test.ts \
  test/unit/session-synchronization.test.ts \
  test/unit/integrated-auth-namespace.test.ts \
  test/unit/callable-lifecycle.test.ts \
  test/unit/client-owner.test.ts
  6 files, 76 tests passed

pnpm exec vitest run --project=nuxt \
  test/nuxt/useConvexAuth.nuxt.test.ts \
  test/nuxt/auth-execution-count-matrix.nuxt.test.ts
  2 files, 9 tests passed

pnpm typecheck
  module, server, and three auth fixtures passed
```

The regression matrix covers queued ordering after rejection, same-generation refresh promise identity,
one session-parser transition, raw provider-error redaction, first/current rejection, duplicate false
callbacks, and all refresh waiters receiving the same fail-closed result.
