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

- [x] Do not publish, stage, or call the candidate stable while any P0/P1 item is open.
- [x] Do not weaken an auth, identity, transport, artifact, or advisory gate to make it
      pass.
- [x] Add a failing behavioral/type test before changing each P0/P1 production path.
- [x] Prefer hard deletion over beta compatibility aliases, overloads, shims, flags, or
      dual paths.
- [x] Keep one source of truth for identity, schema artifacts, MCP protocol behavior,
      release ordering, and public error projection.
- [x] Do not add a table, projection, cache, job, service, registry wrapper, or public
      option unless a task below explicitly proves it is required.
- [x] Preserve exact artifact hashes, SRI, SBOM, content manifests, runtime
      fingerprints, installed-byte comparison, dependency-order publication, and
      protected OIDC.
- [x] Do not interpret source-text assertions or evidence prose as behavioral proof.
- [x] Keep application roles, current authorization, high-impact operation state, and
      destructive-operation policy outside Better Convex.

## Reconciliation decisions

### Accepted from Claude

- [x] `MCP-01`: force unary JSON MCP responses.
- [x] `MCPI-01`: recoverable MCP App protocol errors must not brick the App or discard a
      committed result.
- [x] `NUXT-01`: preserve same-identity SSR hydration through initial auth settlement.
- [x] `REL-01`: replace the unsatisfiable fresh-runner release command with one ordered
      entry point.
- [x] `vue-lifecycle/VUE-01`: fence initial fail-closed reporting with the generation
      captured before the attempt.
- [x] `BAA-01`: stop full-scanning indexed `in` predicates.
- [x] `AUTH-01`: make the allowed OAuth provider profile exact and reject unknown
      options.
- [x] `BAA-03`: make the shipped CLI and repository schema generator emit identical
      bytes. This is P1 because the certified public CLI rejects the repository's own
      committed fixtures.
- [x] `MCPI-02`: make the real browser confirmation POST compatible with its
      referrer/CSRF policy.
- [x] `AUTH-03`: stream-bound OAuth form bodies before materialization. This is promoted
      from Claude's P3 to P1 because the executed proof consumed 256 MiB at an
      unauthenticated endpoint with a declared 16 KiB bound.
- [x] `vue-lifecycle/VUE-02`: suppress value-identical provider transitions and remove
      redundant `authEpoch`.
- [x] `vue-lifecycle/VUE-03`: fix the no-op recovery path and explicitly decide, with
      security evidence, whether a transient session transport failure retains or
      retires the current identity.
- [x] `ERR-02`, `REL-02`, `TE-01`, and `TE-02`: remove false or implementation-coupled
      observability/evidence claims while retaining real invariant coverage.

### Merged with Codex findings

- [x] Claude `NUXT-03` is the same bytes/non-plain-object corruption found by Codex.
- [x] Claude `REL-03` is the same self-validating candidate-profile duplication found by
      Codex.
- [x] Claude `MCP-05`/`NORM-03` are part of deleting the public constant `era` context and
      local MCP method classifier.
- [x] Claude `ERR-01` is handled with the broader public-error opacity correction:
      unknown causes are opaque everywhere, and structured error data remains intact
      without sending UDF frames through SSR.
- [x] Claude `ERR-03` is handled at the diagnostic boundary, where a sink is made
      non-authoritative once, rather than by wrapping every caller.
- [x] Claude `vue-controllers/VUE-02` (`SplitRequired`) is accepted as a fail-closed
      pagination correctness task.
- [x] Claude `vue-controllers/VUE-01` (head-page boundary reset) is settled with
      bounded `endCursor` subscriptions, without sequential refetch storms.

### Corrections to Claude's report

- [x] Claude's “no P0” conclusion is superseded by the executed raw-`useConvex()` proof:
      a call entering while generation 0 is unsettled can execute on replacement client
      B in generation 1. This is P0.
- [x] Claude's rejection of `NUXT-02` is not adopted. Its refuters conceded that
      `serverConvex` has no deadline, response bound, or request-abort propagation.
      Codex executed both an orphaned-abort proof and an approximately 2 MiB response
      proof. The corrected fix uses operation-aware limits instead of imposing the SSR
      query deadline on actions.
- [x] Do not implement Claude's proposed automatic `registerTool` interceptor. It would
      add a second MCP registration owner. Keep explicit `runMcpTool` at the application
      boundary and delete only its unearned diagnostic surface.
- [x] Do not publish an internal Vue unref helper solely to deduplicate a small Nuxt
      helper. Preserve correct non-plain values with a private implementation unless an
      existing public primitive already has the exact contract.
- [x] Do not implement live pagination tail `refresh()` on every head change. Cursor
      chaining is sequential and would amplify a busy feed by `O(loaded pages)`.
- [x] Do not add a permanent “latest prerelease” dependency gate. Reconcile Better Auth
      `1.7.0-rc.1` against the currently published `1.7.0-rc.2` once in the final
      dependency phase; exact pinned reviewed bytes remain authoritative.
- [x] Do not delete all reviewed-fault-injection tests until their unique production
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

- [x] Add isolated red tests for T1.1, T1.2, T2.1, T2.2, T3.1, T3.2, T4.1, T4.4,
      T4.5, and T4.6.
- [x] Each test must fail for the claimed behavioral reason at the target commit.
- [x] Store no scratch harness, generated credential, or deployment artifact in the
      repository.

Phase 0 exit gate:

- [x] The release command is satisfiable from a clean artifact root.
- [x] The advisory command produces complete evidence.
- [x] Every P0/P1 correction has a focused failing regression test.

Ledger note (2026-07-26):

- Each named P0/P1 task below records the isolated red behavior observed before its
  production correction and the focused green suite retained afterward. The resulting
  tests exercise runtime behavior or public types, not source strings.
- The remediation commits contain no scratch proof, generated credential, deployment
  output, or release artifact. Temporary release roots and browser/codegen deployments
  are created outside the repository or cleaned by their owning harness.

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

- [x] Reproduce or refute the claim that the Vue identity port can be failed closed
      while Nuxt's app-facing auth state still reports authenticated.
- [x] If reproduced, project the existing canonical identity error; do not create a
      second auth state machine.
- [x] If refuted, record the exact production trace and remove this item. (Not
      applicable: the claim was reproduced.)

Acceptance criteria if reproduced:

- [x] App-facing auth state, query gating, and identity-port state agree after
      fail-closed settlement.
- [x] Recovery is driven by the canonical provider/identity transition.

Ledger note (2026-07-26):

- Reproduced the split after initial authentication: a later Convex credential
  rejection fails the Vue identity port closed to anonymous and advances
  `identityGeneration`, so query gating is closed, but the Nuxt plugin's identity
  observer previously only purged protected payloads. Its token/user refs therefore
  still reported Alice as authenticated.
- Extended that existing observer to read its one canonical identity snapshot. On an
  errored generation it projects anonymous identity, the port's safe public error
  message, and settled pending state into the Nuxt presentation refs. No new state,
  revision, or recovery path was added.
- Recovery remains provider-owned: the adapter's authenticated callback publishes
  the replacement token/user, then the error-free canonical identity transition
  performs isolation cleanup without overwriting that recovered presentation.
- Red proof: the client-plugin regression retained Alice's token/user after the port
  published generation 2 as anonymous with an authentication error.
- Green proof: the exact plugin regression, the Nuxt auth facade, and the Vue
  identity-port suite pass (3 files/17 tests), along with the full root typecheck.

### T1.6 — Avoid the unused eager client in auth-enabled startup

Source: Claude unverified `vue-lifecycle/VUE-04`, independently source-confirmed.
Depends on T1.2.

- [x] In auth-enabled mode, do not construct a primary Convex client/WebSocket while
      provider identity is still loading.
- [x] Let the first settled identity transition create the first appropriate primary.
- [x] Keep auth-disabled mode eager and simple.
- [x] Delete the special initial-client path if T1.2's tests prove it is fully subsumed.

Acceptance criteria:

- [x] Loading→authenticated and loading→anonymous each construct one primary client, not
      an immediately discarded extra client.
- [x] No primary WebSocket opens during unresolved auth loading.
- [x] Auth-disabled startup behavior and public readiness remain unchanged.

Ledger note (2026-07-26):

- Reproduced the eager allocation: the owner constructed generation 0 before the
  loading provider had an actionable identity, then loading settlement immediately
  retired it and constructed generation 1.
- Auth-enabled browser runtimes now construct the owner with its canonical identity
  port, whose presence defers only the initial primary. The port starts the first
  candidate for an already authenticated/settled snapshot, or waits for loading to
  cross to its first generation. Auth-disabled runtimes retain their eager anonymous
  primary.
- Deleted the browser runtime's separate initial-client confirmation branch. Initial
  and later candidates now use the same `replacePrimary`/`initializePrimary` path.
- Preserved `ready()` with a one-shot barrier on the owner's existing primary-commit
  event (or disposal), after canonical identity settlement. The anonymous regression
  verifies the primary is committed by observing its connection subscription
  immediately after readiness.
- Red proof: both loading paths had already allocated one client before provider
  settlement.
- Green proof: loading→authenticated and loading→anonymous each allocate exactly one
  primary, auth-disabled startup allocates one eagerly, and the browser runtime,
  owner, adapter-port, package-runtime, and Nuxt connection suites pass (5 files/65
  tests), along with Vue and root typechecks.

Phase 1 exit gate:

- [x] Every identity-crossing test passes for query, mutation, action, subscription,
      initial confirmation, refresh, disposal, and A→B→A replacement.
- [x] One public identity revision remains: `identityGeneration`.

Phase 1 exit evidence (2026-07-26):

- The complete configured Vitest matrix passes across unit, security, Convex, Nuxt,
  and browser projects. The focused identity/runtime matrix passes 65 tests.
- A source audit finds no production `authEpoch`, `identityRevision`,
  `sessionRevision`, or `clientGeneration`; the only `authEpoch` occurrence is the
  regression assertion proving it is absent from the public snapshot.

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
- [x] CSP, `frame-ancestors 'none'`, private/no-store, user binding, expiry, and
      exactly-once effect semantics remain intact.

### T2.4 — Return protocol ownership to the official SDK

Sources: Codex `F-007`; Claude `MCP-05` and `NORM-03`.

- [x] Delete the local stateful-method registry and pre-parser.
- [x] Delete `ConvexMcpRequestContext`, the constant public `era`, and the third
      `configureServer` callback argument.
- [x] Configure official subscription limits and verify exact final-SDK rejection
      behavior.
- [x] Keep Better Convex ownership limited to authentication, allowlisting, bounds,
      deadline, abort, and lifecycle disposal.

Acceptance criteria:

- [x] Packed callback signature is `(context, access, server)`.
- [x] No RC protocol term appears in public declarations.
- [x] Subscription/listen methods cannot create durable transport state.
- [x] Official SDK JSON-RPC errors are returned rather than wrapper-specific empty 405
      responses.
- [x] Request and response bounds still hold.

Ledger note (2026-07-26):

- Deleted the wrapper's JSON clone/pre-parser and stateful-method name registry. The
  already-bounded request now goes directly to the official handler after
  authentication.
- Set the official per-request handler's `maxSubscriptions` to zero. Its exact pinned
  behavior is now regression-tested: resource subscribe/unsubscribe return HTTP 404
  JSON-RPC `-32601 Method not found`; `subscriptions/listen` returns HTTP 200 JSON-RPC
  `-32603 Subscription limit reached`. Each response is SDK-owned, not an empty
  wrapper 405.
- Removed `ConvexMcpRequestContext`, the RC `era` projection, and the fourth callback
  parameter everywhere. Built declarations expose exactly
  `(context, access, server)`.
- The SDK emits one fixed warning each time unary JSON mode is constructed. The
  credential-passthrough proof allowlists only those exact warning bytes and asserts
  that bearer, provider reference, subject PII, and private input sentinels remain
  absent from all console calls.
- Focused handler, operation mapping, starter, and credential-boundary suites pass (4
  files/23 tests); the MCP package typecheck and build pass. Existing request/response
  cap and deadline tests remain green in the handler suite.
- The exact packed tarball declaration exposes the three-argument callback and no
  request context/era. The real-Chromium MCP Apps probe also passes after the hard cut.

### T2.5 — Delete the unearned diagnostic projection

Sources: Codex `F-009`; Claude `ERR-04`, `ERR-07`, and `MCP-02` discussion.

- [x] Delete `McpToolDiagnostic`, its options, `causeName`, constructor-name
      inspection, single-valued classification, and `onDiagnostic`.
- [x] Keep one-argument explicit `runMcpTool` with its fixed unexpected-failure result.
- [x] Keep explicit application/domain error projection inside each tool.
- [x] Do not add an automatic `registerTool` interceptor or second registry.

Acceptance criteria:

- [x] Error name, constructor name, message, data, stack, and cause sentinels never
      enter unexpected MCP failure results.
- [x] Maintained tools still return allowlisted application error codes.
- [x] Throwing observability code cannot affect tool outcome because no public
      observability hook remains.
- [x] Packed exports contain no diagnostic interfaces.

Ledger note (2026-07-26):

- Deleted both diagnostic interfaces, the optional second argument, random call IDs,
  cause/name/constructor/data inspection, classification, and `onDiagnostic`. No
  replacement hook, registration interceptor, or registry was added.
- `runMcpTool` now does exactly one thing: return the tool's explicit result, or replace
  an unexpected throw with the fixed `Tool execution failed` result. Maintained tools
  continue to project allowlisted application/domain failures themselves.
- Red proof: the runtime function still exposed arity two before the hard cut.
- Green proof: hostile getters are untouched and name, constructor, message, data,
  stack, cause, bearer, and provider sentinels never enter the result or console
  boundary. Focused tool, credential, live-authorization, and operation-mapping suites
  pass (4 files/21 tests); the MCP typecheck/build pass.
- Exact packed declarations expose only the one-argument function and contain no
  diagnostic interface or observability option. The complete MCP project passes 55
  tests.

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

- [x] Replace the broad resource-server `OAuthMetadata` option with the minimum issuer
      input actually consumed; authorization-server discovery remains owned by the
      authorization server.
- [x] Use one internal issuer canonicalization rule for OAuth and preconfigured bearer
      modes, including exact reviewed loopback development origins.
- [x] Delete `McpAccessVerificationFailure.code` if the final consumer search still
      shows only tests; public challenges remain static.
- [x] Keep `createBetterAuthMcpAccessVerifier`: Ginko is a real production consumer and
      the verifier prevents provider-private session state entering `McpAccessContext`.

Acceptance criteria:

- [x] Protected-resource GET/HEAD/OPTIONS/CORS behavior remains exact.
- [x] The resource handler does not serve an independently authored authorization-server
      metadata document.
- [x] Both authorization modes accept/reject the same canonical issuer classes.
- [x] Verifier failures still produce the fixed public challenge without an unconsumed
      internal discriminant.

Ledger note (2026-07-26):

- Replaced the OAuth mode's full `OAuthMetadata` input with the only authorization
  server value the resource consumes: canonical `issuer`. The handler still delegates
  protected-resource document bytes and GET/HEAD/OPTIONS/CORS behavior to the official
  SDK, but no longer routes or mirrors an authorization-server metadata document.
- OAuth and preconfigured bearer modes now call the same private issuer canonicalizer.
  Production remains HTTPS-only; exact `localhost`, `127.0.0.1`, and `[::1]` HTTP
  origins are accepted for reviewed development in both modes, while remote plaintext,
  credentials, query, fragment, and noncanonical URL bytes fail closed.
- Final production/test/export search found no consumer of
  `McpAccessVerificationFailure.code`; deleted both values and constructor branches.
  The fixed public bearer challenge remains owned by the handler.
- Retained `createBetterAuthMcpAccessVerifier` because the maintained production
  consumer and its provider-private-state boundary remain real.
- Red proof: the resource served a copied authorization-server document, loopback OAuth
  construction failed under a stricter rule, and verifier failures exposed `code`.
- Green proof: four focused handler/access/operation/credential files pass 31 tests;
  the MCP package typecheck/build pass. Protected-resource GET, HEAD, OPTIONS, reflected
  preflight headers, CORS, fixed challenge URL, and authorization-server 404 are pinned.
- The complete MCP project passes 55 tests; root typecheck/lint pass. Exact packed
  declarations contain the two issuer fields and no `OAuthMetadata`,
  `McpAccessVerificationFailure`, or failure `code`.

Phase 2 exit gate:

- [x] One explicit tool reaches one explicit application operation.
- [x] One protocol implementation parses and classifies MCP messages: the official SDK.
- [x] A committed effect cannot be surfaced as transport/App failure.
- [x] No bearer, cookie, provider-private value, raw cause, or mutable SDK object enters
      an MCP App.

---

## Phase 3 — Correct Nuxt SSR, query, pagination, and error boundaries

### T3.1 — Preserve Convex values during reactive normalization

Sources: Codex `F-002`; Claude `NUXT-03`.

- [x] Recurse only into refs, arrays, and plain records.
- [x] Preserve `ArrayBuffer` and every other supported non-plain Convex value.
- [x] Use one private Nuxt normalization contract for SSR keys, hydration keys, and
      call arguments.
- [x] Reuse the exact Vue semantics through an existing private embedded boundary if
      that requires no new export; otherwise keep a small private Nuxt implementation.
- [x] Do not add a new public cross-package utility solely for this helper.

Acceptance criteria:

- [x] Byte arguments reach Convex as the original bytes.
- [x] Different buffers produce different keys.
- [x] Regular and paginated SSR/client keys agree.
- [x] Existing nested-ref behavior remains unchanged.

Ledger note (2026-07-26):

- Red proof: regular and paginated hydration both missed payload entries keyed by the
  real bytes because the Nuxt resolver recursively projected `ArrayBuffer` to `{}`.
- Replaced that broad object projection with one private Nuxt contract that unwraps
  refs only while traversing arrays and plain records. Primitive Convex values and
  non-plain values such as `ArrayBuffer` remain untouched.
- Kept the helper inside the Nuxt runtime. The Vue package's existing private
  `deepUnref` already has the same semantics, so no cross-package export or second
  public utility was introduced.
- Green proof: original byte identity reaches the client query call, distinct buffers
  produce distinct keys, and regular plus paginated hydration consume their matching
  byte-specific SSR payload. The two focused Nuxt files pass 31 tests, including the
  pre-existing nested-ref behavior. The complete Nuxt project passes 108 tests; root
  typecheck and lint pass.

### T3.2 — Preserve same-identity SSR payload through initial settlement

Source: Claude `NUXT-01`. Depends on T3.1.

- [x] Carry the already-computed SSR identity provenance with initial query/page data.
- [x] Retain data only for the matching first settlement.
- [x] Clear synchronously on anonymous↔authenticated mismatch, A→B, and every later
      generation change.
- [x] Remove the redundant paginated first-page refresh once same-identity hydration is
      proven.
- [x] Extend the Nuxt test harness so the identity port can start unsettled.

Acceptance criteria:

- [x] `auth: 'optional'` and `'required'` retain matching hydrated data with no flash to
      empty and no duplicate client query.
- [x] SSR A hydrated by browser B or anonymous is cleared before use.
- [x] A later A→B→A transition still clears generation-bound data.
- [x] Payload, `useAsyncData`, query-error, and pagination state purge once on a genuine
      identity crossing.

Ledger note (2026-07-26):

- Red proof: the browser identity port began as loading/anonymous, so discovering the
  same SSR user looked like a new identity generation and cleared valid regular and
  paginated seeds. Pagination then acquired a live first-page subscription and issued
  a redundant boundary refresh.
- Reused the existing identity-partitioned payload key as the SSR provenance. The
  Better Auth adapter now seeds only the non-secret SSR user id as an unsettled first
  generation; a matching provider session settles that generation in place, while a
  different user or anonymous session retires it.
- Protected hydration is accepted only when the canonical browser port names the same
  identity as the payload key. User A data is therefore rejected synchronously when
  the browser already names B or anonymous. No token or provider-private session value
  enters the payload or Vue boundary.
- The auth-client purge observer now reconciles the initial SSR/browser identity before
  treating generations as crossings. Matching first settlement performs no purge;
  an initial mismatch and each later generation purge protected payload/useAsyncData
  and query-error state exactly once while retaining `auth: 'none'`.
- The pagination controller preserves a matching first-page seed across wait→live,
  makes first-page subscription acquisition idempotent, and deletes the redundant
  refresh. The SSR continuation cursor remains available to `loadMore`.
- Added a controllable unsettled identity observer to the Nuxt harness. Focused
  adapter/plugin/cache tests pass 17 tests; focused query/pagination tests pass 17.
  The complete unit project passes 1,364 tests and the complete Nuxt project passes 115. Vue/root typechecks, Vue build, and root lint pass.

### T3.3 — Give SSR and public server calls one bounded transport owner

Source: Codex `F-006`; this deliberately overturns Claude's `NUXT-02` rejection.

- [x] Generalize the existing bounded fetch from `query-execution.ts`.
- [x] Use it for both SSR queries and `serverConvex`.
- [x] Propagate the incoming request abort signal.
- [x] Use private operation-aware deadlines; do not force an 8-second query deadline on
      long actions.
- [x] Apply a documented response-size cap to query, mutation, and action responses.
- [x] Delete `createClassifiedConvexFetch`.

Acceptance criteria:

- [x] Client disconnect aborts upstream work.
- [x] Never-settling query/mutation/action calls terminate at their reviewed deadline.
- [x] Declared and streamed oversize responses fail at the boundary without full
      buffering.
- [x] Status-560 structured application errors and opaque non-560 transport errors keep
      their intended classification.
- [x] Packed Nitro behavior matches source tests.

Ledger note (2026-07-26):

- Extracted the existing SSR fetch bounds into one private dependency-light transport
  owner. Both `executeQueryHttp` and the request-scoped `serverConvex` client now use it;
  the server path passes the incoming request signal and the duplicate classified fetch
  wrapper is deleted.
- Fixed private policy is query 8 seconds, mutation 15 seconds, action 60 seconds, with
  a 1 MiB response limit for declared and streamed bodies. The public server-call docs
  record the policy without adding configuration or a second source of truth.
- The first pack attempt correctly failed because importing from `query-execution`
  widened the public server graph to query-only Convex modules. Moving only the
  transport into `bounded-convex-fetch.ts` restored the reviewed package boundary; no
  allowlist exception was added.
- Focused transport/server tests pass 62 tests and the complete unit project passes
  1,368. Root typecheck and lint pass. `pnpm pack` passes its production build, package
  export, and single-owner gates. A script importing the extracted tarball verified
  request abort, exact operation deadlines, declared/streamed response limits, status
  560 handling, and opaque non-560 classification.

### T3.4 — One public opacity rule for errors

Sources: Codex `F-003`; Claude contested `ERR-01`.

- [x] Preserve the reviewed message only for an explicitly constructed
      `ConvexCallError`; preserve structured application `data`, `code`, `status`, and
      `kind`.
- [x] Give raw wire `ConvexError` and every unknown string/object/Error cause a fixed
      opaque display message.
- [x] Apply the same rule in browser, SSR, and server boundaries; do not create a
      client/SSR asymmetry or serialize Convex/UDF frames and upstream bodies.
- [x] Delete the server-only duplicate workaround after the central boundary is correct.

Acceptance criteria:

- [x] Secret/stack sentinels are absent from state, promises, callbacks, JSON,
      structured clone, inspection, SSR HTML, DevTools, and packed consumers.
- [x] Structured application `data`, `code`, and `status` remain byte/value equivalent.
- [x] `cause` remains non-enumerable and non-transferable.
- [x] Tests no longer require arbitrary unknown messages to survive.

Ledger note (2026-07-26):

- Made the framework-free Vue normalizer the single opacity owner. Explicit
  `ConvexCallError` instances still pass through unchanged; raw recognized application
  errors now use `Convex application error`, while all unclassified strings, objects,
  and errors use `Unknown Convex error`. Structured `kind`, `data`, `code`, and `status`
  are preserved.
- Deleted the server-only normalize-then-discard workaround. Browser callables and
  queries, SSR query execution, pagination, Nuxt upload state, and `serverConvex` now
  share the same rule.
- Converted only reviewed library-owned queue cancellation/reset and unavailable-runtime
  conditions to explicit `ConvexCallError`s, retaining actionable product messages
  without allowing raw upstream text through.
- Red proofs failed across promise, callback, state, DevTools, server-operation, and
  serializer paths before the central change. Focused unit tests pass 91 tests; the
  complete unit project passes 1,369 and the complete Nuxt project passes 115. The real
  Nuxt SSR/browser fixture passes with a structured 560 error containing a planted
  secret and UDF frame while preserving application fields through hydration.
- Vue/root typechecks, lint, format, and architecture boundaries pass. Exact packed
  `./errors` and production Nitro `./server` consumers pass; the packed server probe
  checks query, mutation, and action structured-message opacity.

### T3.5 — Make diagnostics non-authoritative and delete dead controller hooks

Sources: Claude `ERR-02` and contested `ERR-03`.

- [x] Delete callable-controller observability handlers with no production supplier.
- [x] Do not add a new application callback merely to report callback failures.
- [x] Isolate the remaining Nuxt DevTools sink inside `callable-devtools.ts` so no sink
      throw can alter dispatch or settlement.
- [x] Keep application `onSuccess`/`onError` exceptions unable to replace the remote
      outcome.

Acceptance criteria:

- [x] A throwing `registerMutation` sink cannot prevent dispatch.
- [x] A throwing `updateMutation` sink cannot turn a committed success into rejection.
- [x] `.safe()` always resolves to its `CallResult`.
- [x] `execute()` rejects only with the call's normalized error.
- [x] Dead hook declarations and tests are removed rather than supplied speculatively.

Ledger note (2026-07-26):

- Deleted all six callable-controller observability hooks (`logSuccess`, `logError`,
  `logCallbackError`, `startEvent`, `finishEvent`, and `failEvent`) because no
  production caller supplied them. Callback isolation now has no speculative reporting
  path.
- Kept the remaining diagnostics owner in Nuxt's `callable-devtools.ts`. Registration,
  success projection, and failure projection are isolated there; a throwing sink is
  treated as absent and no application callback or fallback logger was added.
- Red proofs showed throwing registration prevented dispatch and throwing updates
  replaced both committed and failed outcomes. Integration tests now prove execute and
  `.safe()` behavior for registration failure, success-update failure, and
  failure-update failure. Controller tests prove throwing `onSuccess` and `onError`
  cannot replace the remote outcome.
- Focused tests pass 29 tests. The complete unit project passes 1,373 and the complete
  Nuxt project passes 117. Vue/root typechecks, Vue build, lint, format, architecture
  boundaries, and built-output dead-hook searches pass.

### T3.6 — Keep one explicit query skip sentinel

Source: Codex `F-008`.

- [x] Narrow Vue query/pagination arguments to `Args | 'skip'`.
- [x] Reject runtime `null`/`undefined` with a clear error.
- [x] Add no deprecated overload or nullable compatibility path.

Acceptance criteria:

- [x] Source and exact packed type tests reject direct/ref/getter `null` and
      `undefined`.
- [x] Explicit `'skip'` transitions remain reactive.
- [x] Maintained consumers convert nullable UI state themselves.

Ledger note (2026-07-26):

- `better-convex-vue` query and pagination arguments now expose only the argument
  object or the literal `'skip'`. The shared normalizer no longer invents `{}` for
  an omitted slot and throws one clear `TypeError` for direct, ref, or getter
  `null`/`undefined`; skip detection recognizes no implicit disabled state.
- Nuxt's internal query and pagination state builders now require their argument
  slot too. The one maintained Nuxt test that still used `null` was converted to
  the explicit sentinel; repository searches find nullish calls only inside
  negative type-contract fixtures.
- Source contracts and the freshly packed anonymous Vue consumer reject direct,
  ref, and getter nullish values for both query kinds while accepting reactive
  `'skip'`. Runtime tests prove query and pagination transition from skipped to
  subscribed and back synchronously, retiring the active subscription.
- Focused tests pass 18 tests. The complete unit project passes 1,375 and the
  complete Nuxt project passes 117. Vue/root typechecks, lint, format,
  architecture boundaries, the exact packed Vue consumer build, and the built
  Nuxt consumer-smoke typecheck pass.

### T3.7 — Make pagination ownership and incomplete-page behavior explicit

Sources: Codex `F-012`; Claude contested controller `VUE-01`/`VUE-02`.

- [x] Make the pagination controller the only subscription initiator.
- [x] Honor structured `pageStatus: 'SplitRequired'`; do not render a possibly
      incomplete page as ready.
- [x] Add exact subscribe/unsubscribe count tests for auth, args, identity, and disposal.
- [x] Decide the head-boundary contract with an executed realistic-feed test:
      documented safe reset, observable restart, or bounded `endCursor` implementation.
- [x] During final SDK reconciliation, compare a hard cut to the pinned official
      paginated-update primitive against retaining the manual tail algorithm. Prefer the
      hard cut only if it deletes ownership and keeps experimental types private.
- [x] Do not call sequential `refresh()` per live head update.

Acceptance criteria:

- [x] One boundary transition creates one replacement subscription.
- [x] `SplitRequired` data is withheld and a non-ready/error state is visible.
- [x] `SplitRecommended` continues normally.
- [x] No gap/duplicate appears across page boundaries.
- [x] Sequential cursor dependency and synchronous identity clearing remain intact.

Ledger note (2026-07-26):

- The pagination controller now starts and replaces every live subscription itself.
  Auth-mode, argument, identity, idle, and disposal tests assert exact acquisition and
  retirement counts; composables no longer expose or call an initial-subscription hook.
- Every loaded live range is bounded by the next page's cursor. The realistic
  three-page feed test asserts the exact `endCursor` arguments and proves that live
  inserts preserve ordering without gaps or duplicates. Head updates never trigger the
  sequential manual refresh path, while an explicit refresh still follows the cursor
  chain and commits atomically.
- `SplitRequired` results are withheld while two bounded subscriptions settle and are
  promoted atomically; `SplitRecommended` keeps the complete old range visible until
  the same swap. First-page and tail tests cover both states, promoted live updates,
  incomplete-page behavior, and synchronous identity retirement.
- The pinned Convex `1.42.2` experimental paginated-update primitive was inspected. It
  handles page splitting, but adopting it would widen the intentionally exact
  four-method client handle or add a fallback path. Retaining one private manual
  controller keeps experimental SDK types out of the public/cross-bundle bridge and
  avoids a second ownership path.
- Nuxt SSR rejects `SplitRequired` pages with a structured pagination error instead of
  hydrating potentially incomplete data. The pagination guide documents controller
  ownership, bounded ranges, and both split states.
- Focused pagination tests pass 48 tests. The complete unit project passes 1,381 and
  the complete Nuxt project passes 117. Vue and docs builds, docs/Vue/root typechecks,
  lint, format, architecture boundaries, the exact packed Vue consumer, and the built
  Nuxt consumer smoke check pass.

### T3.8 — Remove dead query mirrors and give one-shot refreshes real identities

Sources: Claude unverified Vue lifecycle `VUE-06`, controller `VUE-06`/`VUE-07`, and
Nuxt `NUXT-09`, independently source-confirmed.

- [x] Delete the per-composable identity-generation mirror/subscription if the final
      caller search confirms its value and settlement promise are unread.
- [x] Give overlapping one-shot query refreshes a local monotonic sequence so an older
      completion cannot overwrite the newer result.
- [x] Add a first-page settlement promise to the pagination controller instead of
      making Nuxt issue/await a duplicate query.
- [x] Reconcile paginated SSR error hydration using the same overlay/clear contract as
      regular queries.

Acceptance criteria:

- [x] Mounting N queries does not add N unused identity listeners.
- [x] If two refreshes resolve in reverse order, only the later refresh commits.
- [x] A hydrated page resolves immediately; a live first page resolves on its first
      value/error without an extra HTTP query.
- [x] Paginated SSR errors survive hydration and clear on the first live value/error.
- [x] Long-lived subscription callbacks still use the existing generation fence.

Implementation ledger (complete, 2026-07-26):

- The final caller search found both Nuxt auth-context exports unread:
  `identityGeneration` and `waitForInitialSettlement`. Their per-composable port mirror
  and lifecycle subscription were deleted rather than retained behind another helper.
  A mixed five-composable regression proves mounting queries and paginated queries adds
  zero identity-observer listeners. The focused Nuxt query/pagination suite passes 34
  tests and the root Vue typecheck passes.
- One-shot Vue query refreshes now carry a composable-local monotonic sequence in
  addition to the existing controller generation fence. A reverse-resolution test
  proves the older value cannot overwrite the newer value or end its loading state;
  the long-lived subscription operation is not invalidated. The focused Vue runtime
  and controller suites pass 22 tests and the Vue package typecheck passes.
- The pagination controller now owns a lazy first-page settlement promise that resolves
  for hydrated data, the first complete live value, a first-page error, idle state, or
  disposal. Nuxt awaits it for subscribed queries and retains manual `refresh()` only
  as the sole transport for `subscribe: false`; the unconditional duplicate one-shot
  query is deleted. Public Nuxt tests prove both hydrated and non-hydrated awaited
  calls perform zero client `query()` calls, while the live path stays blocked until
  its subscription settles. Focused controller and Nuxt pagination suites pass 23
  tests, and Vue/root typechecks pass.
- Paginated client hydration now uses the same library-owned error overlay as regular
  queries. A matching SSR error remains authoritative while the live first page is
  unsettled, then is deleted on either the first live value or live error; the live
  error remains visible after replacing the overlay. `reset()` also clears the overlay.
  The focused Nuxt pagination suite passes 13 tests and the root typecheck passes.
- The phase-wide pass completes 1,383 unit tests and 122 Nuxt tests. Root and fixture
  typechecks, lint, canonical format, architecture boundaries, the Vue package build,
  all three packed Vue consumers (anonymous, authenticated, and cross-copy embedded),
  the Nuxt module build, and its maintained consumer-smoke typecheck pass. Existing
  identity-boundary tests continue to prove queued long-lived callbacks are rejected
  by the controller generation fence.

Phase 3 exit gate:

- [x] Same-identity SSR has no duplicate fetch or flash.
- [x] Different identities cannot observe retained data.
- [x] All public call/query/pagination errors satisfy the same opacity contract.
- [x] Subscription counts are deterministic and bounded by loaded pages.

Phase 3 ledger note (2026-07-26):

- Same-identity query and pagination hydration is retained until live settlement
  without a duplicate fetch. Identity changes synchronously clear protected query,
  pagination, retained, pending, and error state before a replacement listener can
  publish.
- Public calls, regular queries, pagination, SSR transport, and hydrated overlays now
  share opaque unknown-cause handling while preserving reviewed structured Convex
  error data.
- Query subscriptions have one owner and pagination has one controller-owned
  subscription per stable loaded range, with a bounded two-part replacement only while
  Convex requests a split. Exact lifecycle counts and disposal are covered.

---

## Phase 4 — Bound OAuth and Better Auth adapter behavior

### T4.1 — Enforce OAuth body caps while streaming

Source: Claude `AUTH-03`, promoted to P1.

- [x] Replace `request.clone().text()` plus full `TextEncoder` measurement with the
      existing running byte-limit primitive, moved to a neutral private location if
      necessary.
- [x] Keep the cheap `Content-Length` precheck.
- [x] Apply the same implementation to authorize, token, and revoke form parsing.
- [x] Decode and parse only accepted bounded bytes.

Acceptance criteria:

- [x] Headerless/chunked bodies stop reading at approximately 8 KiB or 16 KiB, not at
      end-of-stream.
- [x] Exactly-limit input succeeds; limit+1 fails with the fixed reviewed error.
- [x] Allowed-field and singleton-parameter checks remain.
- [x] The provider can still read its cloned accepted body.
- [x] No unauthenticated request can force full materialization beyond the owned cap.

Ledger note (2026-07-26):

- The existing running stream limiter moved into one dependency-free private Web
  Streams leaf and remains the sole implementation for auth-proxy request/response
  caps and OAuth form caps. The architecture check explicitly permits only that leaf
  across the Convex-auth island and proves it imports nothing.
- Authorize (8 KiB), token, and revoke (16 KiB) retain their `Content-Length` precheck,
  then read a cloned request stream only through the running cap. Text decoding and
  `URLSearchParams` construction occur only after accepted bytes are assembled;
  allowed-field and singleton checks are unchanged.
- Executed tests prove exact-limit acceptance, limit+1 rejection, early cancellation of
  a much longer headerless stream, and that the provider-owned original request body
  remains readable after guard parsing. Focused OAuth/proxy tests pass 14 tests; the
  complete unit project passes 1,386. Root/fixture typechecks, lint, canonical format,
  and all 14 architecture boundary rules pass.

### T4.2 — Remove caller-controlled OAuth verification time

Source: Codex `F-010`.

- [x] Remove public `nowSeconds`.
- [x] Capture one real `Date` internally and share it between JOSE and local checks.
- [x] Use fake system time in tests.
- [x] Remove returned `OAuthPrincipal.issuedAt` if the final consumer search remains
      empty; continue validating `iat`.

Acceptance criteria:

- [x] A wall-clock-expired token cannot be accepted by caller configuration.
- [x] Clock tolerance, issuer, audience, subject, lifetime, and token-class checks are
      unchanged.
- [x] Packed declarations contain neither the time override nor unused `issuedAt`.

Ledger note (2026-07-26):

- `VerifyOAuthBearerTokenOptions` and its underlying expectation type no longer accept
  `nowSeconds`. Verification captures one internal `Date` before the JOSE call; that
  exact object is passed as `currentDate`, while a seconds projection captured from the
  same instant drives the local `iat`/`exp` checks.
- A regression passes a stale `nowSeconds` through an untyped object and proves it
  cannot admit a token expired by the real wall clock. Clock tolerance remains zero,
  and the existing issuer, audience, subject, client, maximum-lifetime, token-class,
  scope, and session binding corpus remains green.
- The final production caller search found no `OAuthPrincipal.issuedAt` consumer, so
  the result field was deleted. The signed `iat` claim remains required and continues
  to enforce future-issue, ordering, and maximum-lifetime invariants. Time-dependent
  tests now use fake system time rather than a production clock option.
- The combined unit, security, auth-fuzz, and auth-mutation projects pass 1,754 tests
  across 138 files. Root/fixture typechecks, the package build, lint, canonical format,
  and architecture boundaries pass. Fresh packed OAuth declarations contain neither
  `nowSeconds` nor `issuedAt`.

### T4.3 — One exact allowed OAuth provider profile

Source: Claude `AUTH-01`.

- [x] Derive public field types from the exact installed provider type without exposing
      all upstream options as supported.
- [x] Keep one runtime allowed-key set for the reviewed subset.
- [x] Reject every unknown/unreviewed key at construction.
- [x] Validate or forbid every redirect-capable page option, including signup,
      select-account, and post-login.
- [x] Retain all current value-level hardening.
- [x] After the allowed profile is canonical, collapse the admin-provisioning firewall
      onto the same normalized predicate: move scope parsing inside its safe error
      boundary, pass mutating endpoint method explicitly, and fail closed when it is
      absent.

Acceptance criteria:

- [x] Unknown and newly introduced provider keys fail closed.
- [x] Absolute, protocol-relative, query-bearing, and fragment-bearing page targets are
      rejected everywhere.
- [x] All current security profile values remain enforced.
- [x] The maintained starter contains no silently ignored option.
- [x] A dependency bump produces a loud review diff rather than widening the profile.
- [x] Request-time and stored-record profile validation agree over one differential
      corpus and return the reviewed 4xx error instead of an accidental 500.

Ledger note (2026-07-26, exact provider-profile slice):

- Deleted the hand-written field types. `PinnedOAuthProviderProfile` is now a `Pick`
  from the exact installed `OAuthOptions<Scope[]>`, with one reviewed key tuple serving
  as both its public subset and the runtime allowlist.
- Construction rejects every own key outside that tuple, including symbols and all
  three unreviewed redirect-capable option families (`signup`, `selectAccount`, and
  `postLogin`). Login and consent retain their relative, query-free, fragment-free
  path rule.
- Removed the starter's previously ignored `silenceWarnings` option and the matching
  integration fixtures instead of expanding the supported profile for a warning-only
  control.
- Red proof: five unknown/unreviewed profiles, including all three redirect families,
  were accepted before the exact-key loop.
- Green proof: the profile and real-provider integration suites pass 148 tests, the
  auth mutation fixture passes 15 tests, and root/fixture typechecks pass. The existing
  value-hardening corpus remains unchanged and green.

Ledger note (2026-07-26, provisioning slice):

- Client create/update bodies now project their snake-case fields into one synthetic
  stored record and run `assertSafeStoredOAuthClient`; resource configuration and
  create/update provisioning likewise reuse `assertSafeStoredOAuthResource`. The thin
  projections retain the provider naming boundary without restating the security
  predicate.
- Scope parsing moved inside the fixed API-error boundary. Duplicate and empty scope
  tokens now return `BAD_REQUEST / AUTH_OAUTH_CLIENT_PROFILE_INVALID`, not a bare
  `OAuthSecurityError` that becomes an accidental 500.
- Every provisioning validator requires its exact mutation method. The hook routes an
  absent method into rejection while leaving resource GET/DELETE operations alone,
  and the maintained starter now forwards the pinned endpoint method on every
  in-process `dispatchAuthEndpoint` call.
- Resource disabling remains an intentional terminal transition; all fields that can
  make an enabled resource unsafe still pass through the canonical stored predicate.
- Red proof: malformed and duplicate create-client scopes escaped as
  `AUTH_OAUTH_CONFIG_INVALID`; resource dispatch without a method skipped the hook;
  pairwise subjects, disabled clients, and invalid expiries were accepted at request
  time but rejected after storage.
- Green proof: the differential client-create, client-update, and resource corpus plus
  provider integration pass 192 focused security tests. The configured matrix passes
  2,011 tests across 167 files; OAuth passes 200 tests, MCP auth passes 55, auth fuzz
  passes 11, and all 17 reviewed auth mutants are killed. Root/fixture typechecks,
  lint, canonical format, the package build, and all 14 architecture boundaries pass.

### T4.4 — Map Better Auth logical fields for select and sort

Source: Codex `F-004`.

- [x] Use the pinned factory's `getFieldName` once before the component boundary.
- [x] Map `select` and `sortBy` exactly as `where` is mapped.
- [x] Delete component-side create-selection behavior the factory never calls.

Acceptance criteria:

- [x] A custom mapping such as `email -> email_address` works for create, findOne,
      findMany, select, and sort.
- [x] Returned objects retain Better Auth logical field names.
- [x] Unknown physical/logical fields still fail closed.

Ledger note (2026-07-26):

- The pinned adapter factory's `getFieldName` now maps `select` and `sortBy` at
  the outer adapter boundary, beside the factory-owned `where` mapping. A paginated
  find-many resolves the fields once per operation and reuses the physical shape for
  every component page.
- Deleted the `select` argument and projection from the component create mutation.
  The pinned factory never forwards create selection to a custom adapter; it applies
  the logical selection only after the full physical record returns.
- Red proof: with `email -> email_address`, create still sent an unreachable
  `select` property while findOne/findMany sent logical `select` and `sortBy` names to
  a component that knows only physical metadata.
- Green proof: one differential adapter test covers create, findOne, findMany,
  selection, sorting, logical output names, and unknown-field rejection. The focused
  invariant suite passes 21 tests, the real adapter project passes 34, and the
  configured matrix passes 2,012 tests across 167 files. Root/fixture typechecks,
  lint, canonical format, package build, logical-ID and 14-rule boundary checks pass.
  The isolated auth-schema gate also proves fresh Convex codegen for the curated,
  Team, Agentic SaaS, local-component, two-factor, and packed-demo consumers.

### T4.5 — Index-plan bounded `in` predicates

Source: Claude `BAA-01`.

- [x] Add a bounded indexed execution path when `in` targets an exact indexed field.
- [x] Keep `matchesAuthWhere` as final result authority.
- [x] Reject an oversized value fan-out with one fixed private error.
- [x] Do not create a second generic query planner.

Acceptance criteria:

- [x] `findMany`, `count`, `updateMany`, and `deleteMany` with one indexed `in` value
      read work proportional to values/matches, not table size.
- [x] Results equal the equivalent OR-of-equality form over randomized data.
- [x] Pagination order/cursors remain stable.
- [x] OR, insensitive, `not_in`, contains, starts/ends-with retain safe residual
      behavior.
- [x] The pinned OAuth session-revocation shape no longer full-scans token tables.

Ledger note (2026-07-26):

- Added one narrow exact-index `in` path beside the existing planner. One eligible
  predicate becomes deduplicated equality streams on the model's exact single-field
  index; `mergedStream` restores default creation order and `matchesAuthWhere` still
  evaluates every yielded document. OR, case-insensitive, multi-`in`, and sorted
  shapes remain on the existing safe residual path.
- Capped the raw fan-out at 64 values before any stream is created and reject 65 with
  the fixed private `AUTH_IN_FANOUT_LIMIT_EXCEEDED` error. The at-limit case executes
  successfully, and duplicate values do not duplicate either reads or results.
- Red proof: after 205 earlier non-matches, the old full scan returned an empty split
  first page instead of two trailing `id IN [...]` matches; a 65-value exact-index
  query was also accepted. The green component regression uses the shared selector
  through `findMany`, `count`, `updateMany`, and `deleteMany`, compares deterministic
  randomized results to OR-of-equality, walks two-item cursors in creation order, and
  covers OR, insensitive, `not_in`, contains, starts-with, and ends-with residuals.
- The installed OAuth provider's back-channel logout uses exact `clientId IN [...]`
  client lookup and `id IN [...]` access/refresh-token revocation. Those three fields
  are exact single-field component indexes, so the pinned production shape now uses
  the bounded path rather than scanning token tables.
- Proof: the focused Convex suite passes 5 tests, adapter invariants pass 21, the real
  adapter project passes 34, and OAuth passes 209. The complete configured matrix
  passes 2,016 tests across 167 files. Canonical format, lint, root/fixture typechecks,
  all 14 architecture boundaries, and the package build pass.

### T4.6 — Bound bulk writes and relationship cascades

Sources: Codex `F-005`; Claude unverified `BAA-04`/`BAA-05`.

- [x] Define one private conservative root/traversal budget.
- [x] Complete and validate a bounded plan before executing writes.
- [x] Reject oversized `updateMany`/`deleteMany` before effects.
- [x] Keep the whole accepted operation atomic.
- [x] Derive model trigger allowlists and skip cross-component trigger calls/readback for
      models that have no applicable trigger.
- [x] Do not add a projection, queue, background job, or public limit option.

Acceptance criteria:

- [x] At-limit work succeeds; over-limit work produces a fixed safe error.
- [x] Over-limit rejection produces zero committed writes/triggers.
- [x] Cascades, set-null, cycles, and trigger ordering retain rollback semantics.
- [x] Cascaded rows without triggers cause zero irrelevant cross-component trigger calls.
- [x] Deployed evidence demonstrates headroom below Convex transaction limits.

Ledger note (2026-07-26):

- Added one private 128-row operation budget owned by the relationship engine. Root
  `updateMany`/`deleteMany` collection, each relationship range, the deduplicated
  cascade closure, and combined cascade/set-null effects all fail with the fixed
  `AUTH_BULK_OPERATION_LIMIT_EXCEEDED` error before the first write.
- Bulk updates now validate every reference and database uniqueness constraint before
  patching. They also compare all merged final candidates against compound unique
  indexes, closing the collision that an interleaved-write check previously detected
  only after the first patch. Accepted writes remain in one Convex transaction.
- Trigger model allowlists are derived once from Better Auth configuration, mapped
  through the pinned factory's `getModelName`, and sent with the one internal trigger
  handle. Set-null rows without an update trigger skip both readback and nested
  mutation; cascade rows without a delete trigger skip the nested mutation. Updated
  generated contracts cover the curated component and every maintained fixture.
- Red proof: 129-row update/delete operations and a 129-row cascade committed
  successfully; generic relationship handles called triggers for every affected model;
  and moving two compound-unique members to one final tuple passed preflight after the
  write loop was split. Green tests prove exact-limit success, limit+1 rejection with
  zero writes/events, set-null → child-delete → parent-delete ordering, cycle handling,
  selective trigger dispatch, and complete rollback after a late trigger failure.
- Deleted the superseded “more than 1,000 rows must succeed” test only after its
  complete-update/delete invariant moved to the explicit at-limit/over-limit
  regression. The fault-injection rollback tests remain behavioral and green.
- The existing auth-schema gate now deploys the local component, executes a real
  128-row update, reads `ctx.meta.getTransactionMetrics()`, requires greater than 10x
  remaining headroom for bytes read/written, database queries, and documents
  read/written, then deletes all 128 rows. Fresh codegen and this deployed metric proof
  pass together.
- Proof: 30 focused Convex tests and 22 adapter invariants pass; the real adapter
  project passes 34. The complete configured matrix passes 2,020 tests across 167
  files. Canonical format, lint, root/fixture typechecks, all 14 architecture
  boundaries, fresh deployed auth-schema/codegen evidence, and the package build pass.

### T4.7 — P1: one schema/metadata artifact renderer

Source: Claude `BAA-03`.

- [x] Make the shipped CLI and repository generator use one canonical renderer.
- [x] Avoid making a formatter a shipped runtime dependency merely to normalize output.
- [x] Support one documented schema-options export form.
- [x] Delete the second format/staleness authority.
- [x] Re-record reviewed hashes when canonical bytes legitimately change.

Acceptance criteria:

- [x] Both entry points emit byte-identical schema and metadata.
- [x] The shipped CLI `--check` passes against committed reference fixtures.
- [x] `--check` remains non-writing.
- [x] Pair-write ordering and runtime fingerprint validation remain fail-closed.

Ledger note — T4.7:

- The adapter renderer now emits formatter-stable TypeScript directly: canonical
  single-quoted strings, safe unquoted property names, deterministic metadata
  indentation, and stable index chains. The shipped runtime does not import or depend
  on `oxfmt`.
- The repository generator no longer renders, formats, writes, or compares artifacts.
  It enumerates the five maintained targets and delegates each one to the shipped
  auth-schema CLI, leaving one pair writer and one staleness authority.
- Curated, Team, and Agentic schema options hard-cut to the same default-export form
  already used by the maintained fixtures and documented for consumers. No named
  compatibility export or dual config loader remains.
- Canonical output exactly reproduces every existing committed schema and metadata
  byte, so their reviewed artifact hashes and runtime fingerprints did not change.
  The provenance ledger now records the current hashes of the generator, schema
  options, and the other legitimately changed auth-owned targets accumulated by this
  remediation branch.
- Proof: four CLI authority tests cover exact committed bytes, current and stale
  non-writing checks, and the Team default-export reference; all 22 adapter invariants
  retain runtime mismatch rejection. The repository command checks all five maintained
  pairs. The built package CLI checks committed Team and two-factor references without
  writing, and the full auth-schema gate deploys both a clean tarball consumer and the
  local component, performs database-backed first writes, proves more than 10x
  transaction headroom, and produces fresh codegen. Package build and exact auth
  provenance validation pass. The complete repository gate passes 2,024 tests across
  168 files together with canonical format, lint, root/fixture typechecks, and all 14
  architecture boundaries.

### T4.8 — Reconcile Better Auth RC bytes once

Current npm state on 2026-07-26:

- Previous candidate: Better Auth/OAuth Provider `1.7.0-rc.1`.
- Chosen exact candidate: Better Auth/OAuth Provider `1.7.0-rc.2`.

- [x] Diff only the owned dependency seams from RC.1 to RC.2.
- [x] Decide explicitly: upgrade and recertify, or retain RC.1 with a recorded blocking
      reason until stable.
- [x] Re-run provider-profile, adapter, OAuth, browser-session, advisory, and packed
      consumer tests against the chosen exact bytes.
- [x] Do not add an automatic moving-dist-tag gate.

Ledger note (2026-07-26):

- Chose the hard-cut RC.2 upgrade. The reviewed upstream range is
  `fb1dff141c3ae8de325f190b154a7f9e9f86979a` →
  `cc708e51bcb1d4c367d2bc6182e6fd7fd722ece8`; exact registry integrities are
  `sha512-5KZrqbAsoQA8q1edmufaoF/CBbMjGb/BoPqyMTzXFyDeXNhk8pXO2xJkiDDeZcSGtyhUKXiDnD7hxh4sJVgYZw==`
  for `better-auth`,
  `sha512-NreNGg68j4qUVVYTcC1DtvRTwSJdCavH5igrMyTO5ghZxnzL4G539uRIzOZmJ64MLzOyOwzWH+JHqpVaj0ZRxw==`
  for `@better-auth/core`, and
  `sha512-fc3jCYwS/PaQyErOPqIUplqK456zhrmNWGnJPhDEF68merXBQN1OodUTzicZ3skFDpAv6MY3m5vk4D1Gz3R/oA==`
  for `@better-auth/oauth-provider`.
- The owned behavioral changes are explicit: account identity is now the upstream
  `(issuer, providerAccountId)` compound unique key, generated schema consumes
  upstream table-level indexes, joins configuration follows
  `advanced.database.joins`, and the Vue session composable keeps its exact
  plugin-client namespace through a minimum private constraint. The unreleased
  component and fixtures were regenerated directly; no `accountId` alias,
  migration shim, dual schema, or RC.1 branch remains in the current package.
- Root, distributed-app, and maintained fixture manifests use exact RC.2 bytes;
  standalone app locks were refreshed. The internal Agentic SaaS proof remains on
  its retired beta.18 package lock and is not a shipped or maintained consumer; its
  checked-in schema pair is still regenerated as one of the current renderer
  fixtures. Published beta candidate dependencies retained inside standalone
  candidate locks are replaced by local tarballs during release-candidate
  certification.
- Red proof: the RC.1 generator rejected RC.2's removed `account.accountId`; new
  table-index and account-identity tests failed; the old joins path and Vue client
  constraint failed typecheck; the packed demo resolved RC.1 and produced stale
  schema bytes. Updating direct consumer manifests made the source and installed
  CLIs byte-identical. The concurrency gate also exposed the obsolete 1,001-row
  scale proof that T4.6 had superseded; its test-only functions were deleted rather
  than weakening the private 128-row production bound.
- Proof: adapter invariants pass 24 tests; the real adapter project passes 36; OAuth
  provider/profile tests pass 209; native Chromium passes 5; the disposable
  two-factor browser/session matrix passes with revocation, concurrency, and
  lockout evidence. Advisory checks pass production/full audits, nine exact package
  queries, and imported advisories with zero exceptions. Concurrency, OAuth quota,
  authorization-code race, and real export-sentinel gates pass. The packed
  auth-schema gate proves non-writing CLI parity, clean-tarball and local component
  deployment, first database writes, fresh codegen, and greater than 10× headroom
  at the 128-row bound. All 29 provenance records pass against source and packed
  bytes. The complete repository gate passes 2,026 tests across 168 files together
  with canonical format, lint, all typechecks, and all 14 architecture boundaries.

### T4.9 — Make reusable auth construction idempotent and delete dead protocol surface

Sources: Claude unverified `AUTH-04` through `AUTH-07`, independently source-confirmed
where accepted.

- [x] Make the package-installed shared JWKS reader a stable internal identity so
      constructing auth twice over the same hoisted JWT plugin is idempotent.
- [x] Continue rejecting a foreign JWKS adapter.
- [x] Reduce the session synchronization API to methods with production callers.
- [x] Delete dead, non-exported OAuth guards and the unused `RETRY_BACKOFF_MS` claim only
      after a final caller/export search.
- [x] Do not invent retry/backoff behavior merely because an unused constant existed.

Acceptance criteria:

- [x] Two auth constructions using the same reviewed JWT plugin succeed.
- [x] A foreign adapter still fails closed.
- [x] Every remaining synchronization/guard method has a production caller and a test
      for its invariant.

Ledger note (2026-07-26):

- `configureSharedJwks` now installs one module-owned `sharedJwksReader` function.
  Re-entry accepts only that exact identity; a consumer-supplied reader remains a
  fixed configuration failure. Red proof reproduced
  `AUTH_JWKS_CONFIG_INVALID` on the second Better Auth construction over one
  hoisted reviewed JWT plugin. Green proof constructs twice successfully and
  separately rejects a foreign `getJwks`.
- Session synchronization now exposes only `observe`, `createBarrier`, and
  `dispose`. The revision remains private so a barrier still means “created before
  this observation,” but callers can no longer carry or inspect an inert revision
  token. All three methods have production callers and direct tests for later
  matching observation, disposal cancellation, and fail-closed timeout.
- Final caller/export search found no production use of `assertPkceS256`,
  `projectOAuthProtectedResourceMetadata`, or the authorization projection's
  self-allowlist. Deleted those helpers, their constants, and tests that falsely
  presented them as runtime controls. PKCE request enforcement remains owned and
  exercised by the exact pinned provider; Better Convex continues to validate the
  provider profile requires S256.
- Deleted the unreferenced `RETRY_BACKOFF_MS` export and replaced its false
  architecture claim with the actual policy: at most four immediate attempts
  inside one fixed five-second deadline. No delay, scheduler, option, or second
  retry owner was added.
- Proof: focused JWKS/OAuth security passes 161 tests; OAuth provider/profile passes
  207; auth fuzz passes 11; the remaining reviewed mutation set kills 16/16;
  synchronization/token-fetcher passes 11; and the Nuxt auth composable passes 4.
  All typechecks, the package build, and all 29 source/packed provenance records
  pass. The complete repository gate passes 2,029 tests across 169 files together
  with canonical format, lint, and all 14 architecture boundaries.

Phase 4 exit gate:

- [x] Public OAuth bodies, time, profile, and redirect behavior are bounded and
      fail-closed.
- [x] Better Auth field mapping, indexed reads, bulk operations, and schema artifacts
      each have one owner.

---

## Phase 5 — Hard-delete beta API and proof debt

### T5.1 — Complete beta public API hard cuts

- [x] Remove `authEpoch`.
- [x] Remove Vue `null`/`undefined` skip types.
- [x] Remove MCP `era`/request context.
- [x] Remove MCP diagnostic types/options.
- [x] Remove OAuth `nowSeconds` and unused returned `issuedAt`.
- [x] Re-run source and exact-tarball declaration snapshots.
- [x] Add no aliases, deprecated overloads, or compatibility exports.

Ledger note (2026-07-26):

- This consolidation audit rechecked the earlier hard cuts from T3.2, T4.2, and the
  MCP boundary work instead of adding a second implementation path. Source type
  contracts reject direct, ref, and getter `null`/`undefined` query arguments;
  OAuth verification ignores a caller-smuggled `nowSeconds` and returns no
  `issuedAt`; the maintained MCP package exports neither era/request context nor
  diagnostic configuration.
- Fresh exact-tarball declaration gates pass for Vue (25 source files, 4 deep-checked
  entries), MCP (5 source files, 1 deep-checked entry), and Nuxt (151 source files,
  9 deep-checked entries). The Nuxt gate exposed the pinned OAuth provider profile's
  legitimate public type edge; the reviewed declaration graph now names
  `@better-auth/oauth-provider` directly instead of duplicating its callback types.
- Focused Vue type/runtime checks pass 5 tests, OAuth resource verification passes
  46 tests, MCP access/handler/boundary checks pass 35 tests, declaration-manifest
  checks pass 52 tests, and the full workspace typecheck passes. Two canonical
  `pnpm check` attempts hit full-suite subprocess contention in the packed Apps,
  SBOM, and release-evidence files; all 40 affected tests pass together in an
  isolated rerun. The final canonical gate remains open below and was not weakened.

### T5.2 — Replace release source-text tests with behavioral proof

Sources: Claude `REL-02`, `TE-02`.

- [x] Delete assertions over indentation, prose, statement order, and substring counts.
- [x] Parse workflow structure where structure is the invariant.
- [x] Execute release commands where behavior is the invariant.
- [x] Assert the exact 64 KiB, 1 MiB, and 30-second MCP magnitudes behaviorally.

Acceptance criteria:

- [x] Changing formatting cannot fail a release test.
- [x] Breaking release ordering, package selection, or a transport magnitude does fail.
- [x] Tests do not reimplement the production rule in their expected value.

Ledger note (2026-07-26):

- Replaced raw YAML slicing, indentation matches, prose checks, source statement-order
  assertions, and substring counts across the release, preview, governance, upstream
  monitoring, OAuth quota, and cloud-staging suites. Parsed workflow objects now prove
  the exact blocking publication DAG, protected OIDC jobs, action pins, artifact
  transfers, cloud-staging dependency/report, CI budget, preview triggers, and
  non-bypass policy independently of YAML formatting.
- Retained executable proof for the canonical empty-root release family, missing
  companion diagnostics, and rejection of unreviewed artifact/registry coordinates.
  Existing behavioral OAuth provider integration remains the authority for pre-lookup
  client-auth rejection; duplicate source-order assertions were deleted.
- MCP transport bounds are private implementation constants. Tests now send literal
  65,536-byte/65,537-byte requests, 1,048,576-byte/1,048,577-byte responses, and advance
  a literal 29,999/30,000 milliseconds, so changing a production magnitude breaks the
  proof instead of changing the test's imported expected value.
- Focused release/security integration passes 135 tests, focused MCP transport/handler
  passes 32 tests, the combined rewritten surface passes 66 tests, and full workspace
  typecheck passes. The canonical full pool remains environmentally unhealthy: in the
  complete run, unrelated subprocess/network suites time out (including 24 token
  exchange cases at exactly five seconds), while the same token suite passes all 26
  tests in 328 ms alone. No timeout or assertion was weakened; the final gate remains
  open for root-cause isolation.

### T5.3 — Correct the “mutation testing” evidence

Source: Claude `TE-01`.

- [x] Inventory which manually authored fault-injection cases uniquely exercise
      production invariants.
- [x] Move unique production assertions into normal security/behavior suites.
- [x] Delete or accurately rename the remaining hand-authored mutant harness.
- [x] Remove “17 killed security mutants” from attestations unless production code is
      actually mutated by the gate.

Acceptance criteria:

- [x] No evidence labels hand-authored alternate functions as production mutation
      testing.
- [x] No unique security invariant is lost.
- [x] The release gate reports only executed evidence classes.

Ledger note (2026-07-26):

- Audited all 16 hand-authored cases. Thirteen production negatives already had normal
  owners in OAuth security/provider integration, auth fuzz, proxy, and signed-client-IP
  suites. The three unique assertions moved first: `consumeOne` is now proven to issue
  exactly one component mutation with no query, and Convex adapter tests directly reject
  immutable-id and unique-field bulk updates.
- Deleted the alternate insecure closures, manifest, contract helper, custom runner, two
  Vitest projects, package script, and both CI invocations: 899 lines removed. No
  mutation-testing alias or renamed harness remains because production code was never
  mutated.
- Removed the false command and “killed security mutants” claims from current docs,
  historical evidence summaries, and the vNext task ledger. `verify:auth` now reports
  only gates it actually executes.
- Adapter suites pass 37 tests, OAuth passes 207, auth fuzz passes 11, affected workflow
  tests pass 26, full workspace typecheck and lint pass, and a repository-wide stale-name
  scan is empty.

### T5.4 — Delete candidate-profile mirrors

Sources: Codex `F-013`; Claude `REL-03`.

- [x] Delete `reviewedRunners` and duplicate exact-list tests.
- [x] Keep one static package/candidate descriptor.
- [x] Retain structural shape, safe-path, uniqueness, closed-map, actual-runner, and
      artifact-consumption tests.

Acceptance criteria:

- [x] Adding/changing a maintained runner requires one authority edit.
- [x] An unknown runner or package still fails.
- [x] The validator can fail without editing its expected copy in the same change.

Ledger note (2026-07-26):

- Deleted the private `reviewedRunners` mirror and all whole-profile equality assertions.
  `candidateTestProfiles` is now the only candidate-matrix authority; tests discover every
  package profile and runner from it.
- The validator now checks facts outside that authority: the package-manifest profile map is
  closed, runner and fixture paths are package-owned and safe, runner files and fixture
  directories are real non-symlink repository entries, pnpm fixtures have lockfiles and
  declare the certified package, and companion declarations match fixture manifests.
- The exported validation seam rejects a missing runner, unsafe fixture, duplicate runner,
  unknown companion package, and extra profile without a second expected matrix. Every
  configured runner is also spawned with a deliberately absent artifact and must fail on
  that exact path, proving the selected executable consumes the supplied candidate.
- Focused candidate tests pass 7/7; the adjacent manifest/artifact tests pass 125/125; lint,
  typecheck, and diff checks pass. `release-artifact-evidence` again fails only when sharing
  the larger subprocess-heavy pool (32/32 SBOM setup failures) and passes alone 32/32 in
  47.21 seconds, matching the previously recorded full-pool resource-isolation issue.

### T5.5 — Make content manifests independent of verifier umask

Source: Claude unverified `REL-04`, independently accepted.

- [x] Read path, size, and mode from archive headers.
- [x] Continue hashing the extracted file bytes.
- [x] Do not derive certified modes from umask-filtered extracted filesystem stats.

Acceptance criteria:

- [x] The same tarball verified under umask `022` and `077` produces an identical
      content manifest.
- [x] Executable bin modes match the archive, not the verifier environment.
- [x] Path traversal, symlink, duplicate-entry, and unexpected-file checks remain.

Ledger note (2026-07-26):

- `inspectTarballArchive` now retains and validates each file header's path, declared size,
  and numeric mode. `packAndExtract` carries that closed header list to content-manifest
  generation instead of rediscovering certified metadata from the extracted filesystem.
- Content manifests join archive path/size/mode to SHA-256 hashes of the extracted bytes.
  The join fails on a missing file, size mismatch, or any extracted file absent from the
  archive. Installed-package comparison uses a separate mode-free byte identity, so npm's
  installed modes do not become release evidence.
- The load-bearing regression extracts one tarball under both umask `022` and `077`.
  Filesystem modes demonstrably differ (`644/755` versus `600/700`), but both manifests are
  identical and retain archive modes `644/755`; the restrictive extraction's declared bin
  still passes the executable-mode check.
- Archive path/type/link/duplicate/count/size tests pass 20/20, including a new invalid-mode
  rejection. Release evidence passes 32/32 standalone, lint and typecheck pass, and the real
  MCP packed-entry gate emits its manifest successfully from the retained headers.

### T5.6 — Derive physical package pins and repeated manifest policy

Sources: Claude `REL-07`, `TE-06`, and `REL-09`.

- [x] Derive Vue/MCP physical-version expectations from their own reviewed package
      manifests.
- [x] Keep `supportedDependencyTuple` scoped to the Nuxt/auth tuple; do not turn it into
      another all-package authority.
- [x] Hoist identical lifecycle-script/engines policy used by per-package validators
      into one private release policy.
- [x] Remove copied candidate-set digests only after a downstream-consumer trace proves
      they are unread.

Acceptance criteria:

- [x] Changing a copied package manifest pin makes every SBOM/validator/probe derive or
      fail from that one source.
- [x] Exact installed-byte and SBOM validation remain strict.
- [x] No executable script maintains an independent copy of the same version tuple.

Ledger note (2026-07-26):

- Vue now owns its resolved physical Vue version as the exact
  `packages/vue/package.json` dev pin; MCP already owns its server SDK pin in
  `packages/mcp/package.json`. SBOM profiles derive those physical versions from the
  reviewed manifests and reject non-exact pins. `supportedDependencyTuple` remains limited
  to the Nuxt/auth runtime tuple.
- MCP package validation now requires exactly the official server dependency key and relies
  on the existing candidate-versus-reviewed manifest equality for its version. MCP package,
  local-fixture, and Vue/MCP App consumers read the candidate or reviewed manifests rather
  than carrying executable version literals. A scan of executable `.mjs` scripts finds none
  of the retired Vue/Convex/MCP physical-version copies.
- The three identical lifecycle allow/deny lists and node-engine checks are one private
  release policy. Focused production-manifest and candidate-set suites pass 45/45 with a
  net deletion of 66 lines in that commit.
- Downstream trace: candidate-set preparation reparses each package's full evidence and
  invokes `release.mjs verify` per package; the registry consumer reads only set identity
  and coordinates, then compares registry tarball bytes and exact installed content.
  Therefore copied set-level `sha256`/`integrity` fields had no consumer and were deleted;
  per-package digests, SRI, content manifests, and installed-byte checks remain unchanged.
- Graph-backed SBOM and manifest tests pass 48/48; direct workspace lint and all module,
  server, and fixture typechecks pass. Pnpm's frozen lockfile command could not complete
  because its supply-chain policy attempted registry access despite `--offline`; the only
  lock change is Vue's importer specifier from `^3.5.39` to already-resolved `3.5.39`.

### T5.7 — Remove temporary proof surfaces after final reconciliation

- [x] Delete `internal/labs/agentic-saas` after extracting a minimal schema-options
      fixture only if it still proves a unique schema vector.
- [x] Keep `internal/labs/mcp-topology` through final real-host reconciliation; it is an
      active neutral proof consumer despite its `labs` name.
- [ ] Archive historical `internal/evidence` after preserving durable ADRs and the final
      release dossier.
- [ ] Remove obsolete private RC interaction code after final SDK reconciliation.

Acceptance criteria:

- [x] No maintained test depends on an unmaintained mock application.
- [x] Generated-schema coverage remains equivalent.
- [ ] Final proof remains reachable without carrying historical intermediate
      narratives as active authority.

Interim ledger note (2026-07-26):

- Deleted the 51-file `internal/labs/agentic-saas` mock application (16,939 lines).
  Its only maintained external consumers were schema generation and two adapter invariant
  assertions. The purported schema vector was not unique: the maintained local-component
  fixture already owns the same default organization member index, while the team starter
  owns the renamed/team-enabled variant. Tests now use those maintained fixtures directly;
  no replacement mock was added.
- Removed the lab from root typecheck and schema generation. All four remaining generated
  schema targets are current; the focused schema/candidate/adapter suites pass 36/36.
- Retained `internal/labs/mcp-topology`: neutral-notes and MCP Apps tests import it directly,
  so deleting or archiving it before final SDK/real-host reconciliation would remove active
  proof. Historical evidence and private RC interaction deletion remain intentionally open
  until the final `2026-07-28` protocol/SDK gate in T2.6 can run.

### T5.8 — Reconcile published and normative documentation

Claude IDs: `NORM-01` through `NORM-05`.

- [x] Update `SECURITY.md` only where a production trace proves the current topology or
      package ownership is misstated; do not treat byte age alone as a defect.
- [x] Make `RELEASING.md` name the one canonical release command and exact staging
      guarantees.
- [x] Remove obsolete RFC “current source” links and deleted-path diagrams.
- [x] Remove the `plan.md` stable-publication dependency if that file remains
      non-normative/0.7-specific.
- [x] Make the decision ledger match the actual removal of MCP RC context.

Acceptance criteria:

- [x] Every operational security/release claim names an enforcing production path or
      executed gate.
- [x] No doc claims a staging, mutation, conformance, or artifact property that its
      cited evidence did not execute.
- [x] Historical intent remains clearly distinguished from current authority.

Ledger note (2026-07-26):

- Traced the shipped MCP path through the application-owned Convex routes,
  `createConvexMcpHandler`, the supplied verifier, explicit official-SDK registration,
  and named internal functions. `SECURITY.md` now names that path, states that Nuxt owns
  no MCP route, includes all three prerelease packages, and matches the current Better
  Auth/OAuth Provider RC.
- Reconciled protected staging with `scripts/run-auth-cloud-staging.mjs`: the Nuxt
  fingerprint and auth responses prove candidate bytes, while the separate Convex MCP
  resource proves its exact unauthenticated RFC 9728 challenge. Removed the unsupported
  MCP fingerprint and Nuxt-ingress claims. `pnpm release:prepare` remains the sole
  package-family preparation command.
- Replaced the RFC's deleted topology/proxy/starter links and proposed tree with the
  hard-cut repository shape; all 16 relative RFC links resolve. Decision `D-055` and the
  admission ledger now record that the public locked-RC request-era callback context was
  actually removed, without claiming the still-open final private RC reconciliation is
  complete.
- Removed the final stable-release delegation to historical `plan.md`. The RFC owns 1.0
  eligibility, `SECURITY.md` owns human approval, and canonical ASVS JSON now owns its
  invariant map instead of scraping the historical plan.
- Deleted the retired `test:auth-mutations` command and nonexistent fixture from the
  historical plan, security lab, canonical ASVS evidence, and generated report. The ASVS
  generator/check passes for 253 controls and 33 auth invariants. Focused release,
  security, package, and version-alignment suites pass 105 tests; the additional focused
  security set passes 17 tests. Local security-governance identity validation correctly
  remains unavailable without the protected owner, deputy, and delivery-test variables.

### T5.9 — Tie-break remaining high-value unverified candidates

These are verification tasks, not pre-approved implementation:

- [x] `OWN-02`/`OWN-03`: trace query gate matrices and paginated first-page network
      behavior after T3.2.
- [x] `RECON-03`: review sibling-package advisory tuple coverage against final SDK
      bytes; derive any generalization from certification manifests/SBOMs, not another
      list.
- [x] `MCP-07`: verify SDK error diagnostics after T2.4 without adding another public
      sink absent a concrete operator consumer.
- [ ] `MCPI-04`/`MCPI-05`/`MCPI-06`: measure final App payload and re-check interaction
      contracts after RC code deletion.
- [x] `REL-05`: verify a monotonic retired-version rule before replacing the growing
      reviewed list.
- [x] `TE-04`/`TE-06`/`TE-09`: replace only after showing the present test can pass with
      broken behavior.
- [x] Vue/controller dead-surface candidates: enumerate production callers after Phases
      1 and 3, then delete only members with zero callers and zero invariant.
- [x] Better Auth `BAA-09`: replace legacy id-only database overloads with table-checked
      overloads opportunistically after relationship tests prove equivalence.
- [x] Error cleanup `ERR-04` through `ERR-09`: after diagnostic deletion, bound retained
      sanitization work, consolidate proven duplicate identity errors, reuse `toJSON`,
      remove unused parameters, and delete only controls with no consumer.

Tie-break acceptance:

- [x] Each candidate ends as either an executed accepted finding with its own
      acceptance test, or a written rejection with production evidence.
- [x] No unverified finding is retained as a “maybe” implementation backlog.

Interim ledger note (2026-07-26):

- `OWN-02` accepted only as a parity requirement, not a new helper. Nuxt still owns the
  SSR/hydration gate and Vue owns the client gate; an exhaustive matrix now proves every
  representable Nuxt status/auth/skip combination selects the same client decision.
  Removed the gate's unread `subscribe`, `useAnonymousClient`, and `reason` transport
  fields and the zero-caller `selectLiveQueryClient`.
- `OWN-03` was already correct in production. The strongest regression now takes the
  real awaited hydration path and proves one live subscription plus zero duplicate
  one-shot first-page queries. Focused query and pagination suites pass 49 tests.
- `RECON-03` accepted. `scripts/reviewed-runtime-versions.mjs` derives the complete
  sibling runtime advisory tuple from the certification descriptors and bound manifests;
  both advisory checking and SBOM generation consume that derivation. The test compares
  every derived coordinate to its manifest rather than mirroring versions.
- `MCP-07` accepted without a public diagnostic sink. Server configuration and unary
  capability hardening now run inside the existing request deadline but before the
  official SDK's reporting-only error boundary, so Convex's ordinary uncaught-error
  telemetry observes a configuration failure. A formerly swallowed unsupported
  capability now rejects with the fixed local code; 27 focused handler/transport tests
  and the MCP typecheck pass.
- `MCPI-04`, `MCPI-05`, and `MCPI-06` have executed current-RC remediations, but their
  grouped checkbox remains open until T2.6 deletes obsolete RC code and repeats the
  measurement against final SDK bytes. The App fell from 394,258 bytes/50 locale modules
  to 257,357 bytes/one required English locale, with a 288 KiB build ceiling. Origin,
  path prefix, locator grammar, parsing, and URL construction now have one interaction
  contract. The generic `runMcpTool` success type deleted the fixture's duplicate opaque
  error boundary without exporting RC vocabulary. Focused MCP Apps browser proof and
  tool-error suites pass.
- `REL-05` accepted. Replaced 37 enumerated retired versions, including holes, with one
  SemVer floor per reviewed package. Tests prove lower core/prerelease identities fail,
  the exact floor and successors pass, stable outranks prerelease, unrelated packages
  remain unaffected, and all 49 artifact-coordinate cases pass.
- `TE-04` accepted as behavioral proof: direct HTML-escaping assertions replaced source
  regex/callsite inspection. `TE-06` accepted by deriving MCP documentation and topology
  package versions from manifests; the remaining version literals are deliberate
  synthetic fixtures. `TE-09` accepted: a current identity-rejected call settles idle,
  while an older stale rejection cannot mask a newer pending or successful call.
- The Vue/controller caller sweep deleted 52 lines of query controller default/error
  seams, 19 lines of inert pagination boundary state, the callable's test-only start
  hook, and the unconsumed retired-client close diagnostic. The eager authenticated
  primary and per-composable Nuxt identity mirror findings are rejected as stale:
  `client-owner` is already lazy when an identity port exists and
  `ConvexQueryAuthContext` contains only the three read fields. The same-key one-shot
  race is also rejected: `refreshSequence` is the commit authority and the reverse-order
  regression retains the newer result. A shared query/pagination fence was rejected:
  subscriptions accept repeated deliveries while pagination additionally fences page
  generations and splits. `subscribeIdentityChange` remains because `browser.ready()`
  is a production consumer; replacement remains the private security-boundary engine.
- `BAA-09` accepted after relationship equivalence tests: patch/get/delete operations
  use the table-checked Better Auth database overloads. The adapter's 37 tests and Vue
  typecheck pass.
- `ERR-04` bounds sanitizer input before escaping; `ERR-06` reconstructs from canonical
  `toJSON`; `ERR-08` uses structural preconditions rather than message sentinels;
  `ERR-07` and `ERR-09` were already deleted with diagnostics. Vue auth now uses its one
  identity-error constructor and disposal no longer claims `IDENTITY_CHANGED`. Nuxt's
  small upload helper remains private because sharing it would require a new public
  cross-package contract solely to remove 21 lines.

Phase 5 exit gate:

- [x] Public beta surface contains only earned contracts.
- [x] Evidence labels match what was executed.
- [x] One current security/release narrative remains.

Phase 5 exit ledger note (2026-07-26):

- Generated API-surface documentation is current; the exact package-entry manifest
  passes 27 tests. The single-runtime-owner gate and all 14 package-boundary rules pass
  over 268 files. T5.9 added no registry, compatibility path, public diagnostic sink, or
  cross-package helper solely for deduplication.
- The current `SECURITY.md`, `RELEASING.md`, RFC, canonical ASVS data, and release
  scripts now agree on topology, package ownership, evidence classes, staging claims,
  and stable eligibility. Historical material is labeled as evidence rather than
  operational authority.
- Every T5.9 candidate has an accepted implementation or a production-evidence
  rejection. The unchecked MCP Apps line is not an undecided backlog: it requires one
  prescribed repeat against final SDK bytes after the T2.6 hard cut.

---

## Phase 6 — Final verification and protected staging

### Source and focused validation

- [x] `pnpm run format:check`
- [x] `pnpm run lint`
- [x] `pnpm run typecheck`
- [x] `pnpm run check:boundaries`
- [x] `pnpm run test`
- [x] `pnpm run check:contracts`
- [x] Every focused regression added in Phases 1–4.

Source-validation ledger note (2026-07-26):

- A canonical `CI=true pnpm install` passed the 1,280-entry supply-chain policy and
  restored the exact lockfile graph. Format checked 1,139 files; lint, all module/server/
  fixture typechecks, and all 14 architecture boundaries pass.
- The first sandboxed full test run correctly exposed one stale beta.0 candidate-set
  fixture after REL-05; it now uses the reviewed floor and its 53 focused tests pass.
  Local-listener, Chromium, and pnpm-store denials were rerun outside the sandbox.
- The canonical pool then exposed serial candidate-runner probes exceeding Vitest's
  unchanged five-second budget only under full contention. The same seven independent
  commands now run concurrently with identical assertions; the focused case fell from
  about two seconds to 0.6 seconds. The final canonical pool passes 1,996 tests in 169
  files without increasing a timeout.
- `pnpm run check:contracts` passes the old-runtime absence and single-owner checks,
  source and packed builds, API docs, workspace dependency alignment, consumer/type
  fixtures, auth-disabled graph, and the 151-file/nine-entry packed Nuxt export gate.

### Auth and security validation

- [x] `pnpm run check:auth-advisories`
- [x] `pnpm run verify:auth`
- [ ] Auth cloud/concurrency/export-sentinel/MFA tests against the reviewed backend.
- [x] OAuth chunked-body, clock, redirect, custom-field, indexed-`in`, and transaction
      budget boundary tests.
- [x] No credential, raw cause, stack, response body, or provider-private identifier in
      transferable errors or artifacts.

Auth-validation ledger note (2026-07-26):

- The advisory gate passed parseable production/full npm audits, 12 exact GitHub
  package queries, and imported-upstream queries with zero exceptions.
- The full auth aggregate passed all 29 source-provenance records, upstream monitoring,
  deterministic schema deployment and first writes on reviewed backend
  `precompiled-2026-07-06-44f7aa7`, 37 adapter tests, 207 OAuth tests, 11 fuzz tests,
  and the MCP authorization/conformance tail.
- Secret sentinels scanned 287 packed files, 281 build files, 569 artifact leaves, and
  runtime database/HTTP/error/console/DevTools surfaces without finding credential,
  raw-cause, stack, response-body, or provider-private leakage. The export sentinel
  separately scanned five credential-bearing tables, 43 bounded export files, and
  browser local/session/cookie storage; Cache Storage and IndexedDB remained absent.
- Concurrency, transport quota, authorization-code race, and MFA all passed: logical
  and unique writes/consumes had one winner, increment completed 200/200, failure
  paths rolled back, chunked quotas rejected bypasses, consumed codes could not replay,
  and concurrent invalid factors enforced lockout. The maintained OAuth suite retains
  clock, canonical redirect, custom-field select/sort, indexed-`in`, and 128-row
  transaction-budget boundaries.
- The combined cloud/concurrency/export/MFA checkbox remains open solely because
  protected `test:auth-cloud-staging` requires the final candidate artifact manifest.
  Its concurrency, export-sentinel, and MFA components passed in this run.

### MCP validation

- [ ] Official final-SDK conformance.
- [x] Mid-call notification with exactly-once committed effect.
- [x] Stateless subscription rejection.
- [x] Real-browser App stray-message recovery.
- [x] Real-browser high-impact confirmation without header rewriting.
- [x] Maintained neutral and OAuth starters against exact packed MCP bytes.
- [ ] At least one real host for MCP Apps before claiming host interoperability.

MCP-validation ledger note (2026-07-26):

- The focused handler/App/browser slice passes 36 tests. A tool that increments one
  application effect and emits mid-call progress returns one unary committed result;
  the dropped notification does not retry the effect. Official SDK responses reject
  `resources/subscribe`, `resources/unsubscribe`, and `subscriptions/listen` in the
  stateless configuration.
- Real Chromium tolerates unknown-response/progress bridge diagnostics without losing
  an in-flight result, remains usable for the next tool call, and still treats connect
  and teardown as terminal. The separate application-owned interaction page submits
  its scriptless POST with native browser headers, receives 303, and proves subject
  binding, stale/replay safety, inert GET, bounded empty POST, and locator secrecy.
- The MCP declaration fix is verified in built bytes: `runMcpTool` retains both its
  ordinary `CallToolResult` contextual signature and its generic result signature.
  The full disposable Convex topology passes four tests against those packed bytes.
- One exact `@better-convex/mcp@0.1.0-beta.9` tarball passed its public-entry gate and
  all three maintained consumers: provider-neutral contract, Better Auth/OAuth
  production composition (including 55 MCP tests and live authorization), and the
  external-verifier Convex application with real browser confirmation.
- Final-SDK conformance remains gated on T2.6. Real-host interoperability remains a
  separate external-host proof and is not inferred from the browser harness.

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

- [x] Do **not** add a public core/catch-all package.
- [x] Do **not** add Commands, approvals, workflow, RBAC, or a second canonical
      high-impact-operation store.
- [x] Do **not** add a second MCP registry, automatic tool interceptor, or Nitro MCP
      topology.
- [x] Do **not** convert `@modelcontextprotocol/server` to a consumer-owned peer merely
      because `McpServer` appears in a callback; the package intentionally constructs
      and owns that instance.
- [x] Do **not** remove `createBetterAuthMcpAccessVerifier`; Ginko is a real consumer and
      the narrow verifier result prevents provider-private state entering public access
      context.
- [x] Do **not** treat the request-local starter verifier closure as module-global state.
- [x] Do **not** add a cascade projection, cache, queue, or background job before a real
      workload exceeds the bounded transaction contract.
- [x] Do **not** remove the exact Kysely peer. Better Auth permits a wider range, so the
      peer is what forces the reviewed physical runtime tuple.
- [x] Do **not** split `rotateSigningKey` into another service/factory; it is an
      intentionally atomic JWKS-domain operation.
- [x] Do **not** add a policy hook to derived user-projection cleanup without a real
      application-owned canonical-row requirement.
- [x] Do **not** parallelize cursor-dependent pagination.
- [x] Do **not** refresh every loaded page on each live head update.
- [x] Do **not** redesign the upload queue around a `Map` without a benchmark that
      crosses the current simple-array budget.
- [x] Do **not** split `client-owner.ts` or the auth plugin because of file size alone.
- [x] Do **not** add compatibility shims for vNext beta APIs.
- [x] Do **not** accept `Origin: null` as a general CSRF solution.
- [x] Do **not** remove exact artifact integrity or request-isolation controls.
- [x] Do **not** delete the trusted live-codegen freshness gate: the main/scheduled
      workflow supplies its deploy key outside PR-controlled execution.
- [x] Do **not** implement Claude consensus-rejected controller/MCP/adapter hypotheses
      unless new production evidence changes their premise.

Ledger note (2026-07-26):

- Final caller, export, dependency, route, and architecture searches found none of the
  rejected additions or removals above. The remediation kept the existing package
  boundaries and direct SDK/application ownership, used hard cuts for unreleased
  surfaces, and retained every listed security or release invariant.
- The only unverified Claude candidates carried forward were the bounded T5.9 set. Each
  presently decidable candidate now has an accepted implementation or a production-trace
  rejection; the final-SDK-dependent MCP Apps recheck remains explicitly in T2.6.
