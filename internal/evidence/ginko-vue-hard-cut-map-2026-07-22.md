# Ginko Studio Vue hard-cut map — 2026-07-22

## Outcome

The current Better Convex Vue/Nuxt surface is sufficient for the Ginko Studio migration. No new
Better Convex public lifecycle hook, metadata channel, authorization abstraction, or user-profile
bridge is justified.

The migration should be a hard cut:

1. the Nuxt host passes `useConvexAttachment()` instead of `useConvex()` and host-created Vue refs;
2. the separately bundled Studio installs `createBetterConvex({ runtime: attachment })`;
3. Ginko query, pagination, mutation, and action wrappers become thin policy/error projections over
   `better-convex-vue`;
4. the existing generic Ginko subscription, identity-generation, pagination, and callable engines are
   deleted in the same change;
5. Ginko retains its generated-function allowlist, contract compatibility rule, safe user
   presentation, CMS capability policy, upload protocol, and domain error mapping.

This is a read-only implementation map. The Ginko repository was not changed because `EXT-004`
still requires explicit authority for external-repository writes.

## Authority and baseline

The inspected Ginko checkout was clean at:

```text
repository: /Users/matthias/Git/workspace/ginko-cms
branch: codex/latest-libs-migration
commit: a760bfd03d5fc444c05d745df5d1212370cd1ecd
package: @lupinum/ginko-cms@0.2.0-rc.1
current BCN dependency: better-convex-nuxt@0.7.0-beta.0
```

The focused baseline command passed 4 files and 30 tests without changing the checkout:

```text
pnpm exec vitest run \
  test/runtime/cms-studio-query.test.ts \
  test/runtime/cms-studio-query-error.test.ts \
  test/runtime/studio-host-bridge.test.ts \
  test/component/studio-read-pagination.test.ts \
  --reporter=verbose
```

The historical `better-convex-vue@0.8.0-beta.0` / Nuxt candidate pair predates the public Nuxt
attachment. Ginko must consume a newly built exact pair after the cut; the historical artifacts must
not be repacked or reused.

## Why the existing bridge must be replaced

`packages/cms/studio-app/vite.config.ts` builds Studio as an independent Vue application and does not
externalize Vue. The Nuxt host currently places these values on `window.__GINKO_CMS__`:

- a stable `useConvex()` handle;
- Vue refs from `useConvexAuth()`;
- a generated Convex API allowlist;
- config and a sign-out callback.

The stable handle is safe but incomplete: Ginko then reconstructs identity settlement and generation
logic in the Studio. The Vue refs are the wrong cross-bundle abstraction. A ref created by the host
Vue runtime is not a dependable dependency-tracking primitive for a separately bundled Vue runtime.
The comments claiming both bundles share one Vue module instance do not match the production build.

`useConvexAttachment()` is the direct replacement. Its frozen plain-object boundary supplies:

- the replacement-safe allowlisted client handle;
- an identity `snapshot()` / `subscribe()` observer;
- initial-settlement behavior;
- connection observation;
- no JWT, cookie, refresh function, Better Auth session, or replaceable raw Convex client.

The consuming Vue copy converts those observers into its own refs when
`createBetterConvex({ runtime })` is installed.

## Measured duplicated surface

The principal bridge and lifecycle files contain 1,838 lines before the cut:

| File                            |           Lines | Disposition                                                                                   |
| ------------------------------- | --------------: | --------------------------------------------------------------------------------------------- |
| `useStudioConvex.ts`            |             422 | Delete generic mutation/action lifecycle; retain only domain upload code in a smaller module. |
| `useCmsStudioQuery.ts`          |             272 | Replace subscription engine with a thin Better Convex query/error adapter.                    |
| `useCmsStudioPaginatedQuery.ts` |             384 | Replace cursor/generation engine with a thin Better Convex pagination/error adapter.          |
| `useCmsAuthState.ts`            |             100 | Replace cross-Vue refs with a local ref driven by a plain safe presentation observer.         |
| `useAccess.ts`                  |             109 | Replace manual `onUpdate` with `useConvexQuery(..., { auth: 'required' })`.                   |
| `studio-host-context.ts`        |             107 | Reduce to Ginko policy/runtime adaptation; remove client ownership.                           |
| `host-bridge.ts`                |              71 | Validate attachment and application-presentation boundaries instead of raw refs/client.       |
| `studio-host.vue`               |             198 | Attach the runtime and presentation observer; keep generated API/config/sign-out.             |
| `public/types.ts` bridge slice  | included in 175 | Replace `convexClient` and auth refs with typed attachment and observer contracts.            |

Current Studio call-site pressure is real enough to justify the cut:

| Existing entry                | Occurrences | Files |
| ----------------------------- | ----------: | ----: |
| `useCmsStudioQuery(`          |          36 |    22 |
| `useCmsStudioPaginatedQuery(` |          12 |     7 |
| `useConvexMutation(`          |          41 |    17 |
| `useConvexAction(`            |           6 |     3 |
| `useConvexUpload(`            |           — |     3 |
| `useCmsAuthState(`            |           — |     8 |

The target is not a promised line-count number. The acceptance condition is deletion of all generic
lifecycle ownership while retaining only application policy and domain protocols.

## Exact replacement map

| Current Ginko responsibility                             | Replacement                                                                      | Retained Ginko seam                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Host `useConvex()` bridge                                | `useConvexAttachment()`                                                          | None.                                                                             |
| Cross-bundle auth refs                                   | Plain `snapshot()` / `subscribe()` presentation observer                         | Safe display user, sign-out navigation, and provider-facing presentation status.  |
| Studio client injection                                  | `app.use(createBetterConvex({ runtime: bridge.runtime }))`                       | Generated function-reference allowlist remains separate application input.        |
| Live query subscription, generations, stale callbacks    | `useConvexQuery`                                                                 | CMS skip/capability gate and `normalizeCmsStudioQueryError`.                      |
| Pagination cursors, tail replay, empty-page continuation | `useConvexPaginatedQuery`                                                        | CMS skip/capability gate and domain error projection.                             |
| Mutation/action pending state and identity retirement    | `useConvexMutation` / `useConvexAction`                                          | Thin error projection only.                                                       |
| Write contract preflight                                 | Ginko-derived attachment whose client delegates reads and guards mutation/action | `assertHostContractWritable`; backend contract checks remain authoritative.       |
| Access-context manual subscription                       | Required-auth `useConvexQuery`                                                   | Capability interpretation and UI policy.                                          |
| Multipart upload session/claim/fetch                     | Better Convex callables for Convex steps plus Ginko upload orchestration         | File validation, progress, upload URL use, claim protocol, and identity-abort UX. |
| Asset-manager combined facets/page payload               | Separate application-owned facets query plus standard paginated results          | Facet vocabulary, computation, and display.                                       |

## Contract preflight is not a missing Better Convex hook

Ginko currently guards every Studio mutation/action by querying its installed contract before invoking
the write. Adding a public `beforeExecute` option to Better Convex would admit one application's
preflight policy into the generic callable contract and would not remove a source of truth.

The existing embedded API already supports the smaller solution:

1. read the host attachment;
2. create one Ginko-owned delegated attachment with `createBetterConvexAttachment`;
3. delegate `query` and `onUpdate` unchanged;
4. wrap `mutation` and `action` with `assertHostContractWritable`;
5. preserve the attachment's identity and connection observers;
6. install that attachment once in Studio.

This keeps preflight in the application's transport-policy boundary while the Better Convex callable
controller still owns settlement, state, stale-completion retirement, callbacks, and disposal. Convex
functions must continue enforcing the canonical contract and authorization; browser preflight is only
fail-fast UX.

## Facets are not a generic pagination contract

Only `useStudioAssetFinder.ts` consumes pagination `pageData`, and it consumes only
`pageData.facets`. The facets are application vocabulary, not pagination state. Admitting arbitrary
first-page metadata would force Better Convex to define authority, refresh, merge, transform, and stale
behavior for one consumer.

The cleaner Ginko cut is an explicit `getAssetManagerFacets` application query:

- it has one canonical live subscription independent of search/sort/page cursor changes;
- `getAssetManagerData` stops recomputing collection/tag/count facets on every first and tail page;
- the standard Better Convex pagination result remains exactly `{ page, isDone, continueCursor }`;
- Ginko owns facet validation and presentation.

This adds an application query, not a Better Convex abstraction or database projection. The query reads
canonical asset/collection state. No cache or second persistent source of truth is required.

## Access and authority correction

The current `useAccess()` intentionally retains a previous non-null access context when a subscription
emits `null` while the presentation auth ref still says authenticated. The shared Better Convex runtime
already protects authenticated refresh handoffs. Keeping this extra exception can show stale capability
UI after membership removal under the same authenticated identity.

The hard cut should delete that exception. The required-auth query must treat a settled canonical
`null` as no access immediately. Backend authorization remains authoritative for every effect, but the UI
should not retain a contradicted capability snapshot.

## Public API admission conclusions

| Candidate API                             | Decision | Reason                                                                                                             |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| Callable `beforeExecute`                  | Reject   | One application policy; delegated attachment composes existing primitives without lifecycle duplication.           |
| Generic pagination `pageData` / `facets`  | Reject   | One consumer and ambiguous authority/merge semantics; split the application query.                                 |
| User/session profile in attachment        | Reject   | Provider/application presentation data is not Convex transport identity and would broaden the credential boundary. |
| Roles/capabilities in attachment or token | Reject   | Ginko must query current canonical membership and permissions.                                                     |
| Public identity-generation controls       | Reject   | The attachment observer and controllers already own retirement; consumers must not manufacture generations.        |
| Generic upload controller                 | Reject   | Current need is Ginko's domain-specific session/upload/claim protocol.                                             |

No Better Convex production change follows from this inventory.

## Authorized implementation order

When `EXT-004` is cleared, perform one coherent Ginko hard cut in this order:

1. update Ginko to exact planned Vue and Nuxt package versions from the same new candidate set;
2. replace the bridge type and host population with the attachment plus a plain presentation observer;
3. install Better Convex before Studio components mount;
4. build the delegated contract-guarded attachment once at the Studio boundary;
5. replace query and access subscriptions;
6. replace ordinary pagination, mutation, and action lifecycles;
7. split asset facets into one explicit canonical query and remove `pageData`;
8. narrow upload code to its domain protocol while using shared callables for Convex mutations;
9. delete the old engines, polling, principal-key generation, and cross-Vue ref bridge immediately;
10. add a source sentinel preventing those ownership paths from returning;
11. run focused, full Ginko, production Studio/Vite, packed Nuxt, and exact-byte candidate tests;
12. only then build the new immutable Vue/Nuxt candidate pair required by `P4-018`.

Do not retain dual bridge shapes, a compatibility flag, the old composables beside aliases, or a
workspace-only dependency path.

## Acceptance evidence for the later cut

The migration is complete only when all of these pass against exact installed package bytes:

- separate Vue-copy production host/Studio attachment and disposal;
- anonymous bootstrap, authenticated settlement, refresh, same-user new generation, A-to-B, revocation,
  and sign-out;
- current query args/capability gate, stale callback rejection, and membership removal to `null`;
- pagination first-page replacement, in-flight tail replay, empty continuation, reset, and disposal;
- mutation/action success, structured application failure, transport failure, callback throw, contract
  mismatch, and identity change while awaited;
- upload identity change before session, during upload, and before claim;
- facet refresh independent of page/filter lifecycle;
- absence of JWTs, cookies, auth provider tokens, raw replaceable clients, raw causes, and host Vue refs
  from the bridge and Studio bundle;
- production Vite and Nitro builds, Ginko full checks, package locks, installed-byte equality, SBOM,
  content manifest, runtime fingerprint, and protected staging.

Until those checks pass, `P4-011` and `P4-012` remain blocked rather than being marked complete from a
design inventory alone.
