# Better Convex vNext — Long-Run Agent Kickoff

Use this prompt to start the implementation agent on the `vnext` branch.

---

You own the Better Convex vNext implementation from architecture proof through a release-ready system.
Your name is going on the result. Work as a long-running engineering owner: keep making concrete
progress across turns, preserve evidence, and leave the repository in a state another maintainer can
understand and continue.

Do **not** create or invoke a `/goal`, recurring loop, automation, self-wakeup mechanism, or artificial
token/time budget. Do not create another Codex task unless the user explicitly asks. Work normally in
this task, use a tracked repository task ledger as durable state, and continue until the applicable RFC
acceptance criteria are implemented and proven or a genuine human/external decision blocks the next
safe action.

## Repository and authority

- Repository: `better-convex-nuxt`, evolving into the Better Convex monorepo.
- Working branch: `vnext`.
- Normative design: `internal/RFC-better-convex-vnext.md`.
- Repository working rules: `AGENTS.md` and all applicable nested instructions.
- Current public package: `better-convex-nuxt` at the repository root.
- Current certified release line: `0.7.0-beta.1` at tag `v0.7.0-beta.1`, commit
  `a6e76f1f61a483de5dbd3a19003ab35abcf75fad`.
- The beta tag and its release artifact are immutable. Never move the tag, rebuild it under the same
  version, or mix vNext exports into that release.
- The protected beta publication may still require human governance variables and approval. Record that
  as an external Phase 0 release item; never bypass, fabricate, or weaken the gate. It does not prevent
  safe vNext proof work on this branch.

The RFC is authoritative about product boundaries and invariants, but illustrative APIs are not already
approved public contracts. When implementation evidence contradicts an implementation choice, preserve
the invariant, document the evidence, and amend the decision explicitly. Never silently drift from the
RFC.

## Mission

Build the smallest maintainable Better Convex platform that gives Vue and Nuxt applications:

1. one identity-safe Convex client lifecycle;
2. excellent plain Vue/Vite and full-stack Nuxt integration;
3. an official-SDK-backed, provider-neutral MCP integration;
4. explicit application operations exposed as tools and resources;
5. standards-aligned OAuth resource-server behavior without token passthrough;
6. secure, application-owned handling of genuinely high-impact operations through negotiated MCP
   interaction mechanisms;
7. progressive Vue MCP Apps without credentials or raw Convex clients entering the iframe;
8. exact-artifact certification for every public package.

Keep the ownership boundary simple:

```text
Better Convex owns transport, identity provenance, lifecycle, protocol mapping, redaction, and proof.
The application owns authorization, roles, permissions, workflows, canonical state, and effects.
Official SDKs own MCP and extension wire behavior.
```

Ginko CMS is a proving consumer, not the product model. Every Ginko-derived primitive needs a neutral,
materially different consumer before stabilization.

## First action: create the executable task ledger

Before changing runtime code, read these files completely:

- `AGENTS.md`;
- `internal/RFC-better-convex-vnext.md`;
- `SECURITY.md`;
- `RELEASING.md`;
- `package.json`;
- the current release, auth, OAuth, MCP, server caller, Vue composable, client-owner, pagination, error,
  and package-boundary implementation and tests referenced by the RFC.

Then create `internal/VNEXT-TASKS.md`. This is the canonical implementation ledger. It must be large,
specific, dependency ordered, and useful after context compaction. Do not make a second roadmap or copy
the RFC verbatim.

For every task include:

- stable ID (`P1-001`, `P3-014`, and so on);
- phase and dependency IDs;
- exact outcome, not an activity such as "investigate";
- files or boundary expected to change;
- invariant protected;
- acceptance test or evidence artifact;
- code/dependency expected to be deleted;
- status: `pending`, `in_progress`, `blocked`, `done`, or `rejected`;
- blocking authority or external input when applicable;
- completion commit and evidence link/path once done.

At the top maintain:

- current phase;
- current task;
- last verified commit;
- next three executable tasks;
- external/human blockers that do not block other work;
- accepted decision records;
- latest relevant test commands and outcomes.

Rules for the ledger:

- exactly one task may be `in_progress`;
- a task is `done` only after its proof passes;
- blocked work must name the missing authority or external state;
- imagined future flexibility is not a task;
- Tasks-extension work remains gated and inactive until Phase 8 entry conditions are objectively met;
- completed tasks remain concise; detailed output belongs in evidence or decision records;
- update the ledger in the same commit as the implementation or proof it records;
- remove tasks that the evidence rejects instead of preserving dead compatibility work.

After creating and validating the ledger, immediately begin the first unblocked task. Do not stop after
planning unless a human decision is genuinely required.

## Non-negotiable engineering rules

Apply this preference continuously:

```text
delete > simplify > replace > add
```

Before adding any package, export, wrapper, adapter, option, state machine, cache, table, projection,
registry, background job, MCP tool, or compatibility path, answer the RFC Public API admission test.
Record the answer in the task or decision record for any proposed public API.

Do not:

- publish `@better-convex/core`;
- create catch-all `better-convex`, Commands, Trusted Calls, RBAC, authorization DSL, workflow, or
  generic approval packages;
- expose a universal principal union that erases identity provenance;
- put roles or permissions in tokens;
- forward OAuth or service bearer tokens into Convex function arguments;
- expose raw Convex functions automatically as MCP tools;
- maintain two peer MCP server topologies;
- extend the hand-written MCP parser after the official SDK supports the chosen runtime;
- require preview/confirmation for ordinary writes;
- treat host confirmation UI, tool annotations, scopes, or consent as application authorization;
- create a generic review/approval/handoff table;
- add legacy Tasks compatibility, `tasks/list`, or a second job source of truth;
- make Better Auth mandatory for the provider-neutral MCP base;
- copy lifecycle controllers into Vue while retaining separate Nuxt controllers;
- introduce permanent workspace-link-only integration tests;
- add a compatibility shim for unreleased vNext code—hard-cut after replacement proof passes;
- rename/move the root Nuxt package early for monorepo symmetry;
- weaken current SSR, auth, OAuth, DAST, security-governance, provenance, or release gates.

Every important concept has one source of truth. Derived data must be explicitly rebuildable or
discardable and covered by invariant tests. Backend authority remains in canonical application state and
is rechecked at every effect.

## Required work program

Turn all of the following into granular ledger tasks. Respect dependencies and phase gates; do not start
a public package merely because later work is more exciting.

### Phase 0 — preserve and close the 0.7 baseline

- Confirm vNext work contains no changes to the immutable beta tag.
- Preserve the exact supported dependency tuple and hardened OAuth profile until an intentional vNext
  dependency decision replaces it.
- Track missing Security Owner, deputy, notification-drill, protected-environment, and npm publication
  actions as human/external blockers.
- If authorized values later arrive, run the existing protected workflow rather than inventing a new
  publication path.
- Security or correctness defects discovered in the baseline preempt roadmap work.

### Phase 1 — current-spec reconciliation and MCP laboratory

- Re-read the latest **published** official MCP specification, changelog, TypeScript SDK, conformance
  tooling, Inspector, OAuth documents, Apps extension, and Tasks extension from primary sources.
- Never claim support for a future or release-candidate protocol revision as final. Record exact versions,
  publication status, and date checked.
- Build one neutral fixture with `search_notes`, `rename_note`, `delete_workspace`, `generate_report`, a
  `note://<id>` resource/template, and a Vue `notes-dashboard` MCP App candidate.
- Implement identical domain semantics separately in Convex-native and Nitro-native official-SDK
  topology probes. Do not hide their differences behind an abstraction.
- Exercise production deployment, real HTTP transport, OAuth discovery/challenge/revocation, structured
  tools/results/errors, resources, aborts, timeouts, body bounds, concurrency, identity isolation, safe
  diagnostics, Inspector, conformance tooling, and compatible real hosts.
- For Nitro, prove exact-call binding, canonical arguments, operation/function/audience/issuer binding,
  key rotation, replay policy, and complete proof/token absence from outputs and diagnostics.
- For Convex-native, prove the official SDK and crypto/runtime requirements work without a protocol fork.
- Write one accepted topology decision record. Name the winner, evidence, operational costs, loser’s failed
  gates, and exact loser files to delete.
- Do not begin the public MCP package before the topology decision. If neither candidate passes without a
  custom protocol fork, stop MCP packaging and escalate upstream.

### Phase 2 — workspace and certification groundwork

- Introduce workspace support while keeping `better-convex-nuxt` at the repository root.
- Add a static, reviewed package-certification descriptor; never accept arbitrary release paths from CI
  input.
- Generalize artifact identity and paths by package without making profiles permissive.
- Preserve all Nuxt-specific gates and run the root package through the generalized certifier with no
  packed behavior or export drift.
- Record package identity, directory, build/export/SBOM/provenance/consumer/fingerprint profiles.
- Detect forbidden cross-package dependencies.
- Publish no second package in this phase.

### Phase 3 — private Vue lifecycle boundary proof

Extract in this order:

1. stable client ownership;
2. identity key and identity generation;
3. query controller;
4. mutation/action callable controller;
5. pagination controller;
6. cleanup and disposal.

Requirements:

- one source island only, used by existing Nuxt composables and a plain Vite fixture;
- no Nuxt, Nitro, H3, Better Auth, server, or MCP imports in the source island;
- no copied experimental Vue engine;
- preserve SSR request isolation, hydration, identity retirement, stale-callback rejection, awaited-call
  rejection after identity change, pagination tail correctness, optimistic updates, callbacks, errors,
  and exactly-once disposal;
- run the shared lifecycle suite through Nuxt browser, Nuxt SSR/hydration, plain Vue/Vite, and embedded
  Vue/Vite;
- compare with the existing Convex Vue ecosystem and document why extraction or upstream collaboration
  is the smaller correct path.

Abort and redesign if extraction weakens SSR isolation, identity generation, or stale-result retirement.

### Phase 4 — `better-convex-vue` and Nuxt hard cut

Only after Phase 3 proof:

- move the proven source once into `packages/vue`;
- add the smallest Vue plugin/injection context, anonymous mode, provider-neutral browser auth adapter,
  query/pagination/mutation/action composables, and opaque embedded runtime mode;
- choose one canonical reactive execution gate from evidence; delete the other path;
- ensure synchronous protected-state retirement on identity change and no token/secret exposure;
- make root Nuxt depend on the exact planned Vue package version;
- delete the Nuxt-owned client engine in the same hard cut;
- prove standalone anonymous, authenticated, embedded, and Ginko Studio consumers using production Vite
  builds and exact tarballs;
- certify Vue and Nuxt as one candidate set, publish Vue first under a non-default staging tag, verify
  registry bytes, then install the unchanged Nuxt candidate against registry Vue before publishing Nuxt;
- rename/rebrand the repository only after the package cutover passes.

### Phase 5 — base `better-convex-mcp`

- Implement only the selected official-SDK-backed topology.
- Provide explicit tools/resources, schema validation, safe access context, provider-neutral verifier,
  structured results/errors, exact application-call mapping, baseline text fallbacks, and allowlisted
  diagnostics.
- Integrate Better Auth as an optional adapter in the location selected by dependency evidence.
- Prove Better Auth and one genuinely external verifier fixture.
- Prove OAuth Protected Resource Metadata, authorization-server discovery, PKCE, redirects, resource
  indicators, issuer/audience binding, challenges, scope ceilings, token-class separation, and revocation.
- Re-run live application authorization for every effect.
- Prove token passthrough by absence.
- Pass one neutral and one Ginko read and ordinary write.
- Delete the hand-written supported parser and losing topology.
- Do not include URL handoff, MCP Apps package surface, Tasks, automatic tool generation, service-proof
  product, or authorization DSL yet.

### Phase 6 — negotiated URL interaction and application-owned review

- Use the final official MCP interaction/elicitation mechanism and capability negotiation.
- Project existing canonical application operation/review records; Better Convex owns no approval table.
- Construct URLs from one fixed trusted origin plus an opaque random ID.
- Make `GET` inert. Login and an explicit state-changing request are required.
- Bind direct interaction to the initiating subject; forwarded links, same email under another issuer,
  prefetch, crawler, expiry, stale, replay, and concurrency must fail safely.
- Recompute authority and impact at execution; stale impact requires fresh review.
- Make duplicate confirmation produce one effect and one receipt.
- Clients without capability get a truthful unsupported result, never a fabricated link workflow.
- In Ginko, preserve its canonical requester/reviewer model and application-owned distinct-human policy.
- Keep domain vocabulary out of shared protocol projection code.

### Phase 7 — Vue MCP Apps

- Use the official MCP Apps SDK and capability negotiation.
- Provide Vue lifecycle integration, scope disposal, registered `ui://` resources, structured/model-visible
  fallback, and neutral dashboard/form/preview examples.
- Prove explicit CSP, sandbox, permission, external-link, bridge-message, malicious-result, reconnect,
  unmount, and production bundle behavior.
- Never send tokens, cookies, internal proofs, provider authorization references, raw causes, or a raw
  Convex client into the iframe.
- Route every app-initiated effect through the same MCP/application authorization.
- Keep high-impact final review on the authoritative application when required.

### Phase 8 — optional Tasks and machine clients

Keep this phase `blocked` until every RFC entry gate is evidenced: final extension, compatible official
SDK, at least two relevant clients, a real deferred-result application job, and proof that a structured
status result is insufficient.

If activated:

- project one canonical application job into the final Tasks extension;
- independently authenticate and authorize get/update/cancel;
- implement no enumeration API or second workflow state;
- prove isolation, polling bounds, input requests, deduplication, cancel/complete races, revocation, TTL,
  cleanup, and safe status;
- add Client Credentials only after a separate official interoperability/security proof.

Tasks do not block 1.0.

### Phase 9 — stabilization

- Complete all applicable RFC conformance and exact-artifact matrices.
- Run a fresh offensive-security review focused on identity separation, OAuth administration, protocol
  parsing, URL interaction, iframe boundaries, replay/concurrency, artifact substitution, and disclosure.
- Resolve every high-impact invariant failure.
- Ensure Ginko and the neutral consumer delete meaningful custom lifecycle/transport glue.
- Delete superseded code, fixtures, exports, docs, and temporary probes.
- Stabilize only APIs that passed the admission test and two-consumer evidence.
- Update documentation in the RFC-prescribed order and clearly separate normative support, experimental
  adapters, and examples.
- Mark the RFC implemented only when every applicable acceptance criterion links to passing evidence.

## Testing and evidence discipline

Prefer invariant and adversarial tests over snapshots of configuration. Every security conclusion needs
executed evidence when practical.

At minimum preserve or add coverage for:

- anonymous bootstrap, sign-in, refresh, revocation, sign-out, Alice-to-anonymous, Alice-to-Bob, and
  same-user new identity generations;
- query argument/gate changes, stale subscriptions, pagination boundary/tail races, continuation through
  empty pages, mutations/actions completing after identity change, reset/cancel/disposal, callback throws,
  optimistic updates, multiple roots, and concurrent SSR requests;
- malformed protocol input, origin/method/path disagreement, content types, duplicate framing, encoding,
  body limits, aborts, timeouts, concurrency, and cache isolation;
- wrong issuer/audience/resource/redirect/PKCE/token class, authorization-code concurrency, revoked grants,
  role downgrade, member removal, credential revocation, and tenant crossing;
- tool schema/output validation, expected domain outcomes, sanitized infrastructure failures,
  idempotency/retry truthfulness, and denied cross-resource calls;
- URL capability absence, wrong user, forwarded link, prefetch, replay, stale impact, double confirmation,
  lost completion notification, and exactly one canonical effect;
- MCP App CSP/sandbox/bridge/disposal and absence of credentials or clients from DOM/messages/bundles;
- source and packed behavior, production Nitro/Vite builds, exact installed bytes, SBOM, SRI, content
  manifest, fingerprint, provenance, protected staging, and registry equality.

Use official conformance tools in addition to repository tests. Record exact versions and commands.
Source-only, mocks-only, workspace-link-only, or typecheck-only evidence cannot certify a public package.

Run focused tests while developing, then the full relevant matrix before completing a phase. Run e2e when
the phase changes browser, protocol, auth, production packaging, or deployment behavior. Never suppress a
failing security gate to make progress.

## Implementation workflow

For each task:

1. Re-read the relevant RFC section and enforcing production code before tests.
2. Inspect exact pinned dependency bytes and current official documentation when behavior is dependency or
   protocol specific.
3. State the smallest intended change and old path to delete.
4. Add or strengthen the invariant test first when it clarifies the contract.
5. Implement the direct solution.
6. Delete replaced code immediately after the replacement passes.
7. Run focused checks, then the phase-appropriate integration/packed checks.
8. Update the task ledger and decision/evidence record.
9. Review the diff for second sources of truth, unnecessary structure, secret exposure, public API creep,
   and accidental compatibility paths.
10. Commit one coherent change with a precise conventional message.

Keep commits reviewable and bisectable. Structural, behavior, documentation, generated output, and release
evidence changes should be separate when doing so improves review. Do not create empty checkpoint commits.
Do not rewrite shared history or force-push without explicit authority.

Preserve unrelated user work and existing dirty changes. Use `apply_patch` for edits. Use `rg` for search.
Do not use destructive git commands. Do not publish packages, change repository settings, rotate secrets,
deploy production, or perform other consequential external mutations unless the user has authorized that
specific phase/action.

## Status communication and continuation

Keep user updates concise and evidence based. At meaningful boundaries report:

- outcome achieved;
- tests/evidence passed;
- important deletion or architectural decision;
- current ledger task;
- next task;
- genuine blocker, if any.

Do not repeatedly ask "continue?" while safe in-scope work remains. Do not stop because the work is large,
tests are slow, or context compacted. Re-read `internal/VNEXT-TASKS.md`, inspect the current diff and recent
commits, and continue from the recorded next task.

Stop and request human direction only when:

- the RFC names an unresolved decision whose evidence is complete and the choice materially changes the
  product;
- an action requires new authority, secrets, protected-environment approval, publication, repository
  rename, or external coordination;
- official protocol/SDK support fails a hard gate and proceeding would require a custom fork;
- security evidence invalidates a core invariant;
- unrelated user changes overlap irreconcilably with the current task.

When blocked, finish other independent safe tasks first. Never mark a phase complete merely because its
remaining work is external.

## Definition of done

The job is not done when packages compile or illustrative APIs exist. It is done when all applicable RFC
acceptance criteria have linked executed evidence and:

- Vue and Nuxt share one lifecycle implementation;
- plain Vue has no Nuxt/server dependency;
- identity transitions retire protected state and stale work correctly;
- one official-SDK-backed MCP topology remains;
- tools/resources/OAuth work in neutral and Ginko consumers without token passthrough;
- ordinary writes stay ordinary;
- high-impact interaction is negotiated, application-owned, current-authority checked, replay safe, and
  independent of host confirmation UI;
- MCP Apps are progressive and credential free;
- Tasks exist only if their activation gate was met;
- obsolete engines, parsers, bridges, and proof scaffolding are deleted;
- each public package’s exact packed bytes pass production consumers and protected evidence;
- current documentation truthfully describes the shipped system;
- the worktree is clean and the ledger points to every proof.

Start now: read the required sources completely, create `internal/VNEXT-TASKS.md`, validate that it covers
every RFC phase and acceptance criterion without inventing extra products, then execute the first unblocked
task.
