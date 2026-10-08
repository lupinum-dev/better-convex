# Testing strategy: functions and agents

Design of 2026-10-07, on `feat/functions-and-agents` at `8945373c`, revised
after two reviews (test-surgery, design-apis). Inputs: three analyses
(maintainer, app builder, live), the files in this folder, the skeleton and the
docs-slice.

## Status

Built on `feat/functions-and-agents`, 2026-10-07. Items 1–12 of the
implementation plan are in the code. The cloud smoke ran green three times on
preview deployments of the Lupinum project `better-convex-live` (run by Codex
from a maintainer machine). Open: the preview deploy key in the protected
`live` GitHub environment, so `.github/workflows/live.yml` can run it.

Release gate, 2026-10-07: four Codex reviews of the finished branch found a
P1 in every round. One was a `publicRead` condition that returned a Promise;
the others were all ways for approved work to differ from what the person
saw. Matthias chose to replace the approval check: a person now approves a
plan (a fixed list), and the work may change only its rows. See
review-checklist.md, classes 4, 12 and 13.

Where it is:

- Mutants: `test/mutants/` (`pnpm test:mutants`, CI job `mutants`). Every
  invariant S1–S18 has a row; the runner fails when one has none.
- Cloud smoke: `test/live/` (`pnpm test:live`, vitest project `live`,
  `.github/workflows/live.yml`). Host checklist, Vercel check and release
  checklist: `test/TESTING.md`.
- Consumers: `test/fixtures/consumers/{agency,content,marketplace,sites}`, in
  `pnpm test:starters` and in the `mcp` project.
- `callTool`: `packages/agents/src/test.ts`; the shared dispatch is
  `grantedTools` and `toolCall` in `packages/agents/src/tools.ts`.

What changed from the design, and why:

- `toolCall` takes a fourth argument, `run`. An action's `ctx` and a
  convex-test instance both fit it, so the query-or-mutation choice exists once.
- A4 "Split" assumed that only `packages/agents/src` is bound by
  `check-boundaries`. That was wrong: the rule reads every file of a package.
  Now a file under `<package>/test/` may import another workspace package's
  public subpath without declaring it. A dev dependency would make a cycle.
- T4 uses the existing `projects` table of the rules fixture. Its custom rule
  allows every read, so only the tenant rule acts on reads.
- T5 has three scenarios, not four. "A `tools.functions` name without a tool"
  cannot be a type error now (see the T5 row). `assertToolsExported` catches it
  when the module loads.
- Type tests read files, so they apply a mutant to a copy of `src`
  (`activeMutant` and `applyMutant` in `test/mutants/plugin.ts`). S2 and the C8
  rows run this way.
- The approval page rows (`projects: ['integration']`) run the starter with
  `nuxt dev` on the local backend. The harness applies the row to its starter
  copy. A row in `packages/*/src` cannot run there: the integration lane uses
  the build. Each page row takes about 80 seconds, and a full
  `pnpm test:mutants` (117 rows) took about 13 minutes on a laptop, not 5–6. The
  CI job now installs Chromium and has 45 minutes.
- The legacy MCP era (open question 2: keep it) has a test in the `agents`
  project (`mcp/header-contract.test.ts`), so its mutant row is cheap. The
  `mcp-auth` integration test keeps its legacy call too.
- Cost budgets now count Better Auth's live-grant check: a tool call reads 9
  documents, not 3. The old numbers left out auth.
- The cloud smoke accepts only a preview deploy key (decision 1). The dev
  fallback with a purge overlay is not built. It installs the built packages
  as copies (`dist` and `package.json`), as the integration lane does, not
  the packed tarballs; `pnpm test:starters` checks the tarballs.
- `S14-token-expiry` is guarded only in the `convex` project. The door test
  uses a fake token verifier that does not check expiry.

### Three more checks, added after the build

The review rounds before this work found P1s by reading code. To find the next
ones with tests instead, three checks were added for the bug classes behind
most of them. Each found real bugs on its first run:

| Check                                                                                                                                                       | File                                                    | Bug classes | Found                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| Sequence fuzz: random agent calls, decisions, revokes, run ends and clock steps; after each step a database diff is checked against what someone may change | `packages/agents/test/approvals/sequence-fuzz.test.ts`  | 1, 4, 5, 11 | A `request_id` of a waiting request accepted for another call that runs at once                   |
| Callback snapshot: the exact keys each app callback gets (handlers, summaries, rules, `roleOf`, `user`, every actor kind)                                   | `packages/agents/test/callbacks/callbacks.test.ts`      | 2, 10       | Custom rules saw the approval's credentials; rules, `roleOf` and `user` got the mutation's writer |
| Bad return values at every decision point (`undefined`, `null`, `'ALLOW'`, `1`, `{}`, a promise, a throw)                                                   | same file, and `packages/functions/test/policy.test.ts` | 4           | A custom rule that returned a truthy non-boolean passed; an agent rule of `null` allowed          |

The cloud smoke found one more: Convex's edge turned the door's empty 413
into a 520 (platform-facts.md). Codex then reproduced it and measured the fix.

The sequence fuzz kills its mutants in only about 3–6 % of random cases. The
48 default cases are enough today; re-prove its rows after a generator change.
`BCN_AUTH_FUZZ_CASES=500` runs 2,000 cases in about 30 seconds.

This document decides two things:

- **A.** How we, the maintainers, test better-convex: lanes, what each lane
  protects, what we delete or move, the mutation check, and the release
  checklist.
- **B.** Which test primitives app builders get, and what stays a docs recipe.

The rule for every test below: it names the wrong behaviour it catches. A test
without one is not written. Expected values are literals; an either/or
assertion on a permission boundary is not allowed.

## Decisions in short

1. Keep the current lanes. Add a committed mutation check (`pnpm test:mutants`)
   that runs on every PR as one more parallel CI job, and add the three slices
   plus the docs site as packed consumers in `test:starters`.
2. Close the four surviving mutants now. Three guards of in-app agent steps and
   the `shown()` call in internal actions have no package test.
3. Concurrency (class 11) is not a test lane. Convex mutations are
   serializable, and the replay lookup and the approved work run inside one
   transaction. Flows that cross transactions get deterministic interleaving
   rows in convex-test; class 11 stays a review question.
4. Remove `testAuth`, `refs` and `mcpClient` from the public
   `@lupinum/better-convex-agents/test`. In the package's own tests, keep only
   a fake token verifier at the HTTP boundary; `requireMcpPrincipal` comes from
   the real Better Auth component, so the S14 tests check real revocation.
5. Mutants are applied at load time by a Vite transform, never written to the
   working tree. Each row names the vitest projects that hold its killing
   tests, so transport, auth and starter mutants are in the table too.
6. Do not port the skeleton's live scripts (about 4,550 lines). Replace them
   with one small cloud smoke lane (manual trigger, a fresh preview deployment
   per run if the plan allows) and a 10-minute manual host checklist.
7. App builders get two existing entries and one new function: the auth
   fixtures in `better-auth/test`, the guarantee helpers in `functions/test`,
   and `callTool` in `agents/test`. `callTool` resolves only on success and
   rejects with the original error, like `t.mutation`.
8. The shared tool dispatch lives in `tools.ts` (no MCP SDK). The door and
   `callTool` both call it, so `./test` still loads without the SDK.
9. `unguardedFunctions` takes the same lazy module map that `convexTest`
   takes and refuses a map that checks nothing. `grantMcp` gets no new option.
10. The starter and the docs page get three missing tests: a literal snapshot
    of the agent surface, an approvers table, and a leak table with one
    literal code per row and a positive control. Today the starter stays
    green when `approvers` is widened to `member` or `viewer`, or when the read
    scope unlocks `archive`.
11. Semver for `./test` entries covers names, signatures and error codes, not
    document counts or message texts.

---

## Part A: how maintainers test

### A1. Lanes

| Lane         | Command                                                           | When                                                                            | Wall time (measured or estimated)                   | What it protects                                                                                                            |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Fast         | `pnpm test` (10 vitest projects) + lint + tsc                     | every PR (CI `check`)                                                           | about 2.5 min; functions+agents alone 5.7 s         | S1–S18 logic in convex-test, cross-transaction interleavings, types (S2, S6, class 8), Nuxt/Vue/auth units, security suites |
| Packed       | `pnpm test:packed`                                                | every PR (CI `build`)                                                           | existing                                            | tarball contents, export maps, `./test` loads without the MCP SDK, no test credentials in tarballs                          |
| Real backend | `pnpm test:integration`                                           | every PR (CI)                                                                   | existing + about 15 s for the approval page journey | OAuth and MCP over real HTTP, revocation, approve on the real runtime, the starter approval page                            |
| Journeys     | `pnpm test:e2e --full`                                            | every PR (CI)                                                                   | existing                                            | Nuxt and auth journeys in the playground                                                                                    |
| Consumers    | `pnpm test:starters`                                              | every PR (CI)                                                                   | existing + about 1–2 min for four consumers         | packed install, d.ts and exports, type-checking of four real app shapes (nested tenants, `allOf`, `sharedRows`, docs site)  |
| Mutants      | `pnpm test:mutants`                                               | every PR, a parallel CI job in `ci.yml`, listed in the final `ci` job's `needs` | about 5–6 min serial, beside integration and e2e    | that each guard is checked by the test that claims to check it; tests that pass for the wrong reason                        |
| Cloud smoke  | `pnpm test:live` (`workflow_dispatch`)                            | once per release, on the Version packages PR head                               | about 5 min machine time                            | cloud runtime drift from the local pin, the Cloudflare edge (body limits), deploy-time validation of the packed packages    |
| Manual hosts | checklist in `test/TESTING.md`                                    | release, only when the MCP door, OAuth discovery or the proxy changed           | about 10 min of a maintainer                        | real hosts (Claude Code, ChatGPT, Claude.ai): `tools/list` caching, numeric `request_id`, Markdown rendering                |
| Coverage     | `pnpm vitest run --coverage --project=functions --project=agents` | on demand, when tests move or are cut                                           | about 10 s                                          | proof that a test move or cut kept line and branch coverage of `packages/*/src`. Not a gate.                                |

The mutants job has no path filter. Tests start to pass for the wrong reason
when the tests change (a dropped assertion, a changed fixture, an edited
starter test), and those PRs do not touch `packages/*/src`. A path-filtered
required check also shows as skipped, which complicates branch protection.
The job runs beside integration and e2e, so CI wall time barely changes.

The fast lane already runs `mcp`, `functions` and `agents` (`test:prepared` in
`package.json`). Only `test/TESTING.md` and `AGENTS.md` omit them from their
lists. Fix the text.

### A2. What guards what

Each security invariant (plan.md section 6) and each bug class
(review-checklist.md) has one owner lane. The mutants table (A5) names the
exact tests through its `guards` field.

| Invariant / class                                   | Owner lane and file                                                                                                                                                                                            | Real-backend or consumer proof                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| S1 no bypass                                        | fast: `packages/functions/test/no-bypass.test.ts`                                                                                                                                                              | consumers: each consumer's no-bypass test                     |
| S2, S6 types; class 8                               | fast: `packages/functions/test/types.test.ts`; **new** agents type tests (T5)                                                                                                                                  | consumers: `tsc --noEmit` with `declaration: true`            |
| S3, S4 row rules, unknown methods                   | fast: `rules.test.ts` + **new** seeded fuzz of the query proxy (T4)                                                                                                                                            | consumers: one leak table each                                |
| S5, S8 roles, cross-tenant                          | fast: `policy`, `shapes`, `rules`                                                                                                                                                                              | consumers: agency (K3)                                        |
| S7 raw functions from operations                    | fast: `rules.test.ts`, approvals                                                                                                                                                                               | –                                                             |
| S9 scopes                                           | fast: agents `door`, `approvals` + **new** step-authority table (T1); `callTool` shares the door's scope filter                                                                                                | integration: `mcp-auth` (read-only scope)                     |
| S10 approval runs only while executing              | fast: agents `approvals` + **new** interleaving rows (T7)                                                                                                                                                      | integration: `mcp-auth` approve ("approved request ran once") |
| S11 STALE; S13 inert text; S15 activity; S16 dedupe | fast: agents `approvals`, `door`, `values`                                                                                                                                                                     | –                                                             |
| S12 limits                                          | fast: agents + root `unit` transport tests (moved to `packages/agents/test/mcp` in step 7)                                                                                                                     | cloud smoke: 64 KiB+1 and 3 MiB bodies give 413, never 5xx    |
| S14 revocation                                      | fast: agents `door` and `approvals` on the real `requireMcpPrincipal` (step 3); `test/convex/mcp-oauth.test.ts` ("rejects … once its consent is revoked", "denies a revoked connection and a disabled client") | integration: `mcp-auth` (revocation)                          |
| S17 `allOf`                                         | fast: `rules.test.ts` ("every part of an allOf rule holds…")                                                                                                                                                   | – (content consumer: type-check only)                         |
| S18 approvers and `sharedRows`                      | fast: agents `approvals` (the `sharedRows` tests)                                                                                                                                                              | – (marketplace consumer: type-check only)                     |
| Class 1 authority bound to one request              | fast: approvals (follow-up token) + T7                                                                                                                                                                         | integration: `mcp-auth` approve                               |
| Class 9 test helpers in production                  | fast: `test/convex/auth-component-limits.test.ts` (gains a `createBetterConvexTestAuth` row); **new** export-names assertion (T6)                                                                              | packed: `check-packed`                                        |
| Class 10 credentials visible to app code            | fast: **new** literal `ctx.actor` checks on both paths (T2)                                                                                                                                                    | –                                                             |
| Class 11 concurrency                                | review question in review-checklist.md; fast: deterministic interleavings of cross-transaction flows (T7)                                                                                                      | –                                                             |

Why class 11 has no lane: Convex mutations are serializable. The replay lookup
runs inside the tool mutation (`tools.ts:381-411`), and `approve` runs the
approved work in its own sub-transaction (`tools.ts:798-805`). "Two approvals",
"two projects" and "half a revoke" cannot happen while that structure holds,
so a parallel HTTP race tests Convex, not us, and would not fail reliably when
the structure breaks. The real class-11 bug (two `runAfter` calls in one
`Promise.all` appending to a list) happened inside one transaction, and
convex-test reproduces that kind. A reviewer checks the structure; T7 checks
the flows that cross transactions.

### A3. Tests to add

Each row: the wrong behaviour it catches, where it goes, cost.

| #   | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Catches                                                                                                                                                                                                                                                     | Cost                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| T1  | Extend "revoking an in-app agent stops its tools…" in `packages/agents/test/approvals/approvals.test.ts` into one table. Rows: grant revoked, grant expired, run done, run failed, run waiting, caller turn 1 vs run turn 2 → `AGENT_DISABLED` with the literal message; the current turn of a running run → done. Every refused row: the project row is unchanged.                                                                                                                                                                                                                                                                                                                                                                         | An in-app agent step from an old turn, an ended run, or on an expired grant can still call tools (`functions.ts:229-239`). Three mutants survive today.                                                                                                     | about 40 lines, < 0.5 s                 |
| T2  | An approved request schedules an internal action that returns `ctx.actor`. Assert the stored result `toEqual` the literal actor, without `approvalId` and `followUp`. Replace the `not.toContain('approvalId')` check on the operation path with the same literal form.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `shown(who)` dropped at `functions.ts:906`: app code in an internal action sees the follow-up token and can reuse it (class 10). The mutant survives today.                                                                                                 | about 20 lines                          |
| T3  | Integration, one Playwright journey on the starter's Nuxt server that `startMcpFixture` already starts: signed out, `/approvals/<id>` links back to itself; signed in, the request is listed; Approve shows the approved text and the row is archived; Decline shows the declined text.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | A broken return link, a page that does not list the request, an Approve button that calls the wrong mutation, in the page every app copies. No lane clicks it today.                                                                                        | about 60 lines, about 15 s              |
| T4  | Seeded fuzz of the query proxy (`rules.ts` `guardQuery`) in `functions`, reusing `test/auth-fuzz/seeded.ts`. Fixture: 2–3 tenants, one table whose only rule is `tenant('tenantId')`. A random chain (`withIndex`/`order`/`filter`, then `collect`, `take(n)`, `first`, `unique`, `paginate` with a cursor loop, `for await` with early `break`). Oracle: the same chain on the raw `db` in `t.run`. A row is foreign when `row.tenantId !== actorTenant`, nothing else. If any raw row is foreign, the guarded call must throw (rows are checked, not filtered: `rules.ts:469`); otherwise it must return exactly the raw result. `db.get` of a foreign ID must return `null`. Default runs use the checked-in seeds, as `seeded.ts` does. | A rewrite of the proxy that checks the wrong rows, or drifts from Convex semantics, in a combination that the one-example-per-method table does not cover (S3, S4). The oracle is Convex plus one literal comparison; it does not re-implement `judgeRule`. | about 150 lines, 2–3 s                  |
| T5  | Agents type tests in the style of `packages/functions/test/types.test.ts` (copy the door fixture as an app, `tsc` with `declaration: true`). Scenarios: `export const tools = defineTools(...)` emits declarations; `ctx.db.patch`, `ctx.runMutation`, `ctx.scheduler`, `ctx.runQuery` in an approval summary are type errors; a `tool.args` description of an argument that does not exist is an error. A `tools.functions` name without a tool stays a runtime error at the door: to type it, `defineTools` must be generic (a type loop on `internal.<module>`) or the operation type must carry the name (Convex then infers `api.*` as `unknown`).                                                                                     | Class 8 for the second package: the types allow what the runtime refuses (a summary that writes), or a TS4023 declaration error in an app.                                                                                                                  | 3 scenarios, about 2 s each, concurrent |
| T6  | Extend the existing exports check (`check-agents-package-consumer.mjs` or `check-packed`) to assert the literal export names of `@lupinum/better-convex-agents/test`: `['callTool']`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | A fixture that returns to the public test entry (the `testAuth` mistake).                                                                                                                                                                                   | 3 lines                                 |
| T7  | Interleaving rows in `approvals.test.ts`, only for flows that cross transactions, run step by step in convex-test: (1) approved work schedules a follow-up, the person revokes the connection, then `finishInProgressScheduledFunctions` → the follow-up changes no row; pin its literal outcome. (2) the same follow-up is scheduled twice → the second run changes no row; pin its literal code. If a row shows the follow-up still acting, that is a finding: fix it first, then the row is its regression test.                                                                                                                                                                                                                         | Authority that outlives a revoke or a finished approval across a transaction boundary (class 1, class 11, S14).                                                                                                                                             | about 40 lines, < 0.5 s                 |

The tests of section B (`callTool`, `unguardedFunctions`,
`createBetterConvexTestAuth`) are listed there.

The legacy MCP era (one `initialize` + `tools/call` with protocol
`2025-11-25` and no `mcp-method` header) is open question 2. If we keep the
legacy path, add it to `expectStatelessProtocol` in `mcp-auth` (about 15
lines). It catches the door sending legacy requests to the modern transport,
which happened once live.

### A4. Delete, merge, move

Prefer delete over simplify over add. Every move below changes no assertion;
prove it with a coverage diff before and after (`@vitest/coverage-v8` as a dev
dependency, not a gate).

| Action  | What                                                                                                                                                                                                                                                                                                                                                                                                                            | Why                                                                                                                                                                                                                                                                                                                                                     | Size                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Move    | `test/unit/mcp-*.test.ts` (12 files) → `packages/agents/test/mcp/`. Import through `@lupinum/better-convex-agents/mcp` where the public entry is enough, otherwise `./internal`.                                                                                                                                                                                                                                                | They test the agents package but run in `unit`. They break on internal file moves without a behaviour change.                                                                                                                                                                                                                                           | 2,961 lines change owner         |
| Delete  | `testAuth`, `refs`, `mcpClient` from the public `agents/test`. Update `check-agents-package-consumer.mjs`, `check-packed.mjs`, `6.package-exports.md`, `7.api-surface.md`, both READMEs.                                                                                                                                                                                                                                        | `testAuth` accepts any bearer `<authId>:<scopes>` and has no test-runner guard; its docstring tells apps to put it in the `defineFunctions` module (class 9). `mcpClient` needs tokens only `testAuth` accepts, so apps cannot use it either. The packages are `0.0.0`, no consumer outside this repository uses them: direct cutover.                  | about 120 lines public → private |
| Split   | The private remainder of `testAuth` in `packages/agents/test/support.ts`: keep only a fake token verifier (token → principal) for the door fixture's HTTP boundary. `getUser` and `requireMcpPrincipal` come from the real Better Auth component (`register`, `signInAs`, `grantMcp` from `better-auth/test`, through a test-only alias) in both fixtures. The approvals fixture drops HTTP and calls tools through `callTool`. | Today the fake re-implements the expiry and revocation checks with a private `Set`, so the S14 door test checks the fake, not the product. With the real component, a mutant of the live-grant check in `mcp-principal.ts` fails the door test. Only `packages/agents/src` is bound by `check-boundaries`; tests may use the Nuxt package's test entry. | about 150 lines change           |
| Delete  | docs-slice `leaks`, `cost`, `no-bypass` tests (byte copies of the starter), its `authorization.test.ts` (stale copy), and the `grant()` block in `sites.test.ts` (use `grantMcp`).                                                                                                                                                                                                                                              | No unique signal.                                                                                                                                                                                                                                                                                                                                       | about 530 lines                  |
| Delete  | Starter `authorization.test.ts`: the three revocation rows that test library behaviour (host disconnected, session deleted, client disabled).                                                                                                                                                                                                                                                                                   | `test/convex/mcp-oauth.test.ts`, `oauth-live-access.test.ts` and `mcp-auth.integration` own them. Every app that copies the starter would run library tests. Keep "the app suspends the user" and "the membership is removed": they test app code.                                                                                                      | about 25 lines                   |
| Trim    | Each slice, while it moves (A6), to one journey plus a leak table. Drop assertions the package tests own (content's `allOf` edit, agency's web matrix, marketplace's approver rows).                                                                                                                                                                                                                                            | About 100 of 316 slice lines repeat package tests: `rules.test.ts` owns `allOf`, the `approvals.test.ts` `sharedRows` tests own S18. The slices' value is the packed install and the app shape.                                                                                                                                                         | about 100 lines                  |
| Replace | plan.md section 6: drop the "Tests (skeleton)" and "Mutation check (V14)" columns. Write one sentence above the table: "Mutants: `test/mutants/mutants.ts`, filtered by `guards`." Remove the marketplace slice from the S18 row and the content slice from the S17 row.                                                                                                                                                        | Both columns point at skeleton files that no longer exist and test names that drifted. A column of mutant IDs would be a second, unchecked copy of the `guards` field.                                                                                                                                                                                  | about 36 long cells              |
| Retire  | Skeleton `scripts/` (mcp-e2e, mcp-negative, stress/_, phase_, load-harness, operator-data, phase3-cleanup). Keep `evidence/` as history.                                                                                                                                                                                                                                                                                        | One-off evidence code, hard-coded to `little-goldfinch-420` and a personal `~/.convex` token. Everything except the cloud edge and real hosts is now covered by repository lanes.                                                                                                                                                                       | about 4,550 lines                |

Keep as they are (looked at, not worth the churn): the K1 unknown-role case in
both `policy.test.ts` and `shapes.test.ts` (the policy one also covers scopes);
the 413 door test (a smoke test; the transport tests own S12); the starter
`cost.test.ts` (it is the copyable recipe).

### A5. The mutation check

A committed table of mutants, a Vite transform that applies one, and a small
runner. No framework.

**Table:** `test/mutants/mutants.ts`.

```ts
type Project = 'functions' | 'agents' | 'unit' | 'convex' | 'mcp' | 'security'

export interface Mutant {
  /** Stable ID, e.g. 'S10-acting-as-status'. */
  id: string
  /** The invariant or class it guards: 'S1'…'S18', 'C1'…'C11', or 'budget'. */
  guards: string
  /** Repo-relative file. */
  file: string
  /** Must match exactly once in `file`. */
  find: string
  replace: string
  /** Full vitest test names ("file > describe > test") that must ALL fail. */
  kills: string[]
  /** The vitest projects that hold the `kills` tests. Default: ['functions', 'agents']. */
  projects?: Project[]
}

/** Mutants no test can see, with the reason. The runner does not run them. */
export interface Equivalent {
  id: string
  file: string
  find: string
  replace: string
  reason: string
}
```

**Transform:** a small Vite plugin in `vitest.config.ts` (code in
`test/mutants/plugin.ts`). When `BC_MUTANT=<id>` is set, it replaces `find` in
that row's `file` as the module loads, and throws when the match count is not
exactly 1. It reports the replacement to the runner (a file named by
`BC_MUTANT_REPORT`). Nothing is written to the working tree, so Ctrl-C, a
SIGTERM or a CI timeout cannot leave a mutated guard behind, the runner needs
no clean tree, and parallel runs are possible later.

**Runner:** `test/mutants/run.ts`, about 80 lines, run as `pnpm test:mutants`
(`--only <id>` for one row).

1. Run the baseline once over the union of all rows' projects
   (`vitest run --project=… --reporter=json`). Every name in every `kills` list
   must exist and pass.
2. For each row, serially: run only that row's `projects` with `BC_MUTANT` set.
3. Fail the row when:
   - the plugin did not report exactly one replacement (the code drifted, or
     the listed projects never load the file; update the row);
   - any test in `kills` passes (the test does not check what it claims, or
     the guard is now dead);
   - the run errors before tests run (a syntax-breaking mutant; fix the row).
4. Print one line per row and a summary. Tests that fail but are not listed are
   fine; only the listed ones are a contract.
5. Read the S-rows of plan.md section 6 with `/^\|\s*(S\d+)\s*\|/gm` (it
   tolerates oxfmt's column padding, `| S1  |`) and fail when an invariant has
   no mutant row.

**Seed:** the about 45 V14 mutants described in section 6 today; the four
survivors from the maintainer analysis (after T1/T2 they must be killed);
`shown()` in operations; the S12 transport bounds in `transport.ts`
(`projects: ['unit']` until step 7 moves the tests, then `['agents']`); the
live-grant and expiry checks in `src/runtime/convex-auth/mcp-principal.ts`
(`projects: ['convex', 'agents']`); the shared `unsendable` call (kills both
the door test and the `callTool` test); the six starter config mutants of B4
(`projects: ['mcp']`). The two S11 equivalents go into `Equivalent`.

**When:** every PR, as a parallel job in `ci.yml` whose result is in the
`needs` of the final `ci` job. About 5–6 min serial. Parallel runs would bring
it to about 1.5 min; do not build that until the serial time hurts.

**The rule for new findings** (extends plan.md section 6): every fixed
security finding adds one regression test and one mutant row whose `kills`
names that test. This is checked in PR review, not at release.

### A6. Where the slices and the live harness live

- **Slices** move to `test/fixtures/consumers/{agency,content,marketplace,sites}`.
  `sites` takes only `sites.ts` and `sites.test.ts` from the docs-slice.
  `test/packed/check-starters.mjs` loops over `starters/*` and
  `test/fixtures/consumers/*`. A consumer runs install from the local tarballs,
  `tsc --noEmit` with `declaration: true`, and vitest. It skips the Nuxt build.
  Before the move, each slice changes from the fake `testAuth` in its
  production `fns.ts` to real Better Auth (`register`, `signInAs`, `grantMcp`),
  as the starter does. This catches: broken exports or d.ts in the tarball,
  `./internal` contract drift, type ergonomics across four app shapes, and the
  stale-tarball blindness of today (the slices ran on a 06:48 pack; four fixes
  landed after it).
- **The skeleton consumer app** (`tests/app`, `tests/types`) is retired with
  the skeleton branch. `packages/functions/test/types.test.ts` and the
  consumers own what it checked.
- **The cloud smoke** is a vitest project `live`, outside `pnpm test` and
  `verify`, in `test/live/` (about 150 lines). It reuses
  `test/integration/harness.ts` for OAuth and PKCE. Trigger:
  `.github/workflows/live.yml`, `workflow_dispatch`, a protected `live`
  environment. Target: a dedicated Lupinum-org Convex project, by a non-prod
  deploy key in a secret, never a personal token; the guard refuses `prod:`
  keys.

  Default (open question 1): each run deploys to a fresh preview deployment
  (`npx convex deploy --preview-create bcn-live-<run_id>`). The deployment is
  thrown away, so no purge function, row prefix or allowlist is needed. If the
  plan has no preview deployments: deploy to the project's dev deployment and
  add the purge function as an overlay file that only `live.yml` copies into
  the deploy directory. No purge code goes into `starters/`: every app that
  copies the starter would ship it (class 9).

  Journey: deploy `starters/mcp-oauth-agent` from the packed tarballs; sign up;
  PKCE consent; `tools/list`; `create_project` twice with one `request_id`
  (one row); `archive_project` then approve with the session client; a 64
  KiB+1 body and a 3 MiB body (both 413, never 5xx); sign out, then 401. Never
  call dashboard `_system` APIs.

- **Real hosts, real models and Vercel** stay manual and out of CI: they need
  Matthias's accounts or an app-level runtime (P5). The checklist in
  `test/TESTING.md`: connect Claude Code to the smoke deployment, list tools,
  call one read and one write tool, approve one request in the browser. Vercel
  only when auth-proxy, site-origin or client-IP code changed: deploy the
  starter to a preview, one MCP call through the proxy, a forged `x-real-ip`
  must not change the rate-limit bucket.

### A7. Release checklist

All on the release SHA: the head of the Version packages PR, which is what
merges and publishes. Times are for a maintainer, not machine time.

1. CI `ci` is green on that SHA, mutants included. The `ci` check is required
   on `main`, and `release.yml` starts `ci.yml` on the Version packages PR.
   0 min.
2. The `live` workflow is green on that same SHA. About 2 min to start and
   read.
3. Only if the MCP door, OAuth discovery or proxy files changed since the last
   release: the manual host checklist; write pass or fail in the release PR.
   About 10 min.
4. Only if auth-proxy, site-origin or client-IP code changed: the Vercel check.
   About 15 min.

The review-checklist.md walk belongs to PR review, where a finding can still
change the PR.

Total: about 2 minutes of attention for a release that does not touch the
door or the proxy, about 27 when it does.

### A8. Not worth doing

- A mutation framework such as Stryker: slow on this setup (each mutant needs
  a vitest run), noisy, and it mutates code nobody guards. The hand-picked
  table checks the guards that matter.
- A coverage gate in CI. Use coverage only to prove that a move or a cut kept
  coverage.
- Parallel HTTP races on the local backend (class 11): see A2.
- A test of `scripts/release.mjs`'s `0.0.0` filter. It matters only until the
  first functions and agents release, and the version PR shows every version
  to the maintainer who merges it.
- Porting any skeleton live script, or repeating B1 (waits for minute
  boundaries), B3 (10-minute expiry), A6 (waits for a model) or B11 (needs two
  networks) per release. convex-test covers B1, B3 and A6; B11 cannot be proven
  from one machine.
- Real models, real hosts or Vercel in CI.
- Measuring real reads per call from the local backend's `usageStats` now. The
  live numbers (create_project 9 reads against a convex-test budget of 3) show
  the budgets do not model auth reads, but nothing depends on that today. Use
  `usage.py` by hand when the hot path changes.
- A parallel mutant runner, until serial time hurts.

---

## Part B: what app builders get

### B1. Shape of the public test API

Three entries for convex-test, each owned by the package that owns the
concept. One entry is not possible without making `functions` depend on the
Nuxt package or the reverse. Every test-facing export:

| Entry                                                                 | Export                                                                          | Decision                                                                                                                                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@lupinum/better-convex-nuxt/better-auth/test`                        | `default` (`{ modules, register, schema }`), `register`, `signInAs`, `grantMcp` | Keep, unchanged.                                                                                                                                                                                 |
| same                                                                  | `createBetterConvexTestAuth`                                                    | Keep. Add `requireTestRunner()` beside the loopback check: today a local dev backend on `localhost` passes, and it installs Better Auth's `testUtils` plugin (authority).                        |
| `@lupinum/better-convex-functions/test`                               | `unguardedFunctions`                                                            | Keep, changed (B2): takes the lazy module map, refuses a map that checks nothing.                                                                                                                |
| same                                                                  | `countDocuments`                                                                | Keep, unchanged.                                                                                                                                                                                 |
| `@lupinum/better-convex-agents/test`                                  | `callTool`                                                                      | New (B2).                                                                                                                                                                                        |
| same                                                                  | `testAuth`, `refs`, `mcpClient`                                                 | Remove (A4).                                                                                                                                                                                     |
| `@lupinum/better-convex-agents/mcp`                                   | `listMcpCatalog`                                                                | Keep. It is for apps that call `handleMcpRequest` directly; it stays out of `./test` because it loads the SDK. `defineTools` apps use the catalog snapshot recipe (B3).                          |
| `@lupinum/better-convex-nuxt/test`, `@lupinum/better-convex-vue/test` | `setupBetterConvexTest`, `invalidCursorError`                                   | Keep, unchanged; component tests, outside this document. The internal `createBetterConvexTestAuth` in `src/runtime/test/auth.ts` is not exported; rename it to `createTestAuthState` in passing. |

Rules for every primitive: it runs the real product code (the real Better
Auth component, the real tool dispatch, Convex's own syscalls). It refuses to
run outside a test runner when it creates authority. It throws when its input
makes the test meaningless, instead of passing. A misuse error is a plain
`Error` whose message says what to fix; product codes appear only where the
product already has them (the existing `AUTH_TEST_*` codes stay as they are).

### B2. Primitives

#### `unguardedFunctions` (existing, changed)

```ts
import { unguardedFunctions } from '@lupinum/better-convex-functions/test'

function unguardedFunctions(
  modules: Record<string, () => Promise<unknown>>, // the map convexTest receives
  options?: { trustedRoutes?: Record<string, string> }, // path prefix → reason
): Promise<string[]> // "module:export" or "module:METHOD /path", empty when all are guarded
```

- **What it does:** loads every module Convex would deploy and lists every
  Convex function or HTTP route built with Convex's own builders and not
  marked `trusted`. It skips the keys Convex's bundler skips: a file name with
  more than one dot (`*.test.ts`, `*.config.ts`, `test.setup.ts`),
  `_generated/` at the functions root, and a folder below the root with its
  own `convex.config.ts` (convex 1.42.2, `bundler/index.js`). That is Convex's
  rule, not a new convention.
- **Why the change:** the test now scans exactly what the backend loads, from
  the one module list the app already has in `test.setup.ts`. Today the
  no-bypass test keeps its own `import.meta.glob`, a second copy that already
  differs from the docs example.
- **Bug it catches in an app:** a function written with `mutation()` from
  `convex/server` instead of `./functions` skips the policy and the row rules
  (S1).
- **Errors:** an empty map throws
  (`unguardedFunctions found no modules. Pass the import.meta.glob map you give convexTest.`);
  modules without any `defineFunctions` operation throw
  (`unguardedFunctions loaded N modules but found no defineFunctions operations. Check the glob.`).
  Regression test: an empty map throws; it fails without the change. A
  partial glob is no longer the app's problem: the map is the one convex-test
  runs.
- **Edge case:** a project with only raw functions throws the second error.
  That is correct: a no-bypass test is meaningless there.
- **Not a fake:** it reads the markers the real builders set.

```ts
import { modules } from './test.setup'

test('every function goes through the policy and the row rules', async () => {
  const trustedRoutes = { '/api/auth/': 'Better Auth endpoints; the auth library checks each one.' }
  expect(await unguardedFunctions(modules, { trustedRoutes })).toEqual([])
})
```

The docs page copies the starter's file verbatim.

#### `countDocuments` (existing, unchanged)

```ts
function countDocuments(call: () => Promise<unknown>): Promise<{ reads: number; writes: number }>
```

- **What it does:** counts documents read and written at the convex-test
  syscalls during one call, the library's own lookups included.
- **Bug it catches:** a query that loads a whole table to check one row, or a
  write that touches more rows than it should (cost budgets).
- **Errors and edge cases:** throws when convex-test is not set up. It does not
  count rows a `.filter()` skips; a deployment does. Calls in parallel while
  counting give wrong numbers. Both are in its docstring; the docs page must
  say the first one next to the budget example, and that the exact counts may
  change in a release (B5).
- **Not a fake:** it counts the real syscalls.

#### `register`, `signInAs`, `grantMcp` (existing, unchanged)

```ts
function register(test: ComponentRegistrar, name?: string): void
function signInAs<Client>(
  test: SignInAsTestClient<Client>,
  subject: string,
  options?: { expiresInMs?: number },
): Promise<Client> // a client with that person's identity and a real session
function grantMcp<Client>(
  test: SignInAsTestClient<Client>,
  subject: string,
  scopes: readonly string[],
  options?: { clientId?: string; resource?: string; componentName?: string },
): Promise<BetterConvexMcpPrincipal>
```

- **Bug they catch:** anything that depends on who is signed in or connected:
  a role check, a suspended user, a sign-out that should end access, a tool
  that runs without the consented scope or after the person disconnects the
  host.
- **Not a fake:** the real Better Auth component runs inside convex-test; the
  session, client and consent are real rows. All refuse to run outside a test
  runner (tested in `test/convex/auth-component-limits.test.ts`).
- **No `expiresInMs` on `grantMcp`.** No test needs it today, and the Nuxt
  package's three-applications rule applies. `requireMcpPrincipal` checks the
  token only through `principal.expiresAt`, and `grantMcp` reuses an existing
  live session. The docs show the recipe in the scheduled-work section:

  ```ts
  await signInAs(t, 'ann', { expiresInMs: 4 * 60 * 60 * 1000 }) // the session grantMcp reuses
  const principal = {
    ...(await grantMcp(t, 'ann', ['projects:read'])),
    expiresAt: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
  }
  ```

- The docs move the `SITE_URL` and `CONVEX_SITE_URL` stubs into
  `test.setup.ts` once instead of each test file.

#### `callTool` (new)

```ts
import { callTool } from '@lupinum/better-convex-agents/test'

type ToolSuccess =
  | { status: 'done'; result: unknown }
  | { status: 'needs_approval'; approvalId: string; summary: string; url: string }

function callTool(
  test: {
    query(ref: FunctionReference<'query', 'internal'>, args: any): Promise<any>
    mutation(ref: FunctionReference<'mutation', 'internal'>, args: any): Promise<any>
  }, // a convex-test instance
  tools: { catalog: readonly CatalogEntry[] }, // the app's defineTools(...) result
  principal: McpPrincipal, // from grantMcp
  name: string,
  input: Record<string, unknown>, // exactly what a host sends, `request_id` included
): Promise<ToolSuccess>
```

- **What it does:** everything `door.ts` does between the SDK callback and
  `runQuery`/`runMutation`: filter the catalog by the principal's scopes,
  strip `request_id` from `input` and turn a numeric one into a string, run
  `unsendable`, build `{ caller: { door: 'mcp', principal }, input, requestId }`,
  and pick `query` or `mutation` from `entry.kind`. That logic moves into
  `tools.ts` as `grantedTools(catalog, principal)` and
  `toolCall(entry, args, principal)`. `door.ts` and `test.ts` both import it;
  `tools.ts` does not load the MCP SDK, so `./test` still loads without it.
- **Success:** resolves with the tool's output, the same object the door puts
  in `structuredContent`.
- **Failure:** rejects with the original error, as `t.query` and
  `t.mutation` do: a `ConvexError` with `data.code` when the error has a code
  (an `unsendable` input rejects with `ConvexError({ code: 'INVALID_INPUT', … })`),
  and the raw error when it has none. It never folds an error into
  `FAILED`. The door wraps the same errors into an `isError` result through
  `toolFailure`; that envelope is the only intended difference. So the
  starter's `failure(promise)` helper keeps working, and a crash in a handler
  cannot pass as "refused".
- **Misuse:** a name that is not in the catalog, or not unlocked by the
  principal's scopes, throws a plain `Error`:
  `callTool: no tool "archive_project" for this principal. Its scopes unlock: list_organizations, search_projects.`
  The real door has no such code; the MCP SDK answers "Tool … not found".
- **Types:** `principal` is the agents package's own `McpPrincipal`
  (`access.ts:271`); `grantMcp`'s `BetterConvexMcpPrincipal` must fit it
  without a cast. The starter's `authorization.test.ts` passes one to the
  other, and `test:starters` type-checks it, so drift between the two types
  fails CI. The structural `test` type rejects a plain object; it does not
  tell a convex-test instance from a signed-in client. `name` is `string`
  because `CatalogEntry.name` is `string` today. If `defineTools` can carry
  literal tool names without cost, type `name` and `input` from them
  (uncertain; check during implementation, do not block on it).
- **Bug it catches in an app:** app tests that drift from the door's call
  shape (they keep passing an old shape and fail with an unrelated validator
  error), a hand-kept list of which tools are queries that goes stale, and a
  test that calls a tool the person's consent does not unlock.
- **Regression tests:** (1) a principal with only `projects:read` cannot call
  `archive_project`; a mutant in the shared scope filter fails both this test
  and "a read-only grant lists only read tools". (2) A tool whose handler
  throws a plain `Error` makes `callTool` reject with that error, not resolve.

```ts
const principal = await grantMcp(t, 'ann', ['projects:read', 'projects:write'])
await expect(
  callTool(t, tools, principal, 'archive_project', { projectId }),
).resolves.toMatchObject({ status: 'needs_approval' })
const stranger = await grantMcp(t, 'eve', ['projects:read', 'projects:write'])
await expect(callTool(t, tools, stranger, 'archive_project', { projectId })).rejects.toMatchObject({
  data: { code: 'NOT_FOUND' },
})
```

### B3. Docs recipes, not API

Inside `packages/functions` and `packages/agents`, AGENTS.md admits an
addition for a failing test or a real application that needs it; in the Nuxt
package, the three-applications rule applies. Each row says which rule it
meets or misses.

| Recipe                 | What it catches                                                                                                                                                | Why not an API                                                                                                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent surface snapshot | A scope that by accident unlocks a write tool, or an approval rule that was dropped. Today both keep every starter test green.                                 | One line over the public `tools.catalog`: `expect(tools.catalog.map(({ name, kind, scopes, approval }) => ({ name, kind, scopes, approval }))).toEqual([...literal...])`. The literal value, reviewed in the diff, is the test. Apps that call `handleMcpRequest` directly use `listMcpCatalog`.                       |
| Approvers table        | A viewer or member who can approve a teammate's agent archive. Today this mutant keeps every starter test green.                                               | `it.each([['owner','approved'],['admin','approved'],['member','APPROVAL_NOT_FOUND'],['viewer','APPROVAL_NOT_FOUND'],['stranger','APPROVAL_NOT_FOUND']])`, and the row is unchanged on refusal. Roles are app-specific.                                                                                                 |
| Leak table             | A former member who keeps access (the `roleOf` status bug), a refusal with the wrong code, and a call that "passes" because it never reached the tenant check. | There is evidence for a helper: the stranger-only leak test missed the `roleOf` status bug. But the failing actors (a former member, a lower role) are app state that the library cannot create from its metadata, and each row's expected code depends on app roles. So it is a recipe: one table per app (B4).       |
| Scheduled work         | A scheduled step that never runs, or a chain that stops after the first link.                                                                                  | Fake `setTimeout` and `clearTimeout` (platform-facts.md), run pending timers, `finishInProgressScheduledFunctions`, repeat until nothing is in progress, with a step cap; for a chain longer than a token's 10 minutes, the `grantMcp` lifetime recipe (B2). No failing test or real application needs a helper today. |
| Seed data              | –                                                                                                                                                              | App-specific. An app-level `seed.ts`.                                                                                                                                                                                                                                                                                  |
| `expectNoBypass`       | –                                                                                                                                                              | Rejected: with the module map from `test.setup.ts`, the test is three lines.                                                                                                                                                                                                                                           |
| Approve as a person    | –                                                                                                                                                              | Rejected: saves one line and hides which step failed.                                                                                                                                                                                                                                                                  |

### B4. The starter and the docs page

`starters/mcp-oauth-agent/convex/`:

- `no-bypass.test.ts`: passes the `modules` map from `test.setup.ts`; drops its
  own glob.
- `leaks.test.ts`: one table, one row per (actor, call, target), each with one
  literal expected code. Actors: a stranger and a former member (membership
  status `removed`) → `NOT_FOUND` on every call; a lower role on a write →
  the code the library returns today (`FORBIDDEN` expected; pin the literal per
  row). Calls: every operation through the web client, and every tool through
  `callTool`, with a foreign ID and with own and foreign IDs mixed. Each row
  has a positive control: the same call with the actor's own ID succeeds
  through the same path. The canary row stays unchanged, and no rows appear in
  the canary tenant or the approvals table. The `not.toMatch(/Canary|bob/)`
  form is removed from the starter and the docs: any refusal passes it,
  including `INVALID_INPUT` from a wrong argument name. Catches the `roleOf`
  status bug, a refusal that reveals a row exists (`FORBIDDEN` where
  `NOT_FOUND` is due), and a tool that turns a foreign row into a
  `needs_approval` request.
- `agents.test.ts` (new, small): the agent surface snapshot and the approvers
  table.
- `authorization.test.ts`: uses `callTool` (deletes the hand-kept query-tool
  list); keeps the two revocation rows that test app code; drops the three
  that test the library.
- `cost.test.ts`: unchanged.
- `test.setup.ts`: exports `modules` (already) and holds the `SITE_URL` /
  `CONVEX_SITE_URL` stubs.

Done when the six starter config mutants are rows in the mutants table
(`projects: ['mcp']`) and each is killed: `projects` rule `unchecked`; `roleOf`
always `owner`; `roleOf` ignores membership status (killed through `leaks`);
no approval for archive; approvers include member and viewer; `mcp:read`
unlocks `projects.archive`. They then run on every PR instead of once by hand.

`docs/content/docs/3.build/8.functions/5.testing.md`: show the shape of each
test and link the starter file instead of repeating 120 lines of it; add the
agent surface snapshot, the approvers table and the leak table; fix the timer
advice to fake `setTimeout` and `clearTimeout`; replace the `anyApi` tool call
with `callTool`; move the env stubs into `test.setup.ts`; remove the claim
that the row tests cover tools (tools need their own foreign ID call); say
that apps assert codes, not messages, and may need to update budget literals
on upgrade.

### B5. Compatibility

- `functions/test` and `agents/test` belong to packages at `0.0.0` with no
  consumer outside this repository. Remove and change freely until their first
  release (the `unguardedFunctions` signature change included).
- From the first release, the contract of every `./test` entry is: export
  names, signatures and error codes are under semver. Exact document counts
  (`countDocuments` includes the library's own lookups) and message texts are
  not. A changed count or message gets a changelog line under "Tests".
- A change that makes a wrong app test fail (such as the empty-map error) may
  ship in a minor release, with a changelog line (open question 4).
- `./internal` stays outside semver, as documented.
- `better-auth/test` is in the Nuxt package (`1.0.0-rc.1`). The
  `requireTestRunner()` check in `createBetterConvexTestAuth` refuses only
  calls outside a test runner, which no supported use makes.

---

## Implementation plan

In order. Each item is one PR or one commit; the done-when check proves it.

1. **Close the survivors and add the interleavings (T1, T2, T7).** About half
   a day. Done when the four mutants of the maintainer analysis (turn check,
   ended-run check, grant expiry, `shown(who)` in internal actions) each fail a
   package test, each T7 row has a literal outcome (or a fixed finding), and
   `--project=functions --project=agents` stays under 7 s.
2. **Shared dispatch and `callTool` (T6, B2).** About 1 day. Move the dispatch
   into `tools.ts` (`grantedTools`, `toolCall`); add `callTool` and its two
   regression tests; move `testAuth`, `refs`, `mcpClient` into
   `packages/agents/test/support.ts`; update packed checks and reference docs.
   Done when `pnpm test` and `pnpm test:packed` pass; the export-names check
   reads `['callTool']`; a consumer without the MCP SDK installed imports
   `callTool` (`check-agents-package-consumer.mjs`, "only `./mcp` needs the
   SDK"); a mutant in the shared scope filter fails both the door test and the
   `callTool` test.
3. **Real Better Auth in the agents fixtures (A4 split).** About 1 day. Keep
   only the fake verifier for the door fixture; both fixtures use `register`,
   `signInAs`, `grantMcp`; the approvals fixture calls tools through
   `callTool`. Done when a mutant of the live-grant check in
   `mcp-principal.ts` fails the S14 door test, and the agents project stays
   under 10 s. If the fixtures cannot host the component in that time, stop:
   write in plan.md S14 that the door test checks a fake, and that real
   revocation is checked by `test/convex/mcp-oauth.test.ts` and
   `mcp-auth.integration`.
4. **Mutants table, transform and runner (A5).** About 1 day. Seed the table;
   add the CI job without a path filter and put it in the final `ci` job's
   `needs`; rewrite plan.md section 6 (one sentence instead of two columns,
   S17 and S18 without slices). Done when `pnpm test:mutants` is green; every
   S1–S18 has a row (S12 and S14 through their `projects`); a deliberately
   weakened test (one assertion removed) makes its row fail; killing the run
   mid-row leaves `git status` clean.
5. **Library changes for apps (B1, B2).** About half a day.
   `unguardedFunctions` takes the module map, skips Convex's skipped files and
   refuses an empty or operation-free map; `createBetterConvexTestAuth` calls
   `requireTestRunner()`, with one row in `auth-component-limits.test.ts`.
   Done when each regression test fails without its change.
6. **Starter and docs page (B4).** About 1 day. Done when the six config
   mutant rows are in the table and killed, the leak table has one literal
   code per row and a passing positive control per row, and
   `pnpm test:starters` passes.
7. **Move the transport tests (A4).** About half a day. `test/unit/mcp-*` →
   `packages/agents/test/mcp/`; switch their mutant rows to
   `projects: ['agents']`; add `@vitest/coverage-v8`. Done when the test count
   is unchanged, `pnpm test:mutants` is green, and a coverage diff of
   `packages/agents/src` shows no lost line or branch.
8. **Approval page journey (T3).** About half a day. Done when
   `pnpm test:integration` passes and pointing the Approve button at
   `agents:decline` makes T3 fail.
9. **Consumers (A6).** About 1 day. Move the slices and the docs site to
   `test/fixtures/consumers/*` on real Better Auth, trim them, extend
   `check-starters.mjs`, delete the docs-slice copies. Done when
   `pnpm test:starters` runs the four consumers from fresh tarballs and a
   broken export in `packages/agents/package.json` makes it fail.
10. **Fuzz and agent types (T4, T5).** About 1 day. Done when each new test
    fails under one mutant of the code it guards, recorded as a mutant row.
11. **Cloud smoke and manual checklist (A6, A7).** About half a day once the
    Convex project exists; needs open question 1. Done when one `live` run on
    the current release candidate is green; `test/TESTING.md` holds the host
    checklist, the current backend pin (or a pointer to
    `test/helpers/local-backend.json`) and the full project list;
    platform-facts.md line 26 says that `crypto.randomUUID()` in a mutation is
    verified on the local backend by the `mcp-auth` approve and on the cloud by
    the smoke's approve.
12. **Retire the skeleton harness.** About an hour. Done when nothing in this
    repository or the docs points at the skeleton scripts or
    `little-goldfinch-420`.

Rough total: items 1–6 about 5 days; 7–10 about 3 days; 11–12 about 1 day.

## Open questions for Matthias

1. **Cloud smoke target.** Create a Lupinum-org Convex project
   (`better-convex-live`) for a manual workflow, with a preview deploy key in a
   protected GitHub environment, and deploy each run to a fresh preview
   deployment? Default: yes, if the Convex plan includes preview deployments;
   otherwise a dev deploy key and the purge overlay (A6). `workflow_dispatch`
   only, no schedule.
2. **Legacy MCP protocol era.** Keep support for `2025-11-25` hosts and add one
   test, or support only `2026-07-28` and delete the legacy path? Default: keep
   it and add the test; removing it can break hosts we cannot check.
3. **Auth routes in no-bypass.** Should the Nuxt package's Better Auth routes
   mark themselves trusted (a shared `Symbol.for` marker), so apps drop
   `trustedRoutes`? Default: no for now. The one visible line in the app is
   cheap, and the marker would couple two packages.
4. **Wrong app tests that start failing.** May a minor release make a
   previously passing but wrong app test fail (such as the empty-map error)?
   Default: yes, with a changelog line; catching a false pass is the purpose
   of these helpers.

## Rejected review points

- Add the mutants job to `release.yml`'s `needs`: `release.yml` runs no test
  jobs. The required `ci` check, which now includes mutants, gates the merge of
  the Version packages PR, and that merge is what publishes.
- Rename the public `createBetterConvexTestAuth` to end the name clash: only
  the `better-auth/test` one is exported; the other is internal to
  `src/runtime/test/auth.ts`. Only the internal one is renamed.
- Let `unguardedFunctions` accept both an eager and a lazy module map: one
  shape is enough. The lazy map is the one apps already have for `convexTest`.
- Type `callTool`'s `test` so a signed-in client does not compile: a
  structural type cannot tell it from a convex-test instance. The structural
  type stays, for plain objects and wrong shapes.
- A separate T5 type scenario for "`grantMcp`'s principal fits `callTool`":
  the starter already passes one to the other, and `test:starters`
  type-checks it.
- Replace the release-script test with an assertion in `check-packed` or
  `release.mjs check`: the condition ends with the first release, and the
  version PR shows every version to the maintainer.
