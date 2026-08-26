# RFC: Make user projections converge without silent data loss

- Status: Accepted and implemented
- Date: 2026-08-25
- Target: `@lupinum/better-convex-nuxt` before stable 1.0
- Scope: `createUserProjectionTriggers`
- Decision owner: Better Convex maintainers

## Summary

Better Convex must stop deleting ambiguous user projection rows automatically.

The current helper queries every application row for one Better Auth user. When it finds more than one row, it keeps the first unordered result and deletes the rest. Those rows can contain application-owned fields that Better Auth cannot rebuild. The helper can therefore delete valid application data without knowing which row is correct.

This RFC replaces that behavior with a bounded upsert and an explicit conflict boundary:

- zero matching rows means insert when the canonical user exists;
- one matching row means no-op or patch, depending on the event;
- more than one matching row means fail closed before a callback or database write;
- canonical user deletion still cascades to all matching projection rows within Convex transaction limits because no survivor is intended;
- duplicate inspection and repair remain application-owned;

This is the only architecture change proposed from the Convex Auth v2 comparison. Better Convex keeps Better Auth as its authentication system and keeps its current session, origin, Vue lifecycle, proxy, export, and release boundaries.

## Decision requested

Approve a prerelease hard cut to the user projection helper:

1. Replace automatic survivor selection in create, update, and rebuild with a lookup bounded to two rows.
2. Make create, update, and rebuild fail closed when the lookup proves a conflict.
3. Make update insert from the current Better Auth trigger snapshot when the projection is missing.
4. Keep canonical deletion as an explicit cascade over all matching projection rows.
5. Keep semantic duplicate repair outside Better Convex.
6. Ship one behavior. Do not add a legacy mode, repair framework, or second projection API.

## Why this RFC exists

The review of Convex Auth `v2.0.0-alpha.1` reinforced one useful design rule: authentication infrastructure must make credential and state ownership explicit. Better Convex already follows that rule for sessions, origins, SSR credentials, Vue identity generations, public exports, and release artifacts.

The user projection helper is the exception. It crosses from Better Auth-owned user data into an application-owned Convex table, then resolves ambiguous application state with a destructive library policy.

At the comparison checkpoint:

| Repository           | Revision                                                                |
| -------------------- | ----------------------------------------------------------------------- |
| Better Convex        | `596b085d`                                                              |
| Convex Auth v2 alpha | tag `v2.0.0-alpha.1`, commit `91880c9aeeb108580966523bcd164705dd47690d` |

The upstream review triggered this audit. It does not justify copying the upstream authentication architecture.

## Current behavior and evidence

`src/runtime/convex-auth/user-projection.ts` currently:

1. queries the configured index with `.collect()`;
2. treats the first returned row as the survivor;
3. deletes every later row;
4. calls that cleanup from create, update, and rebuild;
5. silently drops an update when no projection row exists.

The query has no ordering contract. The selected survivor is therefore arbitrary. A duplicate row can contain application-owned profile or product fields that are not recoverable from Better Auth.

The public documentation also says that the helper removes duplicate rows. The current unit suite preserves that behavior. This RFC treats the correction as a public prerelease behavior change, not an invisible cleanup.

The existing public API admission ledger already makes the helper conditional on a bounded-upsert behavior correction. This RFC completes that decision. It does not create a new source of truth.

## Goals

1. Prevent silent deletion when more than one possible survivor exists.
2. Converge a missing projection from the current Better Auth trigger snapshot.
3. Keep Better Auth user data canonical and copied auth fields derived.
4. Keep application-owned fields and repair policy under application control.
5. Preserve one small helper instead of adding a projection framework.

## Non-goals

This RFC does not propose:

- a second authentication backend;
- a Convex Auth compatibility adapter;
- passkeys;
- password hashing, password policy, session storage, or token-format changes;
- an authorization role for the user projection;
- automatic duplicate merging or survivor selection;
- a duplicate repair callback, table, queue, job, registry, or state machine;
- a generic projection library;
- a new diagnostics subsystem or raw auth causes;
- a generic SSR abstraction;
- a split of the auth composition file based only on line count;
- changes to origin validation, package exports, or trusted publishing;
- another limitations or migration ledger.

## Source-of-truth boundary

The ownership model remains:

```text
Better Auth user
  -> Better Auth trigger
  -> derived application projection
  -> application queries
```

Better Auth owns authentication identity and copied user fields. Only those copied fields are derived and rebuildable. The application row can also contain application-owned fields that Better Auth cannot rebuild. Convex functions own application authorization.

The projection must not become an authentication or revocable-authorization source. A projection conflict must not change session validity or credential state.

## Cardinality contract

Create, update, and rebuild must distinguish three states by reading at most two matching rows. Delete keeps a separate all-match query for its explicit cascade.

| Matching rows | `onCreate`              | `onUpdate`                                     | `rebuild`                               | `onDelete`               |
| ------------: | ----------------------- | ---------------------------------------------- | --------------------------------------- | ------------------------ |
|             0 | Insert from `createDoc` | Insert from `createDoc` using the current user | Insert from `createDoc`                 | No-op                    |
|             1 | Idempotent no-op        | Apply `patchDoc`, or skip when absent          | Apply `rebuildDoc`, or skip when absent | Delete the row           |
|     2 or more | Fail closed             | Fail closed                                    | Fail the transaction                    | Delete all matching rows |

### Why update becomes an upsert

The current update handler drops an update when the create event has not produced a row. This can leave the projection missing until a later rebuild.

The update event already contains the current Better Auth trigger snapshot. Calling `createDoc` with that snapshot creates the same row that a later create event would create. A repeated create then observes one row and becomes an idempotent no-op.

This removes event-order dependence without a queue, retry store, or second state machine.

The `now` argument remains the helper invocation time. The first create or update event that inserts the row owns insert-time metadata built from `now`; the RFC does not promise identical timestamps across different event orders. An application that needs canonical Better Auth creation time must derive it from a validated field in the current Better Auth trigger snapshot instead of treating `now` as event time.

### Why create, update, and rebuild fail closed

These paths require one survivor. Better Convex cannot infer which duplicate contains the correct application-owned fields. It must not select, merge, patch, or delete a candidate.

For the conflicting user, the check must happen before `createDoc`, `patchDoc`, or `rebuildDoc` and before any insert, patch, or delete. When `rebuild` is awaited inside one Convex mutation, throwing the conflict aborts that mutation and Convex rolls back its writes and scheduled work. The helper does not promise to reverse callback side effects outside Convex transaction semantics.

### Why deletion is different

Canonical user deletion has no intended survivor. Every row returned by the configured auth ID index declares a relationship to the deleted user. Deleting all matches preserves the existing cascade contract and prevents orphaned projections.

This exception must remain limited to `onDelete`. It does not permit automatic cleanup while the canonical user still exists.

The deletion cascade is atomic only within Convex transaction read and write limits. If the matching set exceeds those limits, the transaction must fail and the operator must use an application-owned repair workflow. Better Convex must not add pagination state or a background deletion job to hide this boundary.

## Conflict failure

Create, update, and rebuild must throw a `ConvexError` whose data is exactly:

```ts
{
  code: 'AUTH_USER_PROJECTION_CONFLICT'
}
```

Direct helper callers inspect `error.data.code`. The error has no additional data and no attached cause. Its message, Convex serialization, and Node inspection may contain the fixed code and a library-owned stack, but no runtime input or upstream error value.

The library-generated failure must not include:

- the Better Auth user ID;
- application row IDs or row contents;
- the table or index name;
- callback input or output;
- a raw cause, message, or stack from another error;
- credentials, tokens, cookies, secrets, or URLs.

The fixed code identifies the violated invariant. It does not diagnose which row should survive. When this error crosses the Better Auth adapter, the existing public auth boundary must replace it with the existing generic auth failure. The projection code and structured error data must not enter the HTTP response, response headers, or captured public logs.

## Repair ownership

Better Convex must not provide a generic repair operation. Only the application knows whether it must keep one row, merge fields, move relationships, archive records, or delete all copies.

The upgrade guidance must tell an operator to:

1. back up the affected application data;
2. inspect duplicate auth ID index entries with an application-owned internal query;
3. choose and execute an application-specific repair;
4. confirm that each canonical user has at most one projection row;
5. upgrade and run the normal bounded rebuild.

The public guide can show this procedure. It must not publish a generic destructive mutation.

## Compatibility and rollout

The package is at `1.0.0-beta.1`. This correction should ship as one prerelease hard cut before stable 1.0.

Applications with no duplicate rows gain deterministic missing-row convergence. Applications with latent duplicates will see create, update, or rebuild fail until an operator repairs the data. That failure is intentional.

The Better Auth adapter awaits these triggers inside canonical user mutations. A projection conflict therefore aborts the affected create or update request and rolls back that Better Auth mutation. It does not only skip projection work. The public auth boundary must keep its existing generic failure and must not expose the projection conflict code or private row data.

`createDoc` becomes reachable from both create and update. It must construct one projection document from its inputs, be safe to call again after a failed transaction, and perform no external side effect. Existing consumers must audit this callback before the hard cut.

The implementation release must:

- call out that automatic duplicate collapse was removed;
- call out that a missing-row update now calls `createDoc`;
- require `createDoc` to remain projection construction without external side effects;
- tell operators to audit and repair duplicates before upgrading;
- tell operators that an unresolved conflict blocks affected Better Auth user mutations;
- state that rows deleted by an older package version cannot be recovered by Better Convex;
- update the existing user synchronization guide and release notes;
- remove the old behavior and its tests in the same change;
- avoid a feature flag, compatibility option, or dual implementation.

No persistent migration code is needed. The application-owned data audit happens before the hard cut.

## Implementation shape

The bounded lookup, update upsert, fixed conflict, runtime tests, migration guidance, and release note form one atomic implementation change. The change must remain buildable and must not introduce a temporary legacy path.

## Required test matrix

| Scenario                                           | Required result                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Create with zero rows                              | Calls `createDoc` once and inserts one canonical row                                                                                  |
| Repeated create with one row                       | Performs no callback and no write                                                                                                     |
| Create with two distinct rows                      | Throws the fixed conflict before callbacks or writes                                                                                  |
| Update with zero rows                              | Calls `createDoc` with the current user and inserts once                                                                              |
| Missing-row `createDoc` throws                     | Calls it once and inserts nothing                                                                                                     |
| Update followed by delayed create                  | Leaves one row; delayed create is a no-op; insert metadata uses the update invocation's `now`                                         |
| Create followed by update                          | Leaves one row; insert metadata uses the create invocation's `now`                                                                    |
| Update with one row and `patchDoc`                 | Patches the one row                                                                                                                   |
| Update with two distinct rows                      | Throws the fixed conflict before callbacks or writes                                                                                  |
| Rebuild with zero rows                             | Inserts one row                                                                                                                       |
| Rebuild with one row                               | Patches or skips according to `rebuildDoc`                                                                                            |
| Real Convex rebuild mutation with a later conflict | Rolls back its earlier Convex writes and scheduled work                                                                               |
| Delete with zero rows                              | Performs no write                                                                                                                     |
| Delete with one row                                | Deletes the row                                                                                                                       |
| Delete within Convex transaction limits            | Deletes every matching row and no unrelated row                                                                                       |
| Delete beyond Convex transaction limits            | Fails atomically and creates no library repair state                                                                                  |
| Callback returns another auth ID                   | Runtime canonical auth ID wins                                                                                                        |
| Conflict rows contain unique app fields            | No create, update, or rebuild conflict path mutates either row                                                                        |
| Private values at direct helper boundary           | `ConvexError.data` is exactly the fixed code object; text, inspection, and serialization expose no runtime input                      |
| Conflict through the real auth HTTP boundary       | Canonical write rolls back; response and captured logs expose no conflict row, auth ID, table, index, callback sentinel, or raw cause |
| Packed application consumer                        | Compiles and proves the published behavior                                                                                            |

The implementation must add negative tests for ambiguous cardinality and disclosure. Happy-path tests alone are insufficient.

## Acceptance criteria

This RFC is implemented when:

- create, update, and rebuild never select or delete an arbitrary survivor;
- their lookup reads no more than two matching rows;
- update creates a missing projection from the current Better Auth trigger snapshot;
- every conflict happens before callbacks and writes for the conflicting user;
- the conflict uses one credential-safe fixed code;
- canonical deletion retains its deliberate all-match cascade;
- duplicate repair remains application-owned;
- no new table, job, queue, registry, state machine, repair callback, or compatibility mode exists;
- the canonical documentation explains the hard cut and pre-upgrade audit;
- focused unit, real Convex transaction, packed-consumer, and security tests pass;
- the relevant repository auth and contract gates pass.

## Comparison findings not adopted here

The comparison produced useful ideas, but most do not belong in this RFC.

| Finding                                     | Decision                       | Reason or reopening gate                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Convex Auth backend or provider             | Defer                          | It would create a second auth architecture. Reopen only after a stable upstream release and a real consumer proves the current provider-neutral Vue seam is insufficient. Start fixture-only.                      |
| Passkeys                                    | Defer                          | The current 1.0 profile deliberately rejects the Better Auth passkey plugin. Reopen with real demand, a stable compatible plugin, and enrollment, recovery, revocation, schema, route, and browser security proof. |
| Copy password or session internals          | Reject                         | Better Auth owns credential policy and session representation. A reimplementation creates a second sensitive source of truth.                                                                                      |
| Hash Better Auth session tokens locally     | Reject                         | Compatibility and migration behavior are not proven, and Better Auth owns the token format.                                                                                                                        |
| Provider-per-component session architecture | Reject                         | Better Convex's problem is framework integration around one Better Auth owner, not building another auth database.                                                                                                 |
| Safe auth initialization diagnostics        | Separate decision              | Useful but independent. Any proposal must use an existing operator channel, keep public failures generic, and expose no raw cause or value.                                                                        |
| Typed projection configuration              | Separate proof                 | Adopt only if official Convex types improve inference without casts, compatibility overloads, a schema registry, or a generic adapter layer.                                                                       |
| Split the auth plugin                       | Separate refactor              | File length alone is not a boundary. Extract only a named invariant owner with less coupling and no new public API.                                                                                                |
| Raise dependency quarantine to seven days   | Separate supply-chain decision | It needs one workspace policy and a controlled urgent-security override. It is not an auth architecture change.                                                                                                    |
| Add a fast unit command                     | No action now                  | `test:watch` and focused Vitest execution already exist. Measure a specific delay before adding another script.                                                                                                    |
| Re-audit low-level auth exports             | Separate pre-1.0 audit         | The existing admission ledger and maintained consumers already justify the current family. Remove only a symbol with evidence and no shim.                                                                         |
| Generic SSR auth abstraction                | Reject                         | There is no second SSR framework consumer. Nuxt owns SSR and Vue owns the provider-neutral browser lifecycle.                                                                                                      |
| Another limitations ledger                  | Reject                         | Update the existing canonical limitations page.                                                                                                                                                                    |
| Weaker host-only origin matching            | Reject                         | Better Convex's exact origin validation is stronger.                                                                                                                                                               |
| Wildcard exports or workstation publishing  | Reject                         | Explicit export manifests and trusted publishing are stronger and already enforced.                                                                                                                                |

## Alternatives considered

### Keep automatic duplicate cleanup

Rejected because the library cannot identify the correct survivor. Unordered selection plus deletion is silent data loss.

### Select a deterministic winner

Rejected because sorting by creation time or document ID makes the selection repeatable but not correct. It still applies library policy to application-owned fields.

### Add a merge or conflict callback

Rejected because it expands a small trigger helper into a repair framework. Complex repair often needs application relationships, backups, audit records, and operator review outside one callback.

### Return a partial rebuild report

Rejected because it permits earlier writes to commit while a later conflict remains. Failing the Convex transaction gives one atomic outcome and needs no second result protocol.

### Keep update-before-create as a no-op

Rejected because it preserves event-order drift. The current Better Auth trigger snapshot and existing `createDoc` callback already provide the smallest correct convergence path.

### Fail deletion on duplicate rows

Rejected because canonical deletion has no valid survivor and the configured index explicitly ties all matches to that deleted user. The existing cascade remains the narrow, intentional destructive operation. Applications that need archival behavior must implement that policy in their projection lifecycle.

### Add a compatibility flag

Rejected because the old behavior is unsafe and the package is prerelease. Two behaviors would make migration harder and keep the destructive path available.

## Decision

Accepted and implemented as a prerelease hard cut. The implementation uses a two-row bounded lookup, fails before projection callbacks or writes on ambiguity, upserts a missing projection from the current update snapshot, retains the intentional all-match deletion cascade, and adds unit, real Convex rollback, packed-consumer, security, migration, and release evidence. It adds no compatibility mode or repair subsystem.
