# Better Convex vNext remediation plan

Status: active  
Plan authority: target `c4064387d6c7af5efb7726a6efc566a3d73db689` on `vnext`  
Baseline: `a6e76f1f61a483de5dbd3a19003ab35abcf75fad`  
Prepared: 2026-07-26  
Release verdict: **continue after the P0 and P1 fixes**

This plan reconciles the Codex production-first review with Claude's
`vnext-review-report.html`. It includes only work supported by production traces,
executed reproductions, or an explicit verification task. Claude's 72 unverified
candidates are not implementation work by default.

Phases are gates. Tasks inside one phase may run in parallel unless a dependency is
stated. A phase is complete only when every acceptance checkbox and its phase exit
gate are complete.

## Evaluation outcome

- Claude's six consensus P1 findings survive production-code reconciliation.
- Claude's `AUTH-03` streamed-body issue and `BAA-03` schema-emitter divergence are
  promoted to P1 because they respectively defeat an unauthenticated byte cap and make
  the certified public CLI reject committed fixtures.
- Claude missed the raw-call identity crossing, which remains the sole P0.
- Claude also missed or rejected several independently executed findings that remain in
  this plan: unknown-error disclosure, custom-field select/sort failure, unbounded
  bulk/cascade transactions, unbounded `serverConvex`, caller-controlled OAuth time,
  the extra Vue skip dialect, and unsafe MCP diagnostic names.
- Five contested Claude findings were split: structured error opacity, DevTools
  isolation, and `SplitRequired` have concrete bounded fixes; head-page pagination
  invalidation and transient-session retention require explicit tie-breaks before
  implementation.
- The 72 Claude candidates that received no adversarial verification are not adopted as
  a backlog. High-value ones have bounded verification tasks in T5.9; the remainder are
  closed unless new evidence is produced.
- The architecture verdict remains **continue after fixes**, not subsystem redesign.

## Non-negotiable rules

- [ ] Do not publish, stage, or call the candidate stable while any P0/P1 item is open.
- [ ] Do not weaken an auth, identity, transport, artifact, or advisory gate to make it
      pass.
- [ ] Add a failing behavioral/type test before changing each P0/P1 production path.
- [ ] Prefer hard deletion over beta compatibility aliases, overloads, shims, flags, or
      dual paths.
- [ ] Keep one source of truth for identity, schema artifacts, MCP protocol behavior,
      release ordering, and public error projection.
- [ ] Do not add a table, projection, cache, job, service, registry wrapper, or public
      option unless a task below explicitly proves it is required.
- [ ] Preserve exact artifact hashes, SRI, SBOM, content manifests, runtime
      fingerprints, installed-byte comparison, dependency-order publication, and
      protected OIDC.
- [ ] Do not interpret source-text assertions or evidence prose as behavioral proof.
- [ ] Keep application roles, current authorization, high-impact operation state, and
      destructive-operation policy outside Better Convex.

## Reconciliation decisions

### Accepted from Claude

- [x] `MCP-01`: force unary JSON MCP responses.
- [x] `MCPI-01`: recoverable MCP App protocol errors must not brick the App or discard a
      committed result.
- [ ] `NUXT-01`: preserve same-identity SSR hydration through initial auth settlement.
- [x] `REL-01`: replace the unsatisfiable fresh-runner release command with one ordered
      entry point.
- [x] `vue-lifecycle/VUE-01`: fence initial fail-closed reporting with the generation
      captured before the attempt.
- [ ] `BAA-01`: stop full-scanning indexed `in` predicates.
- [ ] `AUTH-01`: make the allowed OAuth provider profile exact and reject unknown
      options.
- [ ] `BAA-03`: make the shipped CLI and repository schema generator emit identical
      bytes. This is P1 because the certified public CLI rejects the repository's own
      committed fixtures.
- [x] `MCPI-02`: make the real browser confirmation POST compatible with its
      referrer/CSRF policy.
- [ ] `AUTH-03`: stream-bound OAuth form bodies before materialization. This is promoted
      from Claude's P3 to P1 because the executed proof consumed 256 MiB at an
      unauthenticated endpoint with a declared 16 KiB bound.
- [x] `vue-lifecycle/VUE-02`: suppress value-identical provider transitions and remove
      redundant `authEpoch`.
- [x] `vue-lifecycle/VUE-03`: fix the no-op recovery path and explicitly decide, with
      security evidence, whether a transient session transport failure retains or
      retires the current identity.
- [ ] `ERR-02`, `REL-02`, `TE-01`, and `TE-02`: remove false or implementation-coupled
      observability/evidence claims while retaining real invariant coverage.

### Merged with Codex findings

- [ ] Claude `NUXT-03` is the same bytes/non-plain-object corruption found by Codex.
- [ ] Claude `REL-03` is the same self-validating candidate-profile duplication found by
      Codex.
- [ ] Claude `MCP-05`/`NORM-03` are part of deleting the public constant `era` context and
      local MCP method classifier.
- [ ] Claude `ERR-01` is handled with the broader public-error opacity correction:
      unknown causes are opaque everywhere, and structured error data remains intact
      without sending UDF frames through SSR.
- [ ] Claude `ERR-03` is handled at the diagnostic boundary, where a sink is made
      non-authoritative once, rather than by wrapping every caller.
- [ ] Claude `vue-controllers/VUE-02` (`SplitRequired`) is accepted as a fail-closed
      pagination correctness task.
- [ ] Claude `vue-controllers/VUE-01` (head-page boundary reset) remains a product
      contract decision. Do not add sequential refetch storms or `endCursor` machinery
      until the bounded acceptance task below is settled.

### Corrections to Claude's report

- [x] Claude's “no P0” conclusion is superseded by the executed raw-`useConvex()` proof:
      a call entering while generation 0 is unsettled can execute on replacement client
      B in generation 1. This is P0.
- [ ] Claude's rejection of `NUXT-02` is not adopted. Its refuters conceded that
      `serverConvex` has no deadline, response bound, or request-abort propagation.
      Codex executed both an orphaned-abort proof and an approximately 2 MiB response
      proof. The corrected fix uses operation-aware limits instead of imposing the SSR
      query deadline on actions.
- [ ] Do not implement Claude's proposed automatic `registerTool` interceptor. It would
      add a second MCP registration owner. Keep explicit `runMcpTool` at the application
      boundary and delete only its unearned diagnostic surface.
- [ ] Do not publish an internal Vue unref helper solely to deduplicate a small Nuxt
      helper. Preserve correct non-plain values with a private implementation unless an
      existing public primitive already has the exact contract.
- [ ] Do not implement live pagination tail `refresh()` on every head change. Cursor
      chaining is sequential and would amplify a busy feed by `O(loaded pages)`.
- [ ] Do not add a permanent “latest prerelease” dependency gate. Reconcile Better Auth
      `1.7.0-rc.1` against the currently published `1.7.0-rc.2` once in the final
      dependency phase; exact pinned reviewed bytes remain authoritative.
- [ ] Do not delete all reviewed-fault-injection tests until their unique production
      invariant assertions have been identified and moved.

---

## Phase 0 — Freeze reproductions and restore a trustworthy release entry point

### T0.1 — One clean-checkout release command

Sources: Claude `REL-01`; Codex release ownership review.

- [x] Choose one canonical command that builds MCP first, then the immutable Vue/Nuxt
      candidate set, then verifies the retained companions.
- [x] Make `.github/workflows/ci.yml`, `.github/workflows/package-preview.yml`,
      `RELEASING.md`, and local rehearsal invoke only that command.
- [x] Delete stale `release:prepare`/candidate-set aliases and source-string assertions
      that preserve the broken order.
- [x] Make a missing companion failure name the missing package and the command that
      produces it; do not expose a bare `ENOENT`.

Acceptance criteria:

- [x] From an empty temporary artifact root, the canonical command reaches pack without
      relying on a developer's retained `.release-artifacts`.
- [x] MCP is built before any Nuxt maintained-consumer verification.
- [x] Each package is packed once; verification never reconstructs the candidate.
- [x] Existing immutable-directory refusal still prevents overwrite.
- [x] Both workflows use the same canonical entry point, verified by parsed YAML or an
      executed workflow contract rather than indentation/substrings.

Verification:

- [x] Run the clean-artifact-root release orchestration test.
- [x] Run `pnpm exec vitest run test/unit/release-workflow.test.ts`.
- [x] Run `pnpm run check:contracts`.

Ledger note (2026-07-26):

- Made `pnpm release:prepare` the sole family entry point. It prepares MCP first and
  then invokes the existing immutable Vue/Nuxt candidate-set path; the independent
  artifact schemas remain unchanged.
- Deleted `release:prepare:set`. CI, package preview, documentation, and local rehearsal
  now name only the canonical command.
- Missing retained companions now report the package and canonical recovery command;
  regular-file and hash/SRI checks remain fail-closed.
- Proof: the empty-root orchestration and parsed-workflow contracts passed in
  `release-workflow.test.ts`; the focused release/preview run passed 24 tests, and
  `pnpm run check:contracts` passed after rerunning with npm-cache access.

### T0.2 — Make the advisory gate capable of producing evidence

Observed state:

- `pnpm audit --prod --json`: 245 production dependencies, zero advisories.
- Full `pnpm audit --json`: pnpm 10.30.3 reproducibly tries to parse a gzip payload as
  JSON.
- `pnpm run check:auth-advisories` therefore fails closed before GitHub/upstream
  queries.

- [x] Reproduce in the exact CI Node/pnpm environment.
- [x] Determine whether a reviewed pnpm update, registry-response correction, or CI
      transport setting fixes the full audit.
- [x] Keep the repository checker fail-closed; do not catch and ignore invalid audit
      output.
- [x] Record exact tool bytes used by the successful release gate.

Acceptance criteria:

- [x] Production and full audits both return parseable reports.
- [x] Exact GitHub tuple queries and imported-upstream advisory queries execute.
- [x] Any exception is explicit, owned, URL-backed, and unexpired.
- [x] `pnpm run check:auth-advisories` exits 0 without bypass flags.

Ledger note (2026-07-26):

- Reproduced pnpm 10.30.3's invalid full-audit JSON in the release runner's Node
  22.14.0 environment. pnpm 10 uses npm's retired quick/legacy audit endpoints;
  pnpm 11 uses the bulk advisory endpoint.
- Hard-cut the root toolchain to the Corepack-verified
  `pnpm@11.5.0+sha512.dbfcc4f81cf48597afd4bc391ffdf12c11f1a9fb83a395bfa6b0a2d9cc2fd8ffebafdb1ccbd529632153f793904c2615b7f09fe1a345473fd1c35845172a8eb1`.
  Moved all pnpm-specific settings into `pnpm-workspace.yaml` and approved only the
  three dependency build identities the install actually requires.
- The restored full audit exposed `brace-expansion@1.1.16`. Widened the existing
  security override to cover every vulnerable version, regenerated and
  supply-chain-verified the lock, and deleted the now-stale repository exception.
- Proof: production audit reports 241 dependencies/zero advisories; full audit reports
  1,280 dependencies/zero advisories; the unchanged fail-closed checker passes both
  audits, nine exact GitHub tuple queries, and the imported-upstream query with zero
  repository exceptions. Three focused configuration/evidence suites pass 30 tests,
  the root typecheck passes, and the post-commit immutable release-evidence suite
  passes all 32 tests against the committed package-manager bytes.

### T0.3 — Lock the red tests before production edits

- [ ] Add isolated red tests for T1.1, T1.2, T2.1, T2.2, T3.1, T3.2, T4.1, T4.4,
      T4.5, and T4.6.
- [ ] Each test must fail for the claimed behavioral reason at the target commit.
- [ ] Store no scratch harness, generated credential, or deployment artifact in the
      repository.

Phase 0 exit gate:

- [x] The release command is satisfiable from a clean artifact root.
- [x] The advisory command produces complete evidence.
- [ ] Every P0/P1 correction has a focused failing regression test.

---

## Phase 1 — Close identity and authentication boundary defects

### T1.1 — P0: capture raw-call generation before auth settlement

Sources: Codex `F-001`; RFC identity rule at
`internal/RFC-better-convex-vnext.md:1393`.

Affected code:

- `packages/vue/src/internal/client-owner.ts`
- `packages/vue/src/use-convex.ts`

Change:

- [x] Capture `identityGeneration` synchronously when raw `query`, `mutation`, or
      `action` dispatch begins.
- [x] After auth settlement and before wire dispatch, reject with the existing safe
      `IDENTITY_CHANGED` outcome if the generation changed.
- [x] Retain the post-wire generation fence.
- [x] Add no new generation counter or compatibility path.

Acceptance criteria:

- [x] A raw query/mutation/action entered in unsettled generation A and settled in
      generation B performs zero wire calls on both clients.
- [x] The returned promise rejects with the normalized identity-changed code.
- [x] A same-generation call still waits and succeeds.
- [x] A generation change after wire dispatch still prevents a stale result from
      resolving.
- [x] The stable public handle itself is not replaced.

Verification:

- [x] Run focused client-owner and public-handle tests.
- [x] Run exact packed Vue consumer tests.

Ledger note (2026-07-26):

- Captured the port generation synchronously at raw-call entry and compared it both
  immediately before wire dispatch and after the wire promise settles. The existing
  owner and stable handle remain the only dispatch path.
- Red proof: query, mutation, and action crossing tests each reached replacement client
  B before the entry-generation fence was added.
- Green proof: `pnpm exec vitest run test/unit/client-owner.test.ts
test/unit/vue-package-runtime.test.ts` passes 43 tests; the Vue package typecheck and
  `pnpm run check:vue-auth-consumer` packed install/typecheck/build pass.

### T1.2 — Fence the special initial fail-closed path

Source: Claude `vue-lifecycle/VUE-01`.

Affected code:

- `packages/vue/src/internal/browser-runtime.ts`
- `packages/vue/src/internal/auth-adapter.ts`

Change:

- [x] Capture the generation before `initializePrimary`.
- [x] Report failure with that captured generation, never with a snapshot read in
      `.catch`.
- [x] Evaluate deleting the special initial path only if the same tests prove the normal
      replacement path fully subsumes it; otherwise take the two-line fence.

Acceptance criteria:

- [x] Initial identity A may be superseded by B while A confirmation is pending.
- [x] A's late rejection cannot fail-close or cancel B.
- [x] B can settle authenticated with `error: null`.
- [x] A genuine same-generation initial failure still fails closed.
- [x] Disposal still cancels an unconfirmed initial credential.

Ledger note (2026-07-26):

- Retained the special startup path because it owns the initial readiness promise; the
  normal replacement listener does not subsume that responsibility.
- Captured generation `0` before `initializePrimary` and used only that value in the
  rejection handler.
- Red proof: `pnpm exec vitest run test/unit/browser-runtime.test.ts` failed because the
  stale Alice rejection advanced Bob to anonymous generation `2`, and a genuine Alice
  rejection double-advanced to generation `2`.
- Green proof: the same command passes all 6 tests, including A→B supersession,
  same-generation failure, and disposal; `pnpm --dir packages/vue typecheck` also
  passes.

### T1.3 — Delete redundant `authEpoch` and value-identical transitions

Sources: Codex `F-011`; Claude `vue-lifecycle/VUE-02`.

- [x] Return early when provider status, identity key, session generation, and error are
      value-identical.
- [x] Keep explicit user-triggered refresh behavior.
- [x] Delete `authEpoch`, its counter, projections, public type field, watcher
      dependencies, and fixtures.
- [x] Let the official client's `setAuth` own same-session token refresh.

Acceptance criteria:

- [x] Re-emitting an identical provider snapshot publishes no identity notification,
      starts no `setAuth`, arms no fail-closed timer, and resubscribes no query.
- [x] A same-user new session still changes `identityGeneration` and replaces the
      client.
- [x] Explicit refresh still confirms and fails closed on a real confirmation failure.
- [x] Packed declarations contain no `authEpoch`.

Ledger note (2026-07-26):

- Deleted the credential-revision counter instead of retaining two lifecycle clocks;
  `identityGeneration` is now the only replacement boundary.
- Value-identical provider emissions return before publication, client auth setup, or
  fail-closed timer creation. Explicit `refresh()` still re-runs `setAuth` and
  confirmation.
- Same-user session generation changes still retire and replace the owned client.
- Proof: 5 focused unit files/68 tests, Vue typecheck, and the packed cross-Vue-copy
  consumer passed. The packed consumer recursively rejects any declaration containing
  `authEpoch`.

### T1.4 — Define transient session failure and make recovery real

Source: Claude `vue-lifecycle/VUE-03`.

- [x] Keep malformed session state and an authoritative unauthorized/401 result as
      fail-closed identity events.
- [x] Tie-break the disputed non-401 case with the full authority trace: upstream Better
      Auth retains usable session data, while Better Convex currently retires the
      identity. Record whether availability or conservative retirement is the accepted
      contract before changing it.
- [x] Regardless of that decision, make `refreshAuth()` call the provider's real session
      refetch and then re-confirm Convex; it must not silently no-op in the error state.
- [x] Preserve raw provider-error opacity.

Acceptance criteria:

- [x] The chosen 503/network behavior is explicit, tested, and consistent between the
      Better Auth adapter, identity port, Nuxt app-facing state, and documentation.
- [x] 401, revoked session, malformed user, and token/subject mismatch still fail
      closed.
- [x] `refreshAuth()` performs one provider refetch and can recover without page reload.
- [x] A raw transport message/cause never reaches public state or logs.

Ledger note (2026-07-26):

- Accepted Better Auth's own authority rule: its session atom retains prior data for a
  non-401 failure and clears it for 401. Better Convex now retains only an already
  established session whose token and user id are unchanged; it never establishes or
  changes identity from an errored response.
- Kept 401, malformed session/user data, Convex rejection, and token-subject mismatch
  fail-closed. Raw session/refetch errors are replaced with the generic public
  authentication error.
- Made provider session refetch a required adapter operation. `refreshAuth()` now
  refetches first, then either confirms the retained client or waits for a recovered
  generation's replacement client to confirm.
- Red proof: the adapter retired Alice on a same-data 503, and refresh from an error
  state called no provider operation and allocated no replacement.
- Green proof: 5 focused files/32 tests, Vue and root typechecks, and the exact packed
  authenticated Vue consumer pass. The packed proof also now enforces that a
  value-identical provider notification performs zero token fetches while explicit
  refresh performs exactly one.

### T1.5 — Tie-break app-facing fail-closed state propagation

Source: Claude unverified `OWN-01`.

- [ ] Reproduce or refute the claim that the Vue identity port can be failed closed
      while Nuxt's app-facing auth state still reports authenticated.
- [ ] If reproduced, project the existing canonical identity error; do not create a
      second auth state machine.
- [ ] If refuted, record the exact production trace and remove this item.

Acceptance criteria if reproduced:

- [ ] App-facing auth state, query gating, and identity-port state agree after
      fail-closed settlement.
- [ ] Recovery is driven by the canonical provider/identity transition.

### T1.6 — Avoid the unused eager client in auth-enabled startup

Source: Claude unverified `vue-lifecycle/VUE-04`, independently source-confirmed.
Depends on T1.2.

- [ ] In auth-enabled mode, do not construct a primary Convex client/WebSocket while
      provider identity is still loading.
- [ ] Let the first settled identity transition create the first appropriate primary.
- [ ] Keep auth-disabled mode eager and simple.
- [ ] Delete the special initial-client path if T1.2's tests prove it is fully subsumed.

Acceptance criteria:

- [ ] Loading→authenticated and loading→anonymous each construct one primary client, not
      an immediately discarded extra client.
- [ ] No primary WebSocket opens during unresolved auth loading.
- [ ] Auth-disabled startup behavior and public readiness remain unchanged.

Phase 1 exit gate:

- [ ] Every identity-crossing test passes for query, mutation, action, subscription,
      initial confirmation, refresh, disposal, and A→B→A replacement.
- [ ] One public identity revision remains: `identityGeneration`.

---

## Phase 2 — Reconcile MCP and MCP Apps before freezing final protocol bytes

### T2.1 — Force unary JSON response mode

Source: Claude `MCP-01`.

- [x] Change the official handler configuration from `responseMode: 'auto'` to
      `'json'`.
- [x] Keep the 64 KiB request cap, 1 MiB response cap, 30-second deadline, JSON content
      type requirement, abort propagation, and per-request disposal.
- [x] Do not admit SSE into the Convex HTTP action.

Acceptance criteria:

- [x] A tool that records one effect and emits a mid-call progress notification returns
      HTTP 200 `application/json`.
- [x] The client receives the structured result and the effect occurs exactly once.
- [x] No committed result is converted into an empty 502.
- [x] Ordinary tools retain byte-compatible JSON-RPC responses.

Ledger note (2026-07-26):

- Changed only the official per-request response mode; the existing JSON content-type,
  request/response byte bounds, deadline, abort path, and disposal path are unchanged.
- Red proof: the real client called a tool that committed once and emitted related
  progress; `responseMode: 'auto'` upgraded to SSE and the unary boundary returned an
  empty HTTP 502.
- Green proof: the same request returns HTTP 200 `application/json` with the structured
  result and exactly one effect. Four focused MCP suites pass 36 tests, and the MCP
  package typecheck and build pass.

### T2.2 — Make recoverable App protocol errors non-terminal

Source: Claude `MCPI-01`.

- [x] Remove `app.onerror = fail` as a phase transition.
- [x] Delete `hasError` if no longer needed.
- [x] Keep connect rejection and actual transport close as terminal lifecycle signals.
- [x] Remove post-await readiness checks that can discard an already-committed result;
      keep pre-call readiness and disposal fencing.

Acceptance criteria:

- [x] Unknown/late response IDs and unknown progress tokens leave the App usable.
- [x] The next tool call still reaches the host.
- [x] A recoverable protocol error during an in-flight tool call does not discard the
      committed result.
- [x] Connect failure and transport close still produce a non-ready state.
- [x] App listeners and the private official `App` are disposed exactly once.

Ledger note (2026-07-26):

- Removed the SDK's out-of-band `onerror` callback from the lifecycle state machine.
  Pre-call readiness remains strict; after an awaited host operation, only disposal is
  fenced, so a recoverable protocol diagnostic cannot erase a committed result.
- Red proof: an unknown-response error emitted during an in-flight tool call moved the
  composable to `error`, and the post-await readiness check discarded the returned
  result.
- Green proof: unknown response/progress diagnostics leave the phase ready, the
  in-flight result resolves, and the next call reaches the host. Connect rejection,
  teardown, listener removal, and close-once behavior remain covered. The focused unit
  tests, existing real-Chromium MCP Apps proof, Vue typecheck, and Vue build pass.

### T2.3 — Make high-impact confirmation work in a real browser

Source: Claude `MCPI-02`.

- [x] Remove the browser-proof Origin rewrite.
- [x] Prefer retaining exact Origin validation and changing `Referrer-Policy` to a
      policy such as `strict-origin` that sends Origin without leaking the opaque
      locator path.
- [x] If `Sec-Fetch-*` is used instead, prove browser coverage and document why missing
      headers fail closed.
- [x] Never “fix” this by broadly accepting `Origin: null`.

Acceptance criteria:

- [x] Real Chromium submits the scriptless confirmation form with no harness header
      rewriting and receives the expected 303.
- [x] Cross-site navigation is rejected.
- [x] GET remains inert; confirmation remains POST-only with an empty bounded body.
- [x] The locator is absent from DOM, logs, and full Referer paths.

Ledger note (2026-07-26):

- Selected exact Origin plus `Referrer-Policy: strict-origin`; `Sec-Fetch-*` is not an
  authorization input. The browser now sends the application Origin and an origin-only
  Referer, while `Origin: null`, missing Origin, and hostile cross-site Origin remain
  rejected.
- Red proof: after deleting the harness Origin substitution, the real Chromium form
  POST received 403 under `no-referrer`.
- Green proof: the same unmodified browser POST reaches the handler with
  `Origin: https://notes.example.invalid`, Referer `https://notes.example.invalid/`,
  and an upstream 303. The focused browser proof and direct local-Convex interaction
  matrix pass; the latter covers null/missing/cross-site rejection, inert GET,
  POST-only confirmation, and the empty bounded body.
- [ ] CSP, `frame-ancestors 'none'`, private/no-store, user binding, expiry, and
      exactly-once effect semantics remain intact.

### T2.4 — Return protocol ownership to the official SDK

Sources: Codex `F-007`; Claude `MCP-05` and `NORM-03`.

- [ ] Delete the local stateful-method registry and pre-parser.
- [ ] Delete `ConvexMcpRequestContext`, the constant public `era`, and the third
      `configureServer` callback argument.
- [ ] Configure official subscription limits and verify exact final-SDK rejection
      behavior.
- [ ] Keep Better Convex ownership limited to authentication, allowlisting, bounds,
      deadline, abort, and lifecycle disposal.

Acceptance criteria:

- [ ] Packed callback signature is `(context, access, server)`.
- [ ] No RC protocol term appears in public declarations.
- [ ] Subscription/listen methods cannot create durable transport state.
- [ ] Official SDK JSON-RPC errors are returned rather than wrapper-specific empty 405
      responses.
- [ ] Request and response bounds still hold.

### T2.5 — Delete the unearned diagnostic projection

Sources: Codex `F-009`; Claude `ERR-04`, `ERR-07`, and `MCP-02` discussion.

- [ ] Delete `McpToolDiagnostic`, its options, `causeName`, constructor-name
      inspection, single-valued classification, and `onDiagnostic`.
- [ ] Keep one-argument explicit `runMcpTool` with its fixed unexpected-failure result.
- [ ] Keep explicit application/domain error projection inside each tool.
- [ ] Do not add an automatic `registerTool` interceptor or second registry.

Acceptance criteria:

- [ ] Error name, constructor name, message, data, stack, and cause sentinels never
      enter unexpected MCP failure results.
- [ ] Maintained tools still return allowlisted application error codes.
- [ ] Throwing observability code cannot affect tool outcome because no public
      observability hook remains.
- [ ] Packed exports contain no diagnostic interfaces.

### T2.6 — Final official MCP reconciliation

- [ ] Wait for the final `2026-07-28` specification and compatible official TypeScript
      SDK bytes; do not infer finality from the current beta dist-tag.
- [ ] Diff final protocol/SDK behavior against the private RC interaction and Apps
      implementation.
- [ ] Delete obsolete RC types and code instead of retaining compatibility.
- [ ] Run official conformance, neutral consumer, maintained starter, packed tarball,
      and real-host evidence.

### T2.7 — Narrow remaining MCP auth surface

Sources: Claude `MCP-04`, `MCP-08`, and `MCP-09`; independent consumer trace.

- [ ] Replace the broad resource-server `OAuthMetadata` option with the minimum issuer
      input actually consumed; authorization-server discovery remains owned by the
      authorization server.
- [ ] Use one internal issuer canonicalization rule for OAuth and preconfigured bearer
      modes, including exact reviewed loopback development origins.
- [ ] Delete `McpAccessVerificationFailure.code` if the final consumer search still
      shows only tests; public challenges remain static.
- [ ] Keep `createBetterAuthMcpAccessVerifier`: Ginko is a real production consumer and
      the verifier prevents provider-private session state entering `McpAccessContext`.

Acceptance criteria:

- [ ] Protected-resource GET/HEAD/OPTIONS/CORS behavior remains exact.
- [ ] The resource handler does not serve an independently authored authorization-server
      metadata document.
- [ ] Both authorization modes accept/reject the same canonical issuer classes.
- [ ] Verifier failures still produce the fixed public challenge without an unconsumed
      internal discriminant.

Phase 2 exit gate:

- [ ] One explicit tool reaches one explicit application operation.
- [ ] One protocol implementation parses and classifies MCP messages: the official SDK.
- [ ] A committed effect cannot be surfaced as transport/App failure.
- [ ] No bearer, cookie, provider-private value, raw cause, or mutable SDK object enters
      an MCP App.

---

## Phase 3 — Correct Nuxt SSR, query, pagination, and error boundaries

### T3.1 — Preserve Convex values during reactive normalization

Sources: Codex `F-002`; Claude `NUXT-03`.

- [ ] Recurse only into refs, arrays, and plain records.
- [ ] Preserve `ArrayBuffer` and every other supported non-plain Convex value.
- [ ] Use one private Nuxt normalization contract for SSR keys, hydration keys, and
      call arguments.
- [ ] Reuse the exact Vue semantics through an existing private embedded boundary if
      that requires no new export; otherwise keep a small private Nuxt implementation.
- [ ] Do not add a new public cross-package utility solely for this helper.

Acceptance criteria:

- [ ] Byte arguments reach Convex as the original bytes.
- [ ] Different buffers produce different keys.
- [ ] Regular and paginated SSR/client keys agree.
- [ ] Existing nested-ref behavior remains unchanged.

### T3.2 — Preserve same-identity SSR payload through initial settlement

Source: Claude `NUXT-01`. Depends on T3.1.

- [ ] Carry the already-computed SSR identity provenance with initial query/page data.
- [ ] Retain data only for the matching first settlement.
- [ ] Clear synchronously on anonymous↔authenticated mismatch, A→B, and every later
      generation change.
- [ ] Remove the redundant paginated first-page refresh once same-identity hydration is
      proven.
- [ ] Extend the Nuxt test harness so the identity port can start unsettled.

Acceptance criteria:

- [ ] `auth: 'optional'` and `'required'` retain matching hydrated data with no flash to
      empty and no duplicate client query.
- [ ] SSR A hydrated by browser B or anonymous is cleared before use.
- [ ] A later A→B→A transition still clears generation-bound data.
- [ ] Payload, `useAsyncData`, query-error, and pagination state purge once on a genuine
      identity crossing.

### T3.3 — Give SSR and public server calls one bounded transport owner

Source: Codex `F-006`; this deliberately overturns Claude's `NUXT-02` rejection.

- [ ] Generalize the existing bounded fetch from `query-execution.ts`.
- [ ] Use it for both SSR queries and `serverConvex`.
- [ ] Propagate the incoming request abort signal.
- [ ] Use private operation-aware deadlines; do not force an 8-second query deadline on
      long actions.
- [ ] Apply a documented response-size cap to query, mutation, and action responses.
- [ ] Delete `createClassifiedConvexFetch`.

Acceptance criteria:

- [ ] Client disconnect aborts upstream work.
- [ ] Never-settling query/mutation/action calls terminate at their reviewed deadline.
- [ ] Declared and streamed oversize responses fail at the boundary without full
      buffering.
- [ ] Status-560 structured application errors and opaque non-560 transport errors keep
      their intended classification.
- [ ] Packed Nitro behavior matches source tests.

### T3.4 — One public opacity rule for errors

Sources: Codex `F-003`; Claude contested `ERR-01`.

- [ ] Preserve the reviewed message only for an explicitly constructed
      `ConvexCallError`; preserve structured application `data`, `code`, `status`, and
      `kind`.
- [ ] Give raw wire `ConvexError` and every unknown string/object/Error cause a fixed
      opaque display message.
- [ ] Apply the same rule in browser, SSR, and server boundaries; do not create a
      client/SSR asymmetry or serialize Convex/UDF frames and upstream bodies.
- [ ] Delete the server-only duplicate workaround after the central boundary is correct.

Acceptance criteria:

- [ ] Secret/stack sentinels are absent from state, promises, callbacks, JSON,
      structured clone, inspection, SSR HTML, DevTools, and packed consumers.
- [ ] Structured application `data`, `code`, and `status` remain byte/value equivalent.
- [ ] `cause` remains non-enumerable and non-transferable.
- [ ] Tests no longer require arbitrary unknown messages to survive.

### T3.5 — Make diagnostics non-authoritative and delete dead controller hooks

Sources: Claude `ERR-02` and contested `ERR-03`.

- [ ] Delete callable-controller observability handlers with no production supplier.
- [ ] Do not add a new application callback merely to report callback failures.
- [ ] Isolate the remaining Nuxt DevTools sink inside `callable-devtools.ts` so no sink
      throw can alter dispatch or settlement.
- [ ] Keep application `onSuccess`/`onError` exceptions unable to replace the remote
      outcome.

Acceptance criteria:

- [ ] A throwing `registerMutation` sink cannot prevent dispatch.
- [ ] A throwing `updateMutation` sink cannot turn a committed success into rejection.
- [ ] `.safe()` always resolves to its `CallResult`.
- [ ] `execute()` rejects only with the call's normalized error.
- [ ] Dead hook declarations and tests are removed rather than supplied speculatively.

### T3.6 — Keep one explicit query skip sentinel

Source: Codex `F-008`.

- [ ] Narrow Vue query/pagination arguments to `Args | 'skip'`.
- [ ] Reject runtime `null`/`undefined` with a clear error.
- [ ] Add no deprecated overload or nullable compatibility path.

Acceptance criteria:

- [ ] Source and exact packed type tests reject direct/ref/getter `null` and
      `undefined`.
- [ ] Explicit `'skip'` transitions remain reactive.
- [ ] Maintained consumers convert nullable UI state themselves.

### T3.7 — Make pagination ownership and incomplete-page behavior explicit

Sources: Codex `F-012`; Claude contested controller `VUE-01`/`VUE-02`.

- [ ] Make the pagination controller the only subscription initiator.
- [ ] Honor structured `pageStatus: 'SplitRequired'`; do not render a possibly
      incomplete page as ready.
- [ ] Add exact subscribe/unsubscribe count tests for auth, args, identity, and disposal.
- [ ] Decide the head-boundary contract with an executed realistic-feed test:
      documented safe reset, observable restart, or bounded `endCursor` implementation.
- [ ] During final SDK reconciliation, compare a hard cut to the pinned official
      paginated-update primitive against retaining the manual tail algorithm. Prefer the
      hard cut only if it deletes ownership and keeps experimental types private.
- [ ] Do not call sequential `refresh()` per live head update.

Acceptance criteria:

- [ ] One boundary transition creates one replacement subscription.
- [ ] `SplitRequired` data is withheld and a non-ready/error state is visible.
- [ ] `SplitRecommended` continues normally.
- [ ] No gap/duplicate appears across page boundaries.
- [ ] Sequential cursor dependency and synchronous identity clearing remain intact.

### T3.8 — Remove dead query mirrors and give one-shot refreshes real identities

Sources: Claude unverified Vue lifecycle `VUE-06`, controller `VUE-06`/`VUE-07`, and
Nuxt `NUXT-09`, independently source-confirmed.

- [ ] Delete the per-composable identity-generation mirror/subscription if the final
      caller search confirms its value and settlement promise are unread.
- [ ] Give overlapping one-shot query refreshes a local monotonic sequence so an older
      completion cannot overwrite the newer result.
- [ ] Add a first-page settlement promise to the pagination controller instead of
      making Nuxt issue/await a duplicate query.
- [ ] Reconcile paginated SSR error hydration using the same overlay/clear contract as
      regular queries.

Acceptance criteria:

- [ ] Mounting N queries does not add N unused identity listeners.
- [ ] If two refreshes resolve in reverse order, only the later refresh commits.
- [ ] A hydrated page resolves immediately; a live first page resolves on its first
      value/error without an extra HTTP query.
- [ ] Paginated SSR errors survive hydration and clear on the first live value/error.
- [ ] Long-lived subscription callbacks still use the existing generation fence.

Phase 3 exit gate:

- [ ] Same-identity SSR has no duplicate fetch or flash.
- [ ] Different identities cannot observe retained data.
- [ ] All public call/query/pagination errors satisfy the same opacity contract.
- [ ] Subscription counts are deterministic and bounded by loaded pages.

---

## Phase 4 — Bound OAuth and Better Auth adapter behavior

### T4.1 — Enforce OAuth body caps while streaming

Source: Claude `AUTH-03`, promoted to P1.

- [ ] Replace `request.clone().text()` plus full `TextEncoder` measurement with the
      existing running byte-limit primitive, moved to a neutral private location if
      necessary.
- [ ] Keep the cheap `Content-Length` precheck.
- [ ] Apply the same implementation to authorize, token, and revoke form parsing.
- [ ] Decode and parse only accepted bounded bytes.

Acceptance criteria:

- [ ] Headerless/chunked bodies stop reading at approximately 8 KiB or 16 KiB, not at
      end-of-stream.
- [ ] Exactly-limit input succeeds; limit+1 fails with the fixed reviewed error.
- [ ] Allowed-field and singleton-parameter checks remain.
- [ ] The provider can still read its cloned accepted body.
- [ ] No unauthenticated request can force full materialization beyond the owned cap.

### T4.2 — Remove caller-controlled OAuth verification time

Source: Codex `F-010`.

- [ ] Remove public `nowSeconds`.
- [ ] Capture one real `Date` internally and share it between JOSE and local checks.
- [ ] Use fake system time in tests.
- [ ] Remove returned `OAuthPrincipal.issuedAt` if the final consumer search remains
      empty; continue validating `iat`.

Acceptance criteria:

- [ ] A wall-clock-expired token cannot be accepted by caller configuration.
- [ ] Clock tolerance, issuer, audience, subject, lifetime, and token-class checks are
      unchanged.
- [ ] Packed declarations contain neither the time override nor unused `issuedAt`.

### T4.3 — One exact allowed OAuth provider profile

Source: Claude `AUTH-01`.

- [ ] Derive public field types from the exact installed provider type without exposing
      all upstream options as supported.
- [ ] Keep one runtime allowed-key set for the reviewed subset.
- [ ] Reject every unknown/unreviewed key at construction.
- [ ] Validate or forbid every redirect-capable page option, including signup,
      select-account, and post-login.
- [ ] Retain all current value-level hardening.
- [ ] After the allowed profile is canonical, collapse the admin-provisioning firewall
      onto the same normalized predicate: move scope parsing inside its safe error
      boundary, pass mutating endpoint method explicitly, and fail closed when it is
      absent.

Acceptance criteria:

- [ ] Unknown and newly introduced provider keys fail closed.
- [ ] Absolute, protocol-relative, query-bearing, and fragment-bearing page targets are
      rejected everywhere.
- [ ] All current security profile values remain enforced.
- [ ] The maintained starter contains no silently ignored option.
- [ ] A dependency bump produces a loud review diff rather than widening the profile.
- [ ] Request-time and stored-record profile validation agree over one differential
      corpus and return the reviewed 4xx error instead of an accidental 500.

### T4.4 — Map Better Auth logical fields for select and sort

Source: Codex `F-004`.

- [ ] Use the pinned factory's `getFieldName` once before the component boundary.
- [ ] Map `select` and `sortBy` exactly as `where` is mapped.
- [ ] Delete component-side create-selection behavior the factory never calls.

Acceptance criteria:

- [ ] A custom mapping such as `email -> email_address` works for create, findOne,
      findMany, select, and sort.
- [ ] Returned objects retain Better Auth logical field names.
- [ ] Unknown physical/logical fields still fail closed.

### T4.5 — Index-plan bounded `in` predicates

Source: Claude `BAA-01`.

- [ ] Add a bounded indexed execution path when `in` targets an exact indexed field.
- [ ] Keep `matchesAuthWhere` as final result authority.
- [ ] Reject an oversized value fan-out with one fixed private error.
- [ ] Do not create a second generic query planner.

Acceptance criteria:

- [ ] `findMany`, `count`, `updateMany`, and `deleteMany` with one indexed `in` value
      read work proportional to values/matches, not table size.
- [ ] Results equal the equivalent OR-of-equality form over randomized data.
- [ ] Pagination order/cursors remain stable.
- [ ] OR, insensitive, `not_in`, contains, starts/ends-with retain safe residual
      behavior.
- [ ] The pinned OAuth session-revocation shape no longer full-scans token tables.

### T4.6 — Bound bulk writes and relationship cascades

Sources: Codex `F-005`; Claude unverified `BAA-04`/`BAA-05`.

- [ ] Define one private conservative root/traversal budget.
- [ ] Complete and validate a bounded plan before executing writes.
- [ ] Reject oversized `updateMany`/`deleteMany` before effects.
- [ ] Keep the whole accepted operation atomic.
- [ ] Derive model trigger allowlists and skip cross-component trigger calls/readback for
      models that have no applicable trigger.
- [ ] Do not add a projection, queue, background job, or public limit option.

Acceptance criteria:

- [ ] At-limit work succeeds; over-limit work produces a fixed safe error.
- [ ] Over-limit rejection produces zero committed writes/triggers.
- [ ] Cascades, set-null, cycles, and trigger ordering retain rollback semantics.
- [ ] Cascaded rows without triggers cause zero irrelevant cross-component trigger calls.
- [ ] Deployed evidence demonstrates headroom below Convex transaction limits.

### T4.7 — P1: one schema/metadata artifact renderer

Source: Claude `BAA-03`.

- [ ] Make the shipped CLI and repository generator use one canonical renderer.
- [ ] Avoid making a formatter a shipped runtime dependency merely to normalize output.
- [ ] Support one documented schema-options export form.
- [ ] Delete the second format/staleness authority.
- [ ] Re-record reviewed hashes when canonical bytes legitimately change.

Acceptance criteria:

- [ ] Both entry points emit byte-identical schema and metadata.
- [ ] The shipped CLI `--check` passes against committed reference fixtures.
- [ ] `--check` remains non-writing.
- [ ] Pair-write ordering and runtime fingerprint validation remain fail-closed.

### T4.8 — Reconcile Better Auth RC bytes once

Current npm state on 2026-07-26:

- Candidate: Better Auth/OAuth Provider `1.7.0-rc.1`.
- Published `rc` dist-tag: `1.7.0-rc.2`.

- [ ] Diff only the owned dependency seams from RC.1 to RC.2.
- [ ] Decide explicitly: upgrade and recertify, or retain RC.1 with a recorded blocking
      reason until stable.
- [ ] Re-run provider-profile, adapter, OAuth, browser-session, advisory, and packed
      consumer tests against the chosen exact bytes.
- [ ] Do not add an automatic moving-dist-tag gate.

### T4.9 — Make reusable auth construction idempotent and delete dead protocol surface

Sources: Claude unverified `AUTH-04` through `AUTH-07`, independently source-confirmed
where accepted.

- [ ] Make the package-installed shared JWKS reader a stable internal identity so
      constructing auth twice over the same hoisted JWT plugin is idempotent.
- [ ] Continue rejecting a foreign JWKS adapter.
- [ ] Reduce the session synchronization API to methods with production callers.
- [ ] Delete dead, non-exported OAuth guards and the unused `RETRY_BACKOFF_MS` claim only
      after a final caller/export search.
- [ ] Do not invent retry/backoff behavior merely because an unused constant existed.

Acceptance criteria:

- [ ] Two auth constructions using the same reviewed JWT plugin succeed.
- [ ] A foreign adapter still fails closed.
- [ ] Every remaining synchronization/guard method has a production caller and a test
      for its invariant.

Phase 4 exit gate:

- [ ] Public OAuth bodies, time, profile, and redirect behavior are bounded and
      fail-closed.
- [ ] Better Auth field mapping, indexed reads, bulk operations, and schema artifacts
      each have one owner.

---

## Phase 5 — Hard-delete beta API and proof debt

### T5.1 — Complete beta public API hard cuts

- [x] Remove `authEpoch`.
- [ ] Remove Vue `null`/`undefined` skip types.
- [ ] Remove MCP `era`/request context.
- [ ] Remove MCP diagnostic types/options.
- [ ] Remove OAuth `nowSeconds` and unused returned `issuedAt`.
- [ ] Re-run source and exact-tarball declaration snapshots.
- [ ] Add no aliases, deprecated overloads, or compatibility exports.

### T5.2 — Replace release source-text tests with behavioral proof

Sources: Claude `REL-02`, `TE-02`.

- [ ] Delete assertions over indentation, prose, statement order, and substring counts.
- [ ] Parse workflow structure where structure is the invariant.
- [ ] Execute release commands where behavior is the invariant.
- [ ] Assert the exact 64 KiB, 1 MiB, and 30-second MCP magnitudes behaviorally.

Acceptance criteria:

- [ ] Changing formatting cannot fail a release test.
- [ ] Breaking release ordering, package selection, or a transport magnitude does fail.
- [ ] Tests do not reimplement the production rule in their expected value.

### T5.3 — Correct the “mutation testing” evidence

Source: Claude `TE-01`.

- [ ] Inventory which manually authored fault-injection cases uniquely exercise
      production invariants.
- [ ] Move unique production assertions into normal security/behavior suites.
- [ ] Delete or accurately rename the remaining hand-authored mutant harness.
- [ ] Remove “17 killed security mutants” from attestations unless production code is
      actually mutated by the gate.

Acceptance criteria:

- [ ] No evidence labels hand-authored alternate functions as production mutation
      testing.
- [ ] No unique security invariant is lost.
- [ ] The release gate reports only executed evidence classes.

### T5.4 — Delete candidate-profile mirrors

Sources: Codex `F-013`; Claude `REL-03`.

- [ ] Delete `reviewedRunners` and duplicate exact-list tests.
- [ ] Keep one static package/candidate descriptor.
- [ ] Retain structural shape, safe-path, uniqueness, closed-map, actual-runner, and
      artifact-consumption tests.

Acceptance criteria:

- [ ] Adding/changing a maintained runner requires one authority edit.
- [ ] An unknown runner or package still fails.
- [ ] The validator can fail without editing its expected copy in the same change.

### T5.5 — Make content manifests independent of verifier umask

Source: Claude unverified `REL-04`, independently accepted.

- [ ] Read path, size, and mode from archive headers.
- [ ] Continue hashing the extracted file bytes.
- [ ] Do not derive certified modes from umask-filtered extracted filesystem stats.

Acceptance criteria:

- [ ] The same tarball verified under umask `022` and `077` produces an identical
      content manifest.
- [ ] Executable bin modes match the archive, not the verifier environment.
- [ ] Path traversal, symlink, duplicate-entry, and unexpected-file checks remain.

### T5.6 — Derive physical package pins and repeated manifest policy

Sources: Claude `REL-07`, `TE-06`, and `REL-09`.

- [ ] Derive Vue/MCP physical-version expectations from their own reviewed package
      manifests.
- [ ] Keep `supportedDependencyTuple` scoped to the Nuxt/auth tuple; do not turn it into
      another all-package authority.
- [ ] Hoist identical lifecycle-script/engines policy used by per-package validators
      into one private release policy.
- [ ] Remove copied candidate-set digests only after a downstream-consumer trace proves
      they are unread.

Acceptance criteria:

- [ ] Changing a copied package manifest pin makes every SBOM/validator/probe derive or
      fail from that one source.
- [ ] Exact installed-byte and SBOM validation remain strict.
- [ ] No executable script maintains an independent copy of the same version tuple.

### T5.7 — Remove temporary proof surfaces after final reconciliation

- [ ] Delete `internal/labs/agentic-saas` after extracting a minimal schema-options
      fixture only if it still proves a unique schema vector.
- [ ] Keep `internal/labs/mcp-topology` through final real-host reconciliation; it is an
      active neutral proof consumer despite its `labs` name.
- [ ] Archive historical `internal/evidence` after preserving durable ADRs and the final
      release dossier.
- [ ] Remove obsolete private RC interaction code after final SDK reconciliation.

Acceptance criteria:

- [ ] No maintained test depends on an unmaintained mock application.
- [ ] Generated-schema coverage remains equivalent.
- [ ] Final proof remains reachable without carrying historical intermediate
      narratives as active authority.

### T5.8 — Reconcile published and normative documentation

Claude IDs: `NORM-01` through `NORM-05`.

- [ ] Update `SECURITY.md` only where a production trace proves the current topology or
      package ownership is misstated; do not treat byte age alone as a defect.
- [ ] Make `RELEASING.md` name the one canonical release command and exact staging
      guarantees.
- [ ] Remove obsolete RFC “current source” links and deleted-path diagrams.
- [ ] Remove the `plan.md` stable-publication dependency if that file remains
      non-normative/0.7-specific.
- [ ] Make the decision ledger match the actual removal of MCP RC context.

Acceptance criteria:

- [ ] Every operational security/release claim names an enforcing production path or
      executed gate.
- [ ] No doc claims a staging, mutation, conformance, or artifact property that its
      cited evidence did not execute.
- [ ] Historical intent remains clearly distinguished from current authority.

### T5.9 — Tie-break remaining high-value unverified candidates

These are verification tasks, not pre-approved implementation:

- [ ] `OWN-02`/`OWN-03`: trace query gate matrices and paginated first-page network
      behavior after T3.2.
- [ ] `RECON-03`: review sibling-package advisory tuple coverage against final SDK
      bytes; derive any generalization from certification manifests/SBOMs, not another
      list.
- [ ] `MCP-07`: verify SDK error diagnostics after T2.4 without adding another public
      sink absent a concrete operator consumer.
- [ ] `MCPI-04`/`MCPI-05`/`MCPI-06`: measure final App payload and re-check interaction
      contracts after RC code deletion.
- [ ] `REL-05`: verify a monotonic retired-version rule before replacing the growing
      reviewed list.
- [ ] `TE-04`/`TE-06`/`TE-09`: replace only after showing the present test can pass with
      broken behavior.
- [ ] Vue/controller dead-surface candidates: enumerate production callers after Phases
      1 and 3, then delete only members with zero callers and zero invariant.
- [ ] Better Auth `BAA-09`: replace legacy id-only database overloads with table-checked
      overloads opportunistically after relationship tests prove equivalence.
- [ ] Error cleanup `ERR-04` through `ERR-09`: after diagnostic deletion, bound retained
      sanitization work, consolidate proven duplicate identity errors, reuse `toJSON`,
      remove unused parameters, and delete only controls with no consumer.

Tie-break acceptance:

- [ ] Each candidate ends as either an executed accepted finding with its own
      acceptance test, or a written rejection with production evidence.
- [ ] No unverified finding is retained as a “maybe” implementation backlog.

Phase 5 exit gate:

- [ ] Public beta surface contains only earned contracts.
- [ ] Evidence labels match what was executed.
- [ ] One current security/release narrative remains.

---

## Phase 6 — Final verification and protected staging

### Source and focused validation

- [ ] `pnpm run format:check`
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run check:boundaries`
- [ ] `pnpm run test`
- [ ] `pnpm run check:contracts`
- [ ] Every focused regression added in Phases 1–4.

### Auth and security validation

- [ ] `pnpm run check:auth-advisories`
- [ ] `pnpm run verify:auth`
- [ ] Auth cloud/concurrency/export-sentinel/MFA tests against the reviewed backend.
- [ ] OAuth chunked-body, clock, redirect, custom-field, indexed-`in`, and transaction
      budget boundary tests.
- [ ] No credential, raw cause, stack, response body, or provider-private identifier in
      transferable errors or artifacts.

### MCP validation

- [ ] Official final-SDK conformance.
- [ ] Mid-call notification with exactly-once committed effect.
- [ ] Stateless subscription rejection.
- [ ] Real-browser App stray-message recovery.
- [ ] Real-browser high-impact confirmation without header rewriting.
- [ ] Maintained neutral and OAuth starters against exact packed MCP bytes.
- [ ] At least one real host for MCP Apps before claiming host interoperability.

### Release and artifact validation

- [ ] Canonical release command from an empty artifact root.
- [ ] `pnpm run check:asvs`
- [ ] `pnpm run check:sbom`
- [ ] `pnpm run test:e2e:full`
- [ ] `pnpm run test:dast:proxy`
- [ ] Exact source commit, tarball SHA-256, SRI, SBOM, content manifest, runtime
      fingerprint, and installed-byte comparison agree.
- [ ] Candidate package dependency ordering and companion coordinates are exact.
- [ ] Protected OIDC staging consumes the already-built candidates and does not repack.

### Final release acceptance

- [ ] No open P0 or P1.
- [ ] No contested finding affects identity, authorization, committed-effect reporting,
      SSR isolation, OAuth bounds, artifact authority, or public stable API.
- [ ] All P2 public hard cuts are complete before stable compatibility begins.
- [ ] Worktree is clean and the final commit is the commit certified by every artifact.
- [ ] A human security owner/deputy and required independent reviewers are recorded.

---

## Explicitly rejected work

- [ ] Do **not** add a public core/catch-all package.
- [ ] Do **not** add Commands, approvals, workflow, RBAC, or a second canonical
      high-impact-operation store.
- [ ] Do **not** add a second MCP registry, automatic tool interceptor, or Nitro MCP
      topology.
- [ ] Do **not** convert `@modelcontextprotocol/server` to a consumer-owned peer merely
      because `McpServer` appears in a callback; the package intentionally constructs
      and owns that instance.
- [ ] Do **not** remove `createBetterAuthMcpAccessVerifier`; Ginko is a real consumer and
      the narrow verifier result prevents provider-private state entering public access
      context.
- [ ] Do **not** treat the request-local starter verifier closure as module-global state.
- [ ] Do **not** add a cascade projection, cache, queue, or background job before a real
      workload exceeds the bounded transaction contract.
- [ ] Do **not** remove the exact Kysely peer. Better Auth permits a wider range, so the
      peer is what forces the reviewed physical runtime tuple.
- [ ] Do **not** split `rotateSigningKey` into another service/factory; it is an
      intentionally atomic JWKS-domain operation.
- [ ] Do **not** add a policy hook to derived user-projection cleanup without a real
      application-owned canonical-row requirement.
- [ ] Do **not** parallelize cursor-dependent pagination.
- [ ] Do **not** refresh every loaded page on each live head update.
- [ ] Do **not** redesign the upload queue around a `Map` without a benchmark that
      crosses the current simple-array budget.
- [ ] Do **not** split `client-owner.ts` or the auth plugin because of file size alone.
- [ ] Do **not** add compatibility shims for vNext beta APIs.
- [ ] Do **not** accept `Origin: null` as a general CSRF solution.
- [ ] Do **not** remove exact artifact integrity or request-isolation controls.
- [ ] Do **not** delete the trusted live-codegen freshness gate: the main/scheduled
      workflow supplies its deploy key outside PR-controlled execution.
- [ ] Do **not** implement Claude consensus-rejected controller/MCP/adapter hypotheses
      unless new production evidence changes their premise.
