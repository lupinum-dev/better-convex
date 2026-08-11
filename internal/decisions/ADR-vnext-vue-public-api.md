# ADR: minimum `better-convex-vue` public API

- Status: accepted for Phase 4 implementation; auth seam amended by `D-014`
- Date: 2026-07-22
- Task: `P4-001`
- Depends on: `D-011`, `D-012`, completed Phase 3 lifecycle and packed Nuxt evidence

## Decision

The first Vue package exposes one installation function, the existing user-facing lifecycle
composables, one safe error class, and one isolated embedded-host subpath. Controllers, owners,
identity machinery, query gates, normalizers, test harnesses, and provider-specific auth clients stay
private.

The initial package supports anonymous, provider-authenticated, and attached-runtime installation.
`P4-002` subsequently proved and admitted the provider-neutral browser auth adapter with the existing
Better Auth session/token contracts and a materially different callback provider. `D-014` records why
that proof had to precede the atomic source move.

### Accepted value exports

From `better-convex-vue`:

```ts
createBetterConvex
useConvex
useConvexConnectionState
useConvexQuery
useConvexPaginatedQuery
useConvexMutation
useConvexAction
ConvexCallError
```

`createBetterConvex` accepts exactly one of:

```ts
{
  convexUrl: string
} // standalone anonymous runtime
{
  convexUrl: string
  auth: BetterConvexAuthAdapter
} // standalone provider-authenticated runtime
{
  attachment: BetterConvexAttachment
} // host-owned opaque runtime
```

The options are a discriminated exclusive union. There is no raw-client, client-factory, token,
logger, auth-provider, defaults registry, or catch-all client-options escape hatch in the first cut.
The returned Vue plugin owns per-app state and teardown. The atomic Nuxt/embedded proof admits one
safe host-adapter method on that object plugin:

```ts
attachment(): BetterConvexAttachment
```

`attachment()` is available only after installation and returns the already admitted frozen,
token-free attachment. Readiness and authentication refresh remain private runtime/provider
coordination rather than ordinary plugin controls.

From `better-convex-vue/embedded`:

```ts
createBetterConvexAttachment
```

The host constructor accepts the stable four-method client handle and the plain-object identity
observer, copies only allowlisted methods and fields, and returns a frozen attachment. The base plugin
can consume the attachment; the embedded application never receives a token or replaceable raw client.

Type exports are limited to the declarations required to use those values: plugin/options, stable
client handle, opaque attachment, query/pagination/mutation/action option and state types, skip
sentinels, call status, and the dedicated error-entry fields. Internal identity snapshots remain
private. Type-only declarations do not create parallel runtime entry points.

### Vue composable contract

- composable construction is synchronous;
- queries use the already-selected reactive `'skip'` sentinel, not a second `enabled` option;
- Vue query options omit Nuxt-only `server`, payload, cookie, and `useAsyncData` concerns;
- query and pagination expose `keepPreviousData` plus the existing `required | optional | none`
  execution modes needed by attached authenticated hosts; derived views use Vue `computed`;
- pagination requires `initialNumItems`; Nuxt hydration uses a private runtime-only bridge rather
  than a public `initialPage` option;
- mutation/action retain one named stable callable plus readonly `data`, `status`, `pending`, and
  `error` state; there is no `.safe`, callback, or reset protocol;
- mutation retains the official Convex optimistic-update callback;
- connection state is a separate composable; it is not added to the stable client handle;
- identity generation and controller disposal are enforced internally and are not writable public
  state.

### Explicitly rejected from the first surface

- controller factories and their input/output types;
- client-owner creation/replacement/close APIs;
- identity-generation mutation, raw identity ports, and manual identity notifications;
- `normalizeConvexError` and raw causes;
- `createConvexQueryState`, query execution gates, cache-key helpers, and Nuxt async-data builders;
- a public core package or private workspace runtime package;
- `enabled` alongside `'skip'`;
- pagination `pageData`, facets, arbitrary metadata merge, or a second pagination store;
- auth provider/client methods, user objects, session IDs, or token refs;
- provider clients, provider user/session objects, token refs, raw clients, roles, or permissions;
- Nuxt-only file upload, storage URL, shared-SSR-query, config, user, and Better Auth composables;
- optimistic helper convenience exports in the Vue package. The official `OptimisticLocalStore` API is
  sufficient, so Nuxt deletes its duplicate compatibility helpers as part of the same hard cut.

## Public API admission test

The questions are answered for four cohesive export groups. Ancillary type exports inherit the answer
of the value they describe.

### A. Installation and stable handle

1. **Repeated problem:** Vue roots need one owned Convex client whose captured handle survives identity
   replacement and is disposed with the app.
2. **Official direct solution:** `ConvexClient` provides transport operations but exposes a replaceable
   instance; Vue provides plugin lifecycle but no Convex identity fence. Direct composition does not
   retire awaited calls or rebind subscriptions across replacement.
3. **Existing simplification:** move the already-proven owner once; do not wrap `convex-vue` or create a
   core package.
4. **Two consumers:** current Nuxt post-hydration behavior and the neutral production-Vite lifecycle
   fixture. The embedded fixture additionally needs the same stable handle across Vue copies.
5. **Source of truth:** the plugin owns one runtime per Vue app; Convex remains the data source and the
   host identity observer remains identity authority.
6. **New expensive state:** one in-memory runtime state machine already present in Nuxt; no table,
   cache, job, projection, registry, or key.
7. **Discard:** Vue app unmount disposes clients, listeners, and pending revisions exactly once.
8. **Invalid states prevented:** exclusive standalone/attached options prevent two client authorities;
   the stable handle omits auth, replacement, and close methods.
9. **Authorization:** application Convex functions; the client handle grants no business authority.
10. **Packed proof:** anonymous and attached exact-tarball Vite builds plus the shared lifecycle report;
    later the unchanged Nuxt candidate consumes the exact Vue package.
11. **Deletion:** the private fixture provider glue, then the root private owner path when Nuxt cuts to
    the package.
12. **Failure/rollback:** before publication delete/revert the package cut; after staging publication
    issue a new beta and keep Nuxt pinned to the last certified pair. No canonical data migration exists.

### B. Query and pagination composables

1. **Repeated problem:** reactive args, live subscriptions, pagination cursor chains, identity/gate
   retirement, stale callback rejection, and disposal recur in Nuxt and plain Vue.
2. **Official direct solution:** the JS client supplies `onUpdate` and `query`, but not these Vue
   lifecycle/identity/pagination invariants. The current community Vue client failed the executed stale
   argument and post-disposal callback probe.
3. **Existing simplification:** publish the one Phase 3 controller implementation behind Vue adapters;
   do not expose the controllers.
4. **Two consumers:** current Nuxt query/pagination suites and the neutral production-Vite report.
5. **Source of truth:** Convex query results; local refs are disposable projections partitioned by
   identity and arguments.
6. **New expensive state:** per-composable in-memory state already proved; no shared registry/cache or
   persistence.
7. **Discard:** skip, identity change, args boundary, reset, and scope disposal retire subscriptions and
   derived refs; data is re-fetched from Convex.
8. **Invalid states prevented:** function-reference generics bind args/results; `'skip'` is the only
   non-executing args state; pagination status is one canonical union.
9. **Authorization:** application Convex query guards; UI gating is not authorization.
10. **Packed proof:** exact Vue Vite query/pagination matrix plus Nuxt SSR/hydration and exact-pair
    certification.
11. **Deletion:** private Vite direct-controller glue and Nuxt-owned post-hydration lifecycle branches.
12. **Failure/rollback:** same beta-pair rollback; state is disposable and has no migration.

### C. Mutation/action, connection, and errors

1. **Repeated problem:** calls need settlement, pending/error state, stale awaited completion rejection,
   optimistic mutation support, and replacement-safe connection observation.
2. **Official direct solution:** Convex dispatches calls and exposes connection state, but does not bind
   their Vue state to an identity generation or keep a captured raw client safe across replacement.
3. **Existing simplification:** use one callable controller and the existing owner connection store;
   keep connection observation off the handle.
4. **Two consumers:** current Nuxt mutation/action/connection behavior and the neutral Vite callable
   report; a second packed Vite consumer is required before publication.
5. **Source of truth:** remote Convex result plus one disposable latest-attempt projection.
6. **New expensive state:** no persistence; only per-call refs and the owner's existing connection ref.
7. **Discard:** reset, identity change, replacement, and scope disposal retire revisions/listeners.
8. **Invalid states prevented:** one call-status union and one rejected-Promise error protocol; the
   stable handle cannot close or reauthenticate the client.
9. **Authorization:** application Convex mutations/actions; optimistic state and callbacks are never
   authority.
10. **Packed proof:** successful/error/stale/disposal/optimistic/connection tests in exact Vite and Nuxt
    candidates.
11. **Deletion:** Nuxt callable lifecycle, manual identity notification, and duplicated connection
    ownership.
12. **Failure/rollback:** exact beta-pair rollback; remotely committed effects remain application state
    and are never falsely described as rolled back.

### D. Embedded attachment

1. **Repeated problem:** separately bundled Vue applications need the host's current Convex identity
   without receiving tokens, cross-copy refs, polling, or a stale raw client.
2. **Official direct solution:** neither Vue provide/inject nor Convex supplies a cross-bundle identity
   observer and allowlisted stable handle.
3. **Existing simplification:** freeze and project the already-proven handle/observer; do not build a
   bridge service or token exchange.
4. **Two consumers:** the Nuxt host boundary and the separately bundled embedded Vite application. Ginko
   is a later external proving consumer, not the justification for the shape.
5. **Source of truth:** the host runtime only; embedded refs are local disposable projections.
6. **New expensive state:** no table/cache/job/registry; one listener and one local snapshot per attach.
7. **Discard:** unmount unsubscribes exactly once; the next mount reads a fresh host snapshot.
8. **Invalid states prevented:** the frozen interface contains only query/mutation/action/onUpdate and
   snapshot/subscribe/settlement; tokens and lifecycle mutation are unrepresentable.
9. **Authorization:** host authentication establishes provenance; every application Convex function
   still authorizes current state.
10. **Packed proof:** separate host/embedded Vue copies, credential bundle scans, identity A→B, and
    exact-tarball production builds.
11. **Deletion:** private cross-copy fixture glue after the maintained embedded consumer replaces it;
    Ginko custom lifecycle only after external authorization and proof.
12. **Failure/rollback:** detach the embedded runtime and retain the host; no token or persistent state
    crosses the seam.

### E. Provider-neutral browser auth adapter (`D-014` amendment)

The adapter is the only additional public declaration. Its snapshot remains an
internal return shape so applications do not couple to identity-port vocabulary:

```ts
interface BrowserAuthSnapshot {
  status: 'loading' | 'authenticated' | 'anonymous' | 'error'
  identityKey: string | null
  sessionGeneration: number
  error: Error | null
}

interface BetterConvexAuthAdapter {
  snapshot(): BrowserAuthSnapshot
  subscribe(listener: () => void): () => void
  fetchToken(input: { forceRefreshToken: boolean }): Promise<string | null>
}
```

1. **Repeated problem:** Better Auth, a callback provider, and embedded hosts all need identity-safe
   lifecycle without making the Vue package depend on a provider SDK.
2. **Official direct solution:** Convex accepts a token fetcher but does not supply a Vue provider
   boundary with identity/session generations or replacement-safe state retirement.
3. **Existing simplification:** use the official token-fetcher signature plus one plain snapshot and
   subscription; do not expose a provider client, raw Convex client, or auth state machine controls.
4. **Two consumers:** the existing Better Auth public session/token contracts and an independent
   callback-style provider passed the private proof.
5. **Source of truth:** the provider session remains authentication source; the adapter snapshot is a
   disposable local observation and never application authorization.
6. **New expensive state:** one in-memory session counter and cached still-usable token inside the
   first-party adapter; no persistence, table, registry, job, or provider model.
7. **Discard:** adapter/runtime disposal unsubscribes once and drops the cached token, listeners, and
   raw client references.
8. **Invalid states prevented:** authenticated requires a non-empty key; every other state requires a
   null key; the non-negative safe-integer generation must change for replacement/revocation.
9. **Authorization:** none. The identity key partitions local state only; Convex functions re-read and
   enforce application authority.
10. **Packed proof:** authenticated exact-tarball Vite plus unchanged Nuxt auth/SSR/revocation suites in
    the atomic cut.
11. **Deletion:** current coordinator-to-owner private control seam and proof-only provider adapters
    after maintained package consumers replace them.
12. **Failure/rollback:** reject the adapter before publication or roll both beta packages to the last
    certified pair; no persistent state migration exists.

The adapter never receives `setAuth`, a raw client, replacement/disposal controls, provider user/session
objects, roles, permissions, or server secrets. `identityKey` is a non-secret provider subject used only
for local isolation. `sessionGeneration` changes on replacement/revocation, including same-user new
sessions; safe over-retirement is allowed when a provider cannot distinguish refresh from replacement.
Better Convex owns raw clients, server confirmation, identity retirement, and disposal.

## Consequence

`P4-002` may create the package and move the proven private source once. It must not export more than
this record admits. Any provider-neutral auth adapter, page metadata, testing helper, MCP App surface,
or additional framework integration needs its own executed admission evidence.
