# Plan: functions and agents, from the skeleton to the packages

Status: built and in verification (2026-10-07); learnings in the README of this folder · Date: 2026-10-06 · Owner: Claude (Opus builds, Codex reviews and operates)

Source of the design: the walking skeleton in `bc-skeleton/labs/skeleton`
(commit `9a93cc7f`). Its `PLAN.md` holds the design history, its `STRESS.md`
every finding (R1–R27, the A–X hypotheses) with its fix and test. This file
does not repeat them; it points to them by ID.

## 1. Goal

Two packages that let an app built on Convex and Better Convex say once who may
do what, to which rows, and through which door (web, MCP host, in-app agent),
and that make every other path a test failure:

- `@lupinum/better-convex-functions` (new): operations, policy, row rules,
  internal operations, `can()`, the no-bypass check.
- `@lupinum/better-convex-agents` (rename of `@lupinum/better-convex-mcp`):
  tools derived from operations, approvals, agent limits, activity, the MCP door.

Order: **first the library reaches its best state in the skeleton (phase A),
then it moves.** Moving code that still changes doubles the work.

### Non-goals

- The in-app agent runtime (`lib/runs.ts`, `lib/agents.ts`) does not move in
  this plan. It stays in the skeleton until the spike in phase A4 decides
  between our runtime and Convex's agent and workflow components.
- No release, npm setup or consumer upgrade in this plan (section 8 lists them
  for later).
- No new features. A new option needs a failing test from a slice that needs it.

## 2. Decisions already made

| ID  | Decision                                                                     | Why                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Package names `-functions` and `-agents`                                     | `defineFunctions` is the first import; tools and approvals serve MCP hosts and in-app agents, so `-mcp` is too narrow                                                            |
| P2  | `-mcp` is renamed, not kept beside `-agents`                                 | Still a release candidate; one package per concept                                                                                                                               |
| P3  | `defineTools` replaces `defineMcpTool` / `registerMcpTool`                   | Two ways to define a tool are two sources of truth. Direct cutover; ginko-cms is the one consumer (`packages/convex/src/mcpHandler.ts`) and uses `handleMcpRequest`, which stays |
| P4  | The core depends only on `convex`                                            | It is Convex code, usable from any frontend; it does not go into the Nuxt package                                                                                                |
| P5  | The runtime does not move yet                                                | See non-goals                                                                                                                                                                    |
| P6  | Threat model: protects against app mistakes and agents, not hostile app code | `STRESS.md` "Threat model"; the static no-bypass check is the guarantee, runtime checks are the second line                                                                      |

## 3. Decision this plan needs: the toolkit rule

`AGENTS.md` says: "A toolkit, not a framework", no registries, and "wait until
a pattern appears in three real applications before you promote it to a
library helper". `defineFunctions` wraps every function and holds the rule map,
so it is closer to a framework than anything in the repository today.

Proposal (record as a `DECISIONS.md` entry in phase B):

- The Nuxt and Vue packages stay a toolkit, unchanged.
- `-functions` is an **opt-in layer**: an app that does not install it is not
  affected, and an app that does can still write a plain Convex function behind
  `trusted(reason, fn)`.
- The three-applications rule is met by the three slices in phase A3 (agency,
  content, marketplace), each built from a real app's feature. If a slice has
  to fight the layer, the layer changes before it moves.
- `AGENTS.md` gains one paragraph that describes the two packages and this scope.

## 4. Definition of done (whole plan)

Each line is a claim with the check that proves it.

| #   | Claim                                                                                                            | Check                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| D1  | The skeleton runs on the packages with its own `lib/` deleted                                                    | `labs/skeleton/lib/` contains only the runtime (P5); `pnpm verify` green there                           |
| D2  | Every security invariant (section 6) has a test in the package that owns it, and each test fails without its fix | Invariant table filled in; mutation check recorded for each                                              |
| D3  | The type experience holds: one error at the cause, with a suggestion                                             | Type tests (E1, X1, E4, W5, E13, E7) run inside `-functions` against a fixture app                       |
| D4  | Three app shapes work on the packages                                                                            | Slices agency, content, marketplace green (A3), re-run against the packages (F)                          |
| D5  | Real hosts and real models still work                                                                            | Now: `pnpm test:live` and the host checklist in `test/TESTING.md`. History: the retired skeleton harness |
| D6  | Cost is known per call                                                                                           | A budget test per operation kind (reads and writes per call) in `-functions`                             |
| D7  | A developer builds a feature from the docs alone                                                                 | Docs-only slice (F2) built without reading package source; friction list empty or fixed                  |
| D8  | Reviews have converged                                                                                           | Last Codex review of the packages: no P1, no new class of finding                                        |
| D9  | Repository checks pass                                                                                           | `pnpm verify` in better-convex (lint, types, tests, publint, attw, packed smoke)                         |

## 5. Phases

Each phase ends with its checklist ticked, a commit (skeleton) or a green PR
(better-convex), and one Codex review in the background while Opus reads the
same diff. A phase does not start before the previous one is checked.

### Phase A: best state in the skeleton

Everything still changes cheaply here. The phase ends with an API that we
freeze for the port.

**A1. API surface review.** List every export of `lib/` (name, kind, who needs
it). For each: keep, rename, merge or delete. Questions per export:

- Does an app need it, or only the library? Internal → not exported.
- Is the name what a developer would search for? (Check against the docs words.)
- Can a wrong call compile? If yes, can the types prevent it?
- Is there a second way to do the same thing? Delete one.
- Is every option asked for by a test or a slice? If not, delete it.
- Error codes: one exported union; every code is thrown somewhere and tested.

Done when:

- [x] Export table written into the skeleton `PLAN.md` with a verdict per export
- [ ] Changes made, `pnpm verify` green
- [ ] Codex review of the surface (focus: footguns, duplicates, names)

**A2. Close the open items.**

- [ ] J4: "Session ended" message seen live in the browser (Codex ops, screenshot)
- [x] G11 rule written in the tools docs comment: change tools additively; a breaking change gets a new tool name
- [ ] Open decision "logout disconnects agents" (needs Matthias, section 7)
- [x] W6 cost: measure reads and writes per call for query, mutation, tool call, approval; write the numbers into `PLAN.md`; turn them into budget assertions (D6)
- [ ] W6 re-run tradeoff decided (needs Matthias, section 7)
- [x] S14 test: revoking a connection cancels its open requests and its tools fail (no test exists today)
- [x] Walk section 6 once more: every invariant has a test that exists, by name
- [ ] B11 stays open with its next step; not a blocker (it is Better Auth rate limiting, not this layer)

**A3. Three slices (W7 in the skeleton `PLAN.md`).** One per app shape, each
in `labs/slices/<name>/` on its own dev deployment, using only `lib/`.

| Slice       | Shape                       | Real source                      | Forces                                                           |
| ----------- | --------------------------- | -------------------------------- | ---------------------------------------------------------------- |
| Agency      | agency → clients → projects | website-checker3 `get_fix_brief` | `tenant(field, { parent })`, `roleOf` two levels, client scoping |
| Content     | public pages + editors      | ginko-cms page read and edit     | visitor actor, `publicRead`, editor roles                        |
| Marketplace | two parties share one row   | small new example (orders)       | `custom` / `anyOf` rules, approver rule                          |

Done when, per slice:

- [ ] Web and MCP work end to end on its dev deployment
- [ ] A leak test: a second tenant's canary row is never returned or changed by any operation or tool (extends the R-series tests)
- [ ] Lines per operation counted (target: an operation is not longer than the plain Convex function it replaces, plus its rule)
- [ ] Every new `lib/` option names the slice that needed it
- [ ] Friction list written (what was hard, what needed source reading)

**A4. Runtime spike.** Build the tidy-up agent once on `@convex-dev/agent`
(and the workflow component if needed) behind the same `defineTools`.

- [ ] Same scenarios pass as `lib/test/agent/runs.test.ts` (or each gap listed)
- [ ] Compare: lines, failure handling (stall, retry, budget), cost per run
- [ ] Verdict written: keep ours, adopt theirs, or adapter. Only the tools and approvals contract must hold either way

**A5. Fourth review and freeze.**

- [ ] Codex review of all of `lib/` at effort high, focus: invariants of section 6
- [ ] No P1; every P2 fixed or recorded with a reason
- [ ] Short verdict (W8) in the skeleton `PLAN.md`: what held, what changed, what moves
- [ ] API frozen: from here, a change to the surface needs a reason in this file

### Phase B: `@lupinum/better-convex-functions` (PR 1)

Branch from `origin/main`. Contents: `functions.ts`, `rules.ts`, `policy.ts`,
`values.ts`, `actor.ts`, `guard.ts`, and the parts of `schema.ts` the core needs.

Steps:

1. `packages/functions` with the same layout and build as `packages/vue`
   (`build.config.ts`, `exports`, `agent-docs`). Subpaths: `.` and `./test`.
2. Move the code. No behavior change in this PR; any fix found goes to the
   skeleton first, then is moved.
3. Move the tests: `rules.test.ts`, `values.test.ts`, `no-bypass.test.ts`,
   `policy.test.ts` (to vitest), the type tests with a small fixture app under
   `packages/functions/test/app` instead of the skeleton's `convex/`.
4. Add the budget tests from A2 (D6).
5. Changesets: `-functions` as its own package (not in the Nuxt/Vue `fixed` group).
6. `DECISIONS.md` entry for section 3; `AGENTS.md` repository scope updated.

Done when:

- [ ] `pnpm verify` green in better-convex (rush: `pnpm lint`, `pnpm typecheck` and `vitest --project=functions` green; full verify in the verification round)
- [x] Test count in the package ≥ the moved tests (list any test that was dropped and why)
- [ ] Mutation check: for each invariant this package owns (section 6), remove the guard, see the test fail, restore
- [x] `publint` and `attw` clean; the packed smoke test imports `.` and `./test` (run by hand on the tarball; `check-packed.mjs` now packs the package too)
- [x] The package imports nothing but `convex` (`test/package.test.ts` reads `package.json`; the `functions-package-convex-only` rule in `scripts/check-boundaries.mjs` checks every source import, type-only included)
- [ ] Codex review: no P1

Rush notes (2026-10-06, skeleton commit `3b82326b`):

- Moved: `rules.test.ts` (fixture in `test/rules/`), `values.test.ts`,
  `no-bypass.test.ts`, `policy.test.ts` (now vitest), the type tests E1, X1,
  E4, W5, E13 against `test/app`, and the three core budgets (`cost.test.ts`:
  page, single-row mutation, nested-tenant write) with the skeleton's numbers.
- Stay for phase C: the budgets "a tool call with a request_id" and
  "approving a request"; the `testAuth().mcpAuth` fake, `mcpClient` and
  `refs` from `lib/testing.ts` (they fake the MCP door, so `-functions/test`
  would need the Nuxt package's principal type).
- Stays in the skeleton: type test E7 (`defineAgent` is the runtime, P5) and
  `tests/no-bypass.test.ts` (the skeleton app's own check).
- `libraryTables` stays one object in `-functions` (D31): the row rules close
  every library table, and the actor lookup reads grant, run and approval rows.
  Phase C imports it and the internals it needs (`KIT`, `LibraryDataModel`,
  `Operation`, `ToolSpec`, `OPERATION`, `guarded`, actor and value helpers);
  `-functions` has no entry for them yet, so phase C adds one.
- Lint-only edits to moved code: decimal hash seeds, upper-case escapes,
  `[\w-]` in `toolNamePattern`, `LibraryDataModel` without a runtime
  `defineSchema` call. No behavior change.

### Phase C: `@lupinum/better-convex-agents` (PR 2)

Steps:

1. `git mv packages/mcp packages/agents`; rename the package; keep the
   transport, `handleMcpRequest` and the access verifier.
2. Move `tools.ts`, approvals, limits, activity, housekeeping and their tables.
   The MCP door from `lib/mcp.ts` becomes `@lupinum/better-convex-agents/mcp`.
3. Remove `defineMcpTool`, `registerMcpTool`, `runMcpTool`, and their tests and docs (P3).
4. Move the tests: `door.test.ts`, `shapes.test.ts`, `approvals.test.ts`, and
   the agent harness parts that test tools without the runtime.
5. Update the existing MCP integration tests in `test/mcp` to the new name and API.
6. `starters/mcp-oauth-agent`: replace with the skeleton's door, or delete it if
   phase E's starter covers it.
7. Migration note in `MIGRATING.md`: `-mcp` → `-agents`, `defineMcpTool` → `defineTools`.

Done when:

- [ ] `pnpm verify` green
- [ ] Mutation checks for the invariants this package owns
- [ ] No reference to `better-convex-mcp` left in the repository except `CHANGELOG.md` and `MIGRATING.md`
- [ ] Codex review: no P1

### Phase D: Nuxt glue (PR 3)

The skeleton's `lib/mcp.ts` maps the Better Auth MCP principal to an actor by
hand. Move that mapping next to `BetterConvexMcpPrincipal` so an app writes one call.

Done when:

- [ ] The Better Auth integration tests run the door end to end against a real local backend (no mocks of auth)
- [ ] Logout and revoke behave as decided in A2 (test)
- [ ] `pnpm verify` green; Codex review: no P1

### Phase E: docs and starter (PR 4)

Opus writes all prose. Pages: start here (one operation, one rule, one tool),
row rules, policy and roles, internal operations, tools and approvals, MCP door,
limits, testing your app (no-bypass, leak test), the threat model, cost.

Done when:

- [ ] Every code sample type-checks (the repository's existing sample check)
- [ ] Every error code has a docs entry that says what to do
- [ ] `agent-docs` for both packages
- [ ] The starter app builds and its tests pass in CI

### Phase F: proof on the packages (PR 5, in bc-skeleton)

F1. Cutover:

- [ ] Skeleton imports the packed packages (`pnpm pack`, not workspace links)
- [ ] `lib/` holds only the runtime; `pnpm verify` green; all three slices green
- [ ] History, replaced: this deploy (`little-goldfinch-420`) and the skeleton's live scripts are retired. The cloud smoke (`pnpm test:live`) and the host checklist in `test/TESTING.md` do this now (D5)

F2. Docs-only slice: website-checker's `trigger_site_check`, built by a fresh
agent session that may read the docs and the starter but not the package source.

- [ ] Works end to end
- [ ] Friction list; each item fixed in the docs or the API, or recorded

F3. Final review of both packages (D8).

## 6. Security invariants

The list that must hold in every phase. The "owner" column is the package
whose tests guard the invariant. Mutants: `test/mutants/mutants.ts`, filtered
by `guards`. Each row there names the tests that must fail when its guard is
broken, and `pnpm test:mutants` fails when an invariant below has no row.
Which lane owns which invariant: `testing-strategy.md` A2.

| #   | Invariant                                                                                                                                                                                  | Owner                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| S1  | No public, internal or HTTP function reaches the database outside `defineFunctions`, except behind `trusted(reason)`                                                                       | functions                        |
| S2  | Every table has a rule; a new table without one is a type error                                                                                                                            | functions                        |
| S3  | A query or write never returns or changes a row outside the actor's rules (including through `withIndex`, `paginate`, search, `db.get` of a foreign ID)                                    | functions                        |
| S4  | Unknown query methods fail closed                                                                                                                                                          | functions                        |
| S5  | A role not in the policy grants nothing (`toString`, `__proto__`, …)                                                                                                                       | functions                        |
| S6  | A visitor reaches only actions listed in `public`                                                                                                                                          | functions                        |
| S7  | A raw internal function called from an operation makes the whole call fail; an internal action fails loudly                                                                                | functions                        |
| S8  | Cross-tenant moves need `crossTenant: true` and a role in both tenants                                                                                                                     | functions                        |
| S9  | An agent sees and calls only tools its grant scopes allow                                                                                                                                  | agents                           |
| S10 | An action that needs approval runs only while its approval is `executing`, set inside `approve`                                                                                            | agents                           |
| S11 | An approval for data that changed since the request is refused (STALE)                                                                                                                     | agents                           |
| S12 | Limits hold: writes per minute, open requests, IDs per call, body size (64 KiB)                                                                                                            | agents (IDs per call: functions) |
| S13 | Text from rows shown to a person or host is inert (no live markdown or HTML)                                                                                                               | agents                           |
| S14 | Revoking a connection cancels its open requests and stops its tools                                                                                                                        | agents                           |
| S15 | Every agent write of a call with a tenant is in that tenant's activity feed (tenantless and `crossTenant` calls only in the person's own feed); non-members cannot read it                 | agents                           |
| S16 | A retried request with the same `request_id` runs once                                                                                                                                     | agents                           |
| S17 | A state condition in a row rule (`allOf`) holds for every operation, including one without its own check                                                                                   | functions                        |
| S18 | Only the requester's person, or an approver role in the call's tenant, or (with `sharedRows`) in a tenant that every input row the agent may change belongs to, sees and decides a request | agents                           |

Cost budgets (D6): `packages/functions/test/cost.test.ts` and
`packages/agents/test/door/cost.test.ts`, with `countDocuments` from
`@lupinum/better-convex-functions/test`. The agents counts include Better
Auth's live-grant check.

Rule for every fixed finding: one regression test that fails without the fix,
and one mutant row whose `kills` names that test. Add a row here if it is a
new kind of invariant.

## 7. Decisions (defaults taken 2026-10-06; Matthias may still change them)

| Question                                                                                                               | Taken (default)                                              | Needed by      |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------- |
| Logging out of the web app also disconnects agents (measured today). Keep?                                             | Keep: logout ends everything; the person reconnects the host | A2             |
| W6: check the session only in writes and trust the token in reads (a revoked session stays readable ≤ 15 min)?         | No: check in reads too; accept the cost                      | A2             |
| Toolkit rule (section 3): accept `-functions` as an opt-in layer?                                                      | Yes, as written                                              | B              |
| Version line for the new packages: `1.0.0-rc` with the others, or `0.x` until the slices and docs-only slice are done? | `0.x`, then `1.0.0` together with a stable agents API        | before release |

## 8. Later (not in this plan)

- npm: trusted publishing for `-functions` and `-agents`, `npm deprecate` on `-mcp` (owner's account).
- Release approval in the `npm` environment (owner).
- ginko-cms: one import change from `-mcp` to `-agents` (own PR in that repo).
- F8: upgrade the skeleton when the multi-origin change (#244) is released.
- The runtime package, after the A4 verdict.

## 9. Tripwires

Stop and cut back when one of these appears (from the skeleton `PLAN.md`):

- An option that no failing test or slice asked for.
- A second slice of the same app shape.
- This plan grows faster than the code.
- A claim marked done without the check from its checklist.
- A fix made in a package that was not first made and tested in the skeleton (phases B–E move code; they do not change it).

## 10. Rough time

| Phase                  | Time      |
| ---------------------- | --------- |
| A1 API review          | ½ day     |
| A2 open items and cost | ½ day     |
| A3 three slices        | 2 days    |
| A4 runtime spike       | 1 day     |
| A5 review and freeze   | ½ day     |
| B functions package    | 1 day     |
| C agents package       | 1 day     |
| D Nuxt glue + E docs   | 1–1½ days |
| F proof                | ½–1 day   |

## 11. Verification rounds: fixes required before release

Raised by the slices (2026-10-07). Each fix gets one regression test in the
slice that found it, and fails without the fix (mutation check).

| #   | Item                                                                                                                   | Rating | Fix                                                                                                                                                               | Done when                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | A state condition ("only drafts can be edited") lives only in the handler; a new operation can forget it and fail open | 6/10   | `allOf(...)` rule preset in `-functions`, so the condition sits in the row rule; content slice moves its guard into the rule                                      | Content slice test: an operation without the handler check still cannot edit a published page; new invariant row S17 in section 6. **Done**: 60c8b0c3, skeleton e96ffcca                                                                |
| V2  | Prompt injection through tool results (crawled text)                                                                   | 5/10   | Docs only: threat-model page explains that escaping does not stop injection; the limits are scopes, `approve` for anything destructive, rate limits, activity log | Threat-model page has the section; tools docs state "destructive actions need approve" **Done**: already in 84b109b6 (threat-model "Prompt injection"; tools docs "Use `approve` for every action that destroys…"), checked in round 1. |
| V3  | Approvers outside the request's tenant (seller approves a buyer agent's request)                                       | 4/10   | `approvers` sees the tenants of the rows the request touches; fails closed as today                                                                               | Marketplace `test.fails` becomes a passing test; a non-party still cannot decide. **Done**: f7683c02, skeleton 1eb50033                                                                                                                 |
| V4  | A parent tenant cannot list pending requests below it                                                                  | 3/10   | After 1.0; documented as a limit                                                                                                                                  | Limit listed in the approvals docs. **Done**: f7683c02                                                                                                                                                                                  |

### Found during the rush (2026-10-07)

| #   | Item                                                                                                                                                                     | Fix                                                                        | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V5  | `export const fns = defineFunctions(...)` fails declaration emit (TS4023, `KIT` cannot be named); apps with `declaration: true` or project references break              | Export the type behind `KIT` (or drop the symbol key)                      | A fixture app with `declaration: true` type-checks. **Done**: a434c485, skeleton fc3d4457                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| V6  | `-agents` peer range `^0.0.0` matches only 0.0.0; every 0.x minor of `-functions` breaks it                                                                              | Release both in one fixed Changesets group, or a peer range that spans 0.x | Changesets dry run shows matching ranges **Done**: db9478bb (fixed group, exact peer; dry run: both 0.1.0-rc.0, after pre exit a functions-only minor moves both to 0.2.0, packed peer `0.2.0`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V7  | `./internal` of both packages became the runtime's contract                                                                                                              | Name what is in it, mark it unstable in docs, keep it minimal              | Export list reviewed; docs say "no semver". **Done** for `-functions`: af68501a **Done** for `-agents`: 30322aab (every export is used by the skeleton runtime).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V8  | The browser imports `can` from the functions root, which also carries server code                                                                                        | A client-safe entry (`./policy`) or a measured bundle                      | Bundle check: no `convex/server` in the client build. **Done**: 51ee41d1, skeleton 0ba08d1d                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| V9  | Two sources for the MCP resource (`auth.mcp.resource()` and `auth.mcpAuthorization(ctx).resource`)                                                                       | Keep one                                                                   | One call site in docs, starter and skeleton **Done**: 9a5a2fa5 (`auth.mcp` removed; clients default to the profile resource), skeleton cf39348c.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V10 | Two test fakes: `testAuth()` (functions/test) and `testMcpAuth()` (agents/test); revoke lives in the other package                                                       | One fake, owned by `-agents/test`                                          | A slice uses one call **Done**: bd99b7a9 (`testAuth()` in `-agents/test` serves `defineFunctions` and `createMcpServer`), skeleton cf39348c.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| V11 | Tests copied, not moved: core-shape tests (K1–K3, K6, E13, E10) sit in `-agents`                                                                                         | Test-surgery pass across both packages and the skeleton                    | Before/after coverage diff; no duplicates **Done**: 77370aad (K1–K3, K6, E10 to functions `test/shapes.test.ts`, E13 and K1's policy half to `policy.test.ts`, E15 to `rules.test.ts`), 63d744e3 (S12 write limit moved in from the skeleton), 47bf8215 (K3 plant now reaches the parent check), skeleton 99b7407a. Coverage lines 91.44→91.59 %, branches 83.14→83.22 %; one branch accepted as lost (signed-out fallback of the `testAuth` fake).                                                                                                                                                                                                                  |
| V12 | Not run yet: `test:integration` (real backend, incl. logout disconnects agents), `test:packed`, `test:starters`, full `pnpm verify`                                      | Run them; fix what fails                                                   | All green **Blocked on one item**: verify, test:packed, test:starters, docs build and agent-docs are green after f979e43f (audits), ec79281a (fixture copies the packages), 9573046b (tool list, no `$schema`). test:integration is 30/31: approving runs the tool in a nested `ctx.runMutation`, and the pinned backend (precompiled-2026-07-06) leaves `CONVEX_SITE_URL` unset there, so `requireMcpPrincipal` throws. Backend precompiled-2026-09-28 sets it (mcp-auth 4/4), but bumping the pin needs the Linux archive download for its binary SHA-256 and a review of two auth-concurrency drift checks (admission source review, `URL.canParse` now present). |
| V13 | Live: deploy skeleton on packed packages; `e2e:mcp`, `e2e:negative` (body-size expectation changed), phase-3 checks, GPT-6 Luna, Claude Code host; budgets compared live | Codex ops                                                                  | Evidence file per check. History: the skeleton harness and its deployment are retired; `pnpm test:live` replaces them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| V14 | Mutation checks for S1–S18 (S18 is the V3 fix), and V5                                                                                                                   | Remove guard, see test fail, restore                                       | Result column in section 6 **Done**: every guard broken once and reverted; 9 guards no test caught got tests (c83bf5ad, 17709ef9). V5: a symbol-keyed property on the `defineFunctions` result fails `types` "the app type-checks and emits declarations".                                                                                                                                                                                                                                                                                                                                                                                                           |
| V15 | ginko-cms must also install `-functions` and change `runMcpTool` → `tools.runTool`                                                                                       | Note in MIGRATING.md now; ginko PR later (section 8)                       | MIGRATING.md has it **Done**: 1d699612.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| V16 | Stale: skeleton README, starter lockfile, docs `1.mcp.md` "Writes and human approval"                                                                                    | Update                                                                     | No reference to removed API **Done**: 097edccb, skeleton 6e3708e6. The starter lockfile cannot be regenerated before `-functions`/`-agents` are on npm; the starter README says so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Round 1 review

Each fix has one regression test that failed with the fix reverted. Skeleton: 8dcdec2d (repack; marketplace `orders.cancel` opts into `sharedRows`).

| Finding                                                           | Verdict                                                                                                                                                                                                                | Commit             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| P1 Cross-tenant approvers via rows a request only reads           | Real. Fixed: other tenants decide only with `approvers: { roles, sharedRows: true }`, and only for input rows the agent may change (a table with a required tenant rule belongs to that tenant alone). S18 row updated | c6123be9           |
| P1 MCP approval fails after the 10-minute access token expired    | Real. Fixed: approved work calls `requireMcpPrincipal(..., { allowExpiredToken: true })` (live grant, session, consent still checked); `testAuth` now refuses expired tokens                                           | d4124c68           |
| P2 Request on a row the agent cannot read reaches a foreign queue | Real. Fixed: every input row is read through the checked db before the request is stored; hidden → `NOT_FOUND`, nothing stored                                                                                         | c6123be9           |
| P2 Patch moves a nested tenant under a foreign parent             | Real. Fixed: a changed parent is checked like the parent of a new tenant                                                                                                                                               | 89ee0585           |
| P2 `ctx.storage` outside the row rules                            | Real, docs fix. A wrapper cannot close it: a caller can attach someone else's storage ID to their own row. Threat model and row-rules docs now say files are capabilities                                              | 726911d3           |
| P3 cyrb53 fingerprint collisions                                  | Plausible. Fixed: rows fingerprinted with SHA-256 (cyrb53 kept for call keys). No regression test: a cyrb53 collision costs ~2^32 work                                                                                 | ff43b322           |
| P3 Threat model: every agent write in its tenant's feed           | Real, docs fix (tenantless and `crossTenant` calls only in the person's feed); S15 wording                                                                                                                             | 726911d3           |
| P2 `tenant()` on a non-tenant field hides every row               | Real. Fixed: rule fields must hold an ID (type error), an ID of a non-tenant table throws a message naming the field (outside `anyOf`), inserts no longer say "No x with this ID"                                      | ec998770           |
| P2 `destructiveHint: false` for writes without `approve`          | Real. Fixed: every write is `destructiveHint: true`                                                                                                                                                                    | b3214b74           |
| P2 Job result stored unchecked                                    | Real. Fixed: result typed `Value \| void`, stored through `storable`                                                                                                                                                   | 0ea910e2, bbf1b363 |
| P2 No typed way for a cron or job to start an internal operation  | Real. Fixed: jobs get the wrapped `ctx.run*`/`scheduler` as the system; jobs accept plain (cron) or system-wrapped args, so a job still continues in another job                                                       | 0ea910e2, 4f6fca89 |
| P3 `createdBy` untyped, misleading FORBIDDEN                      | Real. Fixed: `createdBy` is `ActionOf<P>` (also checked at load); refusal names the rule                                                                                                                               | c9f9768f           |
| P3 Tool refs are a query/mutation union                           | Real, docs fix (testing page uses `anyApi` and says why); typing per tool would need a generic `defineTools`, which is non-generic on purpose                                                                          | e6f63407           |
| P3 Retry after decline without `request_id` asks again            | Real. Fixed: the same call gets `APPROVAL_DECLINED` until the declined request would have expired                                                                                                                      | bf30d919           |
| P2 First release of the new names cannot publish via OIDC         | Plausible (not reproducible without a release). Fixed in CI: `pack` fails before approval when a name is not on npm; D34 records the owner's one-time publish and `npm trust` setup                                    | 8b4e9378           |
| P3 `./test` loads the MCP SDK                                     | Real. Fixed: only `listMcpCatalog` loads it, lazily; the packed check fails when an entry other than `./mcp` needs the SDK                                                                                             | 07309451           |
| P3 Docs name MCP SDK 2.1.0                                        | Real. Fixed (upgrade guide, MIGRATING rc.1 list, release-compatibility rows for functions and agents, agents README)                                                                                                   | c8b0fe81, 07309451 |
| P3 Agents CHANGELOG keeps the -mcp title                          | Real. Fixed: own title, pointer to the root CHANGELOG for the -mcp history                                                                                                                                             | b115ecea           |
| P3 Starter pins 0.0.0, README workaround fails                    | Real, docs fix: pins are placeholders; D34 names the post-release pin and lockfile chore                                                                                                                               | 46f4029b           |
