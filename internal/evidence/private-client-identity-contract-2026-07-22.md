# Private client identity contract — 2026-07-22

## Outcome

Client lifecycle code now reads identity through one token-free private contract in
`src/runtime/client-core/**`:

```text
ClientIdentityObserver
  snapshot() -> identity key, identity generation, settlement, safe error metadata
  subscribe(listener)
  waitForInitialSettlement()

ClientIdentityPort extends ClientIdentityObserver
  initializePrimary(candidate)
  failPrimary(generation, error)
```

Queries, mutations, actions, file uploads, and upload queues receive only the observer. The stable client
owner alone receives the control extension needed to confirm a replacement candidate and fail closed.
`ConvexRuntimeContext` exposes the observer independently of its Better Auth coordinator, so lifecycle
consumers no longer walk through an authentication implementation to find identity generation.

The snapshot contains no token, cookie, user object, refresh callback, credential-fetch function, role,
or permission. The enforcing test allowlists its five fields and scans the serialized snapshot for the
active token.

## Hard cut and source of truth

Moved and renamed without a compatibility path:

- `src/runtime/auth/identity-port.ts` to `src/runtime/client-core/identity-port.ts`;
- `AuthIdentityPort` to `ClientIdentityPort`;
- `AuthIdentitySnapshot` to `ClientIdentitySnapshot`;
- `attachAuthPort` to `attachIdentityPort`.

The stable identity-key type and authenticated-key predicate moved to
`src/runtime/client-core/identity-key.ts`. The Nuxt-specific `getConvexIdentityKey(ConvexUser)` mapping
stays in `utils/identity-key.ts`, which re-exports the existing public type/predicate instead of defining
a second key. This keeps Better Auth user extraction outside the shared lifecycle while preserving the
root package's public `ConvexIdentityKey` contract.

The Better Auth client engine remains the only publisher of `identityGeneration`, settlement, identity
key, and safe auth error. Neither the observer nor the runtime context allocates or derives a competing
generation.

## Preserved semantics

- `identityKey` partitions anonymous, Alice, and Bob state.
- `identityGeneration` advances exactly once across Alice→anonymous and Alice→Bob.
- same-Alice credential rotation is owned by the official Convex client's `setAuth` integration and does
  not create a second lifecycle revision.
- unsettled identity continues to pause replacement/live dispatch until settlement.
- failure remains a safe `ConvexCallError` and cannot silently downgrade protected execution.
- identity consumers subscribe to one observer and retain their existing synchronous masking behavior.

## Executed proof

Focused identity matrix:

```text
unit:     client owner, owner/auth integration, auth generation races, identity key, runtime context
security: identity model, runtime identity model, first confirmation, auth failure recovery
Nuxt:     sign-out lifecycle, query identity
browser:  authenticated identity lifecycle
```

Result: 12 files and 91 tests passed.

The complete repository check then passed:

```text
pnpm check
```

Result: formatting, lint, all module/server/fixture typechecks, 12 architecture rules across 241 source
files, and 158 test files/1,808 tests passed.

Static scans find no remaining old identity-port import/type/method and no forbidden dependency in the
private source island.

## Public API admission

No public identity adapter or attached-runtime shape is admitted yet. This is a private seam exercised by
the existing Nuxt implementation. `P3-005` must prove the smaller cross-bundle attachment contract with
separate Vue copies before any embedded surface can become a candidate public API.
