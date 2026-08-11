# Vue lifecycle ownership inventory — 2026-07-22

## Outcome

The current client runtime contains one sound lifecycle model, but its ownership is split across generic
helpers and Nuxt composables. Phase 3 must extract that existing model; it must not create a second Vue
engine or move whole directories for symmetry.

No public API or package is admitted by this inventory. The next private boundary should contain only
browser-side Convex lifecycle code and Vue reactivity. Nuxt remains responsible for SSR, request state,
authentication integration, payloads, runtime configuration, and diagnostics presentation.

## Current ownership graph

```text
Nuxt plugins and runtime context
  ├─ Better Auth client engine, token exchange, session synchronization
  ├─ request-scoped SSR state, cookies, useAsyncData, payload hydration
  ├─ logger and DevTools sink
  └─ public Nuxt composables
       ├─ query SSR orchestration ─┐
       ├─ pagination SSR orchestration ─┐
       ├─ mutation/action adapters       │
       └─ useConvex stable handle        │
                                         ▼
Existing framework-neutral lifecycle mechanics
  ├─ replacement-safe client owner and stable handle
  ├─ identity key and generation fencing
  ├─ query execution gate and query state
  ├─ callable state/controller
  ├─ pagination pages/cursor state
  ├─ optimistic update helpers
  └─ normalized Convex errors
```

The problematic edges are direct imports from lifecycle mechanics to Nuxt product diagnostics and the
co-location of client subscription state machines with `#imports` SSR orchestration. They are ownership
problems, not evidence that another runtime is needed.

## Move, retain, split, and delete

| Current boundary                                                                                                                                                    | Decision                                                                     | Reason and target responsibility                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/client-owner.ts` stable handle, call dispatch, subscription rebinding, primary replacement, generation checks, anonymous client, connection state, disposal | **Split then move privately**                                                | These mechanics are browser/framework integration and use only Convex browser contracts plus allowed Vue refs. Replace direct logger/DevTools ownership with a narrow optional event boundary supplied by adapters. |
| `client/identity-changed-error.ts`                                                                                                                                  | **Move privately**                                                           | This is the shared safe failure for work retired across an identity generation.                                                                                                                                     |
| `utils/identity-key.ts`                                                                                                                                             | **Extract the neutral identity partition contract**                          | Key and generation are required by every controller. The current Better Auth user extraction remains an adapter concern until the provider-neutral contract is proven.                                              |
| `auth/identity-port.ts`                                                                                                                                             | **Split**                                                                    | `snapshot`, `subscribe`, and settlement are generic. `initializePrimary(ConvexClient)` and the current auth bootstrap handshake belong to the Nuxt auth adapter. Do not expose tokens in the shared snapshot.       |
| `auth/auth-identity.ts`, `auth/client-engine.ts`, `auth/client-engine-types.ts`, session synchronization and token fetcher                                          | **Retain in Nuxt**                                                           | They own Better Auth/session/token coordination and Nuxt's authenticated client replacement policy, not generic Vue lifecycle.                                                                                      |
| `utils/query-execution-gate.ts`, `utils/query-state.ts`                                                                                                             | **Move privately with controller**                                           | They are deterministic client lifecycle policy with no Nuxt imports. The gate's auth vocabulary may need a neutral input at the adapter seam, but behavior must remain unchanged.                                   |
| live subscription/revision/transform/previous-data branches inside `useConvexQuery.ts`                                                                              | **Extract once**                                                             | One controller must own reactive arguments, subscription replacement, stale rejection, identity/gate clearing, transform, previous data, and disposal.                                                              |
| `useAsyncData`, `useState`, request event, cookie/token lookup, HTTP query, payload/error revival inside `useConvexQuery.ts`                                        | **Retain in Nuxt adapter**                                                   | These are genuinely request- and SSR-specific. The Nuxt composable may remain asynchronous while client execution delegates to the private controller.                                                              |
| `utils/query-foundation.ts`                                                                                                                                         | **Split, do not move wholesale**                                             | It currently mixes generic live-client selection with `#imports`, Nuxt runtime context, SSR auth state, and runtime config.                                                                                         |
| `utils/call-state.ts`, lifecycle/revision/callback logic in `utils/callable-lifecycle.ts`                                                                           | **Move privately**                                                           | Mutation and action already share one controller. Direct DevTools ownership becomes an adapter event hook; generic normalization remains shared.                                                                    |
| `useConvexMutation.ts`, `useConvexAction.ts`                                                                                                                        | **Retain as thin Nuxt adapters**                                             | They resolve Nuxt context, wait for auth settlement, select the stable owner handle, wire product diagnostics, and add mutation-only optimistic behavior.                                                           |
| cursor/page/generation/subscription branches inside `useConvexPaginatedQuery.ts`; `utils/paginated-query-pages.ts`; paginated portions of `utils/query-state.ts`    | **Extract once**                                                             | One controller must own the cursor chain, first and later page subscriptions, one-load-at-a-time behavior, stale page retirement, refresh/reset, and disposal.                                                      |
| `useAsyncData`, `useState`, request cookie/token and HTTP first-page execution inside `useConvexPaginatedQuery.ts`                                                  | **Retain in Nuxt adapter**                                                   | Nuxt owns SSR first-page orchestration and identity-partitioned hydration.                                                                                                                                          |
| `composables/optimistic-updates.ts`, `regular-optimistic-updates.ts`                                                                                                | **Keep as shared-capable dependencies; move only when their consumer moves** | They depend on Convex values/browser types, not Nuxt. Moving early provides no proof and creates churn.                                                                                                             |
| `errors/index.ts`                                                                                                                                                   | **Keep as the existing framework-neutral error authority**                   | It is already one shared public error model. Phase 3 must import it, not fork or relocate its public ownership.                                                                                                     |
| `runtime-context.ts`, client/auth plugins, `utils/logger.ts`, `devtools/sink.ts`, runtime config                                                                    | **Retain in Nuxt**                                                           | They install the runtime and own Nuxt diagnostics/configuration. The private island may emit allowlisted events but must not import these modules.                                                                  |

After each hard cut, delete the old owner/controller implementation at its former location or inside the
Nuxt composable. Temporary re-exports are not required because this is private source. The public Nuxt
composable exports and result behavior remain unchanged.

## Proposed private dependency direction

```text
Nuxt SSR/auth/diagnostic adapters
             │
             ▼
private client lifecycle island
  allowed: vue, convex/browser, convex/server types, existing error/value helpers
  denied:  #imports, nuxt, nitro, h3, better-auth, server runtime, MCP runtime
             │
             ▼
       Convex browser client
```

The source island is not a package and has no public export. P3-002 must choose its exact path and enforce
this direction with the existing AST boundary checker plus positive and negative fixtures. It should not
ban Vue itself: the product being proven is a shared Vue lifecycle, not a framework-free core package.

## Invariants and existing proof anchors

| Invariant to preserve                                                                                          | Current enforcing source                                | Existing proof anchor                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Consumer handle remains stable while the primary client is replaced                                            | `client/client-owner.ts`                                | `test/unit/client-owner.test.ts`, `test/unit/client-owner-auth-integration.test.ts`                                                 |
| Old calls and subscriptions cannot settle into a new identity generation                                       | client owner, identity port, callable lifecycle         | `test/unit/auth-generation-races.test.ts`, `test/unit/callable-lifecycle.test.ts`, `test/nuxt/useConvexQuery.identity.nuxt.test.ts` |
| Multiple Nuxt roots do not share request/client identity                                                       | runtime context and per-app owner                       | `test/nuxt/auth-two-app-isolation.nuxt.test.ts`, `test/helpers/two-app.ts`                                                          |
| Query execution waits, idles, or executes according to auth mode without using background pending as authority | `utils/query-execution-gate.ts`                         | `test/unit/query-execution-gate.test.ts`, `test/unit/query-state.test.ts`                                                           |
| Query subscription callbacks are revision- and identity-bound and disposal removes the subscription            | `useConvexQuery.ts`                                     | Nuxt query suites, including disposed-before-first-value and stale-result cases                                                     |
| Callable promises reject after identity change; callback throws do not rewrite the remote outcome              | `utils/callable-lifecycle.ts`, mutation/action adapters | `test/unit/callable-lifecycle.test.ts`, mutation/action Nuxt suites                                                                 |
| Pagination maintains one cursor chain and normalizes page errors                                               | paginated composable and page helpers                   | `test/unit/paginated-query-pages.test.ts`, Nuxt paginated-query suites                                                              |
| Optimistic updates use the installed Convex local-store contract without Nuxt state                            | optimistic helpers                                      | `test/unit/optimistic-updates.test.ts`                                                                                              |
| Errors have one normalized, serialization-safe authority                                                       | `errors/index.ts`                                       | error and server-caller unit suites plus release security sentinels                                                                 |

Phase 3 must strengthen missing deterministic proofs rather than infer them from current implementation.
In particular, scope disposal must retire late callable completion as well as unsubscribe identity
listeners, pagination tail races need controlled interleavings, and the embedded proof must use separate
Vue copies without passing refs, tokens, or a replaceable raw client across the boundary.

## Extraction sequence and deletion checkpoints

1. Enforce the private dependency island before moving behavior.
2. Move the client owner and delete its old private source path.
3. Split the token-free identity snapshot/subscription/generation seam from Nuxt auth bootstrap.
4. Extract query controller branches, then delete those branches from the Nuxt composable.
5. Move the existing callable controller and delete its diagnostics coupling/old path.
6. Extract pagination controller branches, then delete those branches from the Nuxt composable.
7. Centralize disposal only after all controllers expose the same proven retirement need.
8. Run one source island through Nuxt, plain Vite, and embedded Vite; do not create an experimental second
   engine.

This order follows runtime ownership and risk. It deliberately does not move the root package, add
`better-convex-vue`, publish a core package, choose a public execution gate, or introduce page metadata.
Those decisions remain evidence-gated later in Phase 3 and Phase 4.

## Admission result

The Public API admission test rejects adding anything in P3-001: no unavoidable framework boundary has
yet been implemented, no second consumer has exercised an exact surface, and all required work can occur
behind the current Nuxt API. The inventory therefore adds evidence only.
