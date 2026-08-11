# Cross-Vue-copy attached runtime proof — 2026-07-22

## Outcome

The private lifecycle island now has a minimal opaque attachment proof with two boundaries:

```text
AttachedClientRuntime
  client: stable query/mutation/action/onUpdate handle
  identity: snapshot/subscribe/wait observer

attachClientIdentity(runtime)
  local readonly Vue ref
  settlement refresh
  idempotent dispose
```

The host boundary projects the stable client handle to exactly four methods and projects identity to the
six allowlisted token-free fields. It does not pass a raw Convex client, Vue ref, owner, auth coordinator,
token fetcher, cookie, JWT, user object, role, or permission. Identity errors are copied without their
non-enumerable raw `cause` before crossing the boundary.

The consuming adapter creates its ref with the consumer's own Vue runtime. It subscribes once, closes the
snapshot-before-subscribe race with one immediate reread, never polls, and detaches the host subscription
exactly once even when disposed repeatedly.

## Separate Vue-copy proof

The test builds two independent production ESM bundles with Vite:

- a host bundle that creates the opaque runtime;
- an embedded bundle that converts its observer to a local ref.

Both bundles include their own Vue implementation. Their exported `shallowRef` function identities are
different, proving the test is not accidentally sharing one Vue module instance. The only value crossing
from host to embedded is the plain frozen attached-runtime object.

The executed sequence proves:

1. the host has one identity listener after attachment;
2. Alice generation 1 is visible in the embedded local ref;
3. Alice→Bob generation 2 updates that ref synchronously through subscription;
4. two `dispose()` calls cause exactly one host detach;
5. a later anonymous generation cannot repopulate the disposed embedded state;
6. extra raw-client and token properties supplied by an overbroad host implementation are absent;
7. a raw identity-error cause is absent;
8. neither production bundle contains the runtime token sentinel.

## Executed proof

```text
pnpm exec vitest run --project=unit test/unit/attached-runtime.test.ts --reporter=verbose
pnpm run typecheck:module
pnpm run check:boundaries
```

Result: the two production Vite bundles built and the cross-copy test passed; module typecheck passed; all
12 architecture rules passed across two packages and 242 source files.

The complete repository `pnpm check` also passed after this proof, including the new production-bundle
test.

## Admission result

This remains private Phase 3 proof. It earns the architecture—plain observer plus stable handle—but does
not yet freeze names, return shapes, installation APIs, or a public embedded-runtime export. Phase 4 may
admit the smallest surface only after the same source island powers real plain and embedded Vite
consumers. No polling or token/raw-client compatibility path was added.
