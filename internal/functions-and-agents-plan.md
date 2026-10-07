# Plan: functions and agents, from the skeleton to the packages

Status: implementation rush running (workflow), verification rounds after · Date: 2026-10-06 · Owner: Claude (Opus builds, Codex reviews and operates)

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

| #   | Claim                                                                                                            | Check                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| D1  | The skeleton runs on the packages with its own `lib/` deleted                                                    | `labs/skeleton/lib/` contains only the runtime (P5); `pnpm verify` green there                             |
| D2  | Every security invariant (section 6) has a test in the package that owns it, and each test fails without its fix | Invariant table filled in; mutation check recorded for each                                                |
| D3  | The type experience holds: one error at the cause, with a suggestion                                             | Type tests (E1, X1, E4, W5, E13, E7) run inside `-functions` against a fixture app                         |
| D4  | Three app shapes work on the packages                                                                            | Slices agency, content, marketplace green (A3), re-run against the packages (F)                            |
| D5  | Real hosts and real models still work                                                                            | Codex live harness: `e2e:mcp`, `e2e:negative`, phase-3 checks; one GPT-6 Luna run; Claude Code as MCP host |
| D6  | Cost is known per call                                                                                           | A budget test per operation kind (reads and writes per call) in `-functions`                               |
| D7  | A developer builds a feature from the docs alone                                                                 | Docs-only slice (F2) built without reading package source; friction list empty or fixed                    |
| D8  | Reviews have converged                                                                                           | Last Codex review of the packages: no P1, no new class of finding                                          |
| D9  | Repository checks pass                                                                                           | `pnpm verify` in better-convex (lint, types, tests, publint, attw, packed smoke)                           |

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
- [ ] Deployed to `little-goldfinch-420`; Codex reruns `e2e:mcp`, `e2e:negative`, the phase-3 checks; one GPT-6 Luna run; Claude Code as host (D5)

F2. Docs-only slice: website-checker's `trigger_site_check`, built by a fresh
agent session that may read the docs and the starter but not the package source.

- [ ] Works end to end
- [ ] Friction list; each item fixed in the docs or the API, or recorded

F3. Final review of both packages (D8).

## 6. Security invariants

The list that must hold in every phase. Each row names its tests by file and
test name (skeleton, after A2, commit on `spike/walking-skeleton`); the
"owner" column is the package that keeps the test after the move. Phase B and C
add the mutation-check result. Files: `rules` = `lib/test/rules.test.ts`,
`values` = `lib/test/values.test.ts`, `door`/`shapes`/`cost` =
`lib/test/door/*.test.ts`, `approvals`/`runs` = `lib/test/agent/*.test.ts`,
`types`/`app` = `tests/*.test.ts`. Every fixed STRESS finding is mapped to its
test in the skeleton `STRESS.md` ("Status by finding").

| #   | Invariant                                                                                                                                               | Tests (skeleton)                                                                                                                                                                                                                                                                                                                                                                                                                               | Owner                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| S1  | No public, internal or HTTP function reaches the database outside `defineFunctions`, except behind `trusted(reason)`                                    | `lib/test/no-bypass`: "raw functions are found in any module, router routes included"; `tests/no-bypass`: "every public function goes through the library"                                                                                                                                                                                                                                                                                     | functions                        |
| S2  | Every table has a rule; a new table without one is a type error                                                                                         | `types`: "a table without a rule is a type error that names it" (X1)                                                                                                                                                                                                                                                                                                                                                                           | functions                        |
| S3  | A query or write never returns or changes a row outside the actor's rules (including through `withIndex`, `paginate`, search, `db.get` of a foreign ID) | `rules`: "a query that returns a foreign row fails instead of leaking it", "a get of a foreign row returns null", "writes check the row tenant and the role there", "owner rows of other people fail the query", "a table-qualified get only finds rows of that table", "reading a query with %s checks the rows" (take, first, paginate, search, for await, next), "unique() checks rows before it reports duplicates"; slice leak tests (A3) | functions                        |
| S4  | Unknown query methods fail closed                                                                                                                       | `rules`: "a query method the library does not know fails instead of passing rows through", "system tables are closed to operations"                                                                                                                                                                                                                                                                                                            | functions                        |
| S5  | A role not in the policy grants nothing (`toString`, `__proto__`, …)                                                                                    | `shapes`: "K1: the unknown role %j is denied"                                                                                                                                                                                                                                                                                                                                                                                                  | functions                        |
| S6  | A visitor reaches only actions listed in `public`                                                                                                       | `types`: "a public action must handle visitors before it reads ctx.actor.user" (W5); `rules`: "a visitor reads published pages; drafts and edits need a member"                                                                                                                                                                                                                                                                                | functions                        |
| S7  | A raw internal function called from an operation makes the whole call fail; an internal action fails loudly                                             | `rules`: "operations cannot call or schedule the app's raw functions", "a raw internal function without validators cannot hand rows to an operation", "a raw function reached from an operation keeps none of its writes, even if the handler catches", "an internal action that reached a raw function fails"; `approvals`: "a summary that reaches a raw function makes the request fail and keeps nothing"                                  | functions                        |
| S8  | Cross-tenant moves need `crossTenant: true` and a role in both tenants                                                                                  | `shapes`: "K2: a move between a workspace and an organization needs crossTenant, and a role in both"                                                                                                                                                                                                                                                                                                                                           | functions                        |
| S9  | An agent sees and calls only tools its grant scopes allow                                                                                               | `door`: "a read-only grant lists only read tools", "a read-only grant cannot call a write tool by name"; `runs`: "the model is offered only the tools the grant scopes unlock"                                                                                                                                                                                                                                                                 | agents                           |
| S10 | An action that needs approval runs only while its approval is `executing`, set inside `approve`                                                         | `approvals`: "an internal operation refuses an approval that is not executing right now", "an internal operation that needs approval runs only under one", "approving an expired request is refused and changes nothing"                                                                                                                                                                                                                       | agents                           |
| S11 | An approval for data that changed since the request is refused (STALE)                                                                                  | `approvals`: "approving fails as STALE when the project changed after the request", "every row a request covers is checked for changes, up to a stated limit", "a request on a row of an anyOf table fails as STALE when that row changed", "a request naming rows as record keys fails as STALE when one changed"; `values`: "a fingerprint sees bytes and int64 fields"                                                                      | agents                           |
| S12 | Limits hold: writes per minute, open requests, IDs per call, body size                                                                                  | `runs`: "an agent may make 60 writes a minute, then waits", "a person may have 3 runs going per agent"; `approvals`: "an agent with 20 open requests is told to wait"; `rules`: "a call with more IDs than the limit is refused before the handler runs"; `door`: "a request body over 1 MiB is refused with 413 before any work"                                                                                                              | agents (IDs per call: functions) |
| S13 | Text from rows shown to a person or host is inert (no live markdown or HTML)                                                                            | `door`: "the approval text an MCP host shows carries no live markdown from row data"; `approvals`: "summaries are one plain line for people, and inert markdown for agents"; `values`: "oneLine(%j) is %j", "inert markdown shows links and HTML as text"                                                                                                                                                                                      | agents                           |
| S14 | Revoking a connection cancels its open requests and stops its tools                                                                                     | `door`: "revoking a connection cancels its open requests, and its tools then fail" (added in A2)                                                                                                                                                                                                                                                                                                                                               | agents                           |
| S15 | Every agent write is in the activity feed of its tenant; non-members cannot read it                                                                     | `door`: "agent writes appear in the tenant activity feed; non-members cannot read it"                                                                                                                                                                                                                                                                                                                                                          | agents                           |
| S16 | A retried request with the same `request_id` runs once                                                                                                  | `door`: "a numeric request_id still deduplicates"; `approvals`: "re-asking with the same request_id after expiry makes a new request; a retry then replays", "a retry after a decline is told it was declined", "the same call twice in one step makes one request"; `cost`: "a tool call with a request_id, and its retry"                                                                                                                    | agents                           |
| S17 | A state condition in a row rule (`allOf`) holds for every operation, including one without its own check                                                | `rules`: "every part of an allOf rule holds, even for an operation without its own check"; content slice: "an operation without the draft check still cannot edit a published page"                                                                                                                                                                                                                                                            | functions                        |
| S18 | Only the requester's person, or an approver role in the call's tenant or in a tenant every touched row names, sees and decides a request                | `approvals`: "an approver decides a request only when every row it touches is of the approver’s tenant"; marketplace slice: "the seller owner may decide a buyer agent cancelling an order; nobody outside either party may"                                                                                                                                                                                                                   | agents                           |

Cost budgets (D6, numbers in the skeleton `PLAN.md` "API freeze"): `cost`:
"a page of a paginated list query", "a single-row mutation under a tenant
rule", "a write in a nested tenant (client under an agency)", "a tool call with
a request_id, and its retry", "approving a request". Helper:
`countDocuments` in `lib/testing.ts` (the core's `./test`).

Rule for every new finding: one regression test that fails without the fix,
and a new row here if it is a new kind of invariant.

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

| #   | Item                                                                                                                   | Rating | Fix                                                                                                                                                               | Done when                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V1  | A state condition ("only drafts can be edited") lives only in the handler; a new operation can forget it and fail open | 6/10   | `allOf(...)` rule preset in `-functions`, so the condition sits in the row rule; content slice moves its guard into the rule                                      | Content slice test: an operation without the handler check still cannot edit a published page; new invariant row S17 in section 6. **Done**: 60c8b0c3, skeleton e96ffcca |
| V2  | Prompt injection through tool results (crawled text)                                                                   | 5/10   | Docs only: threat-model page explains that escaping does not stop injection; the limits are scopes, `approve` for anything destructive, rate limits, activity log | Threat-model page has the section; tools docs state "destructive actions need approve"                                                                                   |
| V3  | Approvers outside the request's tenant (seller approves a buyer agent's request)                                       | 4/10   | `approvers` sees the tenants of the rows the request touches; fails closed as today                                                                               | Marketplace `test.fails` becomes a passing test; a non-party still cannot decide. **Done**: f7683c02, skeleton 1eb50033                                                  |
| V4  | A parent tenant cannot list pending requests below it                                                                  | 3/10   | After 1.0; documented as a limit                                                                                                                                  | Limit listed in the approvals docs. **Done**: f7683c02                                                                                                                   |

### Found during the rush (2026-10-07)

| #   | Item                                                                                                                                                                     | Fix                                                                        | Done when                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| V5  | `export const fns = defineFunctions(...)` fails declaration emit (TS4023, `KIT` cannot be named); apps with `declaration: true` or project references break              | Export the type behind `KIT` (or drop the symbol key)                      | A fixture app with `declaration: true` type-checks. **Done**: a434c485, skeleton fc3d4457   |
| V6  | `-agents` peer range `^0.0.0` matches only 0.0.0; every 0.x minor of `-functions` breaks it                                                                              | Release both in one fixed Changesets group, or a peer range that spans 0.x | Changesets dry run shows matching ranges                                                    |
| V7  | `./internal` of both packages became the runtime's contract                                                                                                              | Name what is in it, mark it unstable in docs, keep it minimal              | Export list reviewed; docs say "no semver". **Done** for `-functions`: af68501a             |
| V8  | The browser imports `can` from the functions root, which also carries server code                                                                                        | A client-safe entry (`./policy`) or a measured bundle                      | Bundle check: no `convex/server` in the client build. **Done**: 51ee41d1, skeleton 0ba08d1d |
| V9  | Two sources for the MCP resource (`auth.mcp.resource()` and `auth.mcpAuthorization(ctx).resource`)                                                                       | Keep one                                                                   | One call site in docs, starter and skeleton                                                 |
| V10 | Two test fakes: `testAuth()` (functions/test) and `testMcpAuth()` (agents/test); revoke lives in the other package                                                       | One fake, owned by `-agents/test`                                          | A slice uses one call                                                                       |
| V11 | Tests copied, not moved: core-shape tests (K1–K3, K6, E13, E10) sit in `-agents`                                                                                         | Test-surgery pass across both packages and the skeleton                    | Before/after coverage diff; no duplicates                                                   |
| V12 | Not run yet: `test:integration` (real backend, incl. logout disconnects agents), `test:packed`, `test:starters`, full `pnpm verify`                                      | Run them; fix what fails                                                   | All green                                                                                   |
| V13 | Live: deploy skeleton on packed packages; `e2e:mcp`, `e2e:negative` (body-size expectation changed), phase-3 checks, GPT-6 Luna, Claude Code host; budgets compared live | Codex ops                                                                  | Evidence file per check                                                                     |
| V14 | Mutation checks for S1–S17                                                                                                                                               | Remove guard, see test fail, restore                                       | Result column in section 6                                                                  |
| V15 | ginko-cms must also install `-functions` and change `runMcpTool` → `tools.runTool`                                                                                       | Note in MIGRATING.md now; ginko PR later (section 8)                       | MIGRATING.md has it                                                                         |
| V16 | Stale: skeleton README, starter lockfile, docs `1.mcp.md` "Writes and human approval"                                                                                    | Update                                                                     | No reference to removed API                                                                 |
