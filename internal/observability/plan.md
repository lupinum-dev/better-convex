# Observability: plan and state

Working notes for the observability stack (started 2026-11-11). This file is the source of truth for
the plan; update it when a round ends or a decision is made. Users read the docs, not this file.

## Goal

An app built with Better Convex can answer, after the fact: who did what, in which tenant, with
which result, and why it failed. The app writes no logging code for that. A failure explains itself
to the user and carries a reference that leads to the exact call in the logs.

## Decisions

| Decision                                                                                                         | Reason                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The per-call event comes from `defineFunctions`, not from a logger in app code                                   | Only the wrapper knows actor, action, tenant, the access decision and the rows written. Convex knows none of it                                                                                                        |
| Events leave Convex as one JSON `console` line, through a Convex log stream (Pro plan)                           | `fetch` is not allowed in queries and mutations; an unawaited drain in an action may not run; DB rows and scheduled jobs roll back with a failed mutation, so they lose the failures. Console lines survive a rollback |
| No evlog dependency in any package; evlog stays optional for apps (Nuxt server side)                             | `-functions` imports only `convex`. Inside Convex evlog only formats a line, and its adapters are harmful there (a PostHog drain failed a whole query with "Can't use setTimeout in queries and mutations")            |
| `why`/`fix` live in the `ConvexError` data, not in evlog's `createError`                                         | A `ConvexError` reaches the browser; any other error reaches it as "Server Error"                                                                                                                                      |
| No `why`/`fix` on `NOT_FOUND` and `FAILED` (types and runtime)                                                   | `NOT_FOUND` must read like a missing row; `FAILED` keeps its detail in the log                                                                                                                                         |
| The request ID is read from Convex's error text                                                                  | It is the join key to Convex's own logs and needs no trace argument. Not a Convex contract, so it is optional                                                                                                          |
| The switch is `defineFunctions({ observe })`, not a Nuxt option                                                  | Convex code deploys separately; a Nuxt option cannot change it                                                                                                                                                         |
| Queries emit the event only when they fail                                                                       | Reactive queries re-run on every data change; Convex's own events count every run                                                                                                                                      |
| The event records any `ConvexError` `data.code` string, never the message                                        | Apps have their own codes beside the library's `ErrorCode`s                                                                                                                                                            |
| Business history stays in the database (`auditLog`, `activity`, app tables)                                      | Logs answer "what happened and why did it fail"; audit tables answer "who changed which record"                                                                                                                        |
| Backend: the Convex log stream to PostHog (EU host) is the first target                                          | Logs, error tracking and session replay in one tool. The design does not depend on it                                                                                                                                  |
| One `gh stack`, one release at the end; apps test each layer through its pkg.pr.new build                        | A merge to `main` only queues a Version PR, but a hotfix release would ship half-done changesets                                                                                                                       |
| Dropped for now: typed log fields, pretty dev output, a reserved session-ID argument, OpenTelemetry, a log table | No real need yet, or the cost is higher than the gain                                                                                                                                                                  |

## Verified platform facts

Checked with convex 1.43, a local backend, and evlog 2.35.1:

- evlog bundles and runs in queries, mutations and actions.
- `Date.now()` is frozen in queries and mutations, so a duration measured there is always 0 ms. Take
  timing from Convex's `execution_time_ms`.
- A `console` line written before a mutation throws is kept; the writes roll back.
- A browser `ConvexClient` (WebSocket) receives `[CONVEX M(fn)] [Request ID: <16 hex>] Server Error`
  for mutations, queries and plain crashes. `ConvexError.data` arrives verbatim.
- Convex log streams (Pro): `function_execution` events carry path, `execution_time_ms`, status,
  error, usage and `function.request_id`; `console` events carry the same `function.request_id`.

## Stack

Worktree: `better-convex-worktrees/observability`. Base: `origin/main` at `bf9c1eab5`.

1. `obs/errors`: why/fix and request ID. **PR #361, open.**
2. `obs/event`: the call event and `ctx.log.set`. **Built 2026-11-11; PR open.**
3. `obs/trace`: a trace through nested and scheduled operations.
4. `obs/docs`: an operations page for log streams, with a PostHog recipe.

Release after the whole stack merges: functions/agents 0.2.0, vue/nuxt 1.1.0.

## Layer 1 contract (built)

```ts
fail(code, message)                    // unchanged
fail(code, message, { why?, fix? })    // not for NOT_FOUND or FAILED
failureOf(error) → { code, message, why?, fix? } | null
ConvexCallError.why / .fix / .requestId
```

MCP tool failures carry `why` and `fix` in `structuredContent.error` and in the text. It works in SPA
mode too: every browser call path uses `normalizeConvexError`; SSR only adds the payload round trip.

## Layer 2 contract (built; D75)

```ts
defineFunctions({ …, observe: true })   // off by default; true = one JSON console line per call
handler: (ctx) => { ctx.log.set({ document: { id } }) }
```

```json
{
  "type": "better-convex.call",
  "action": "documents.send",
  "kind": "mutation",
  "actor": {
    "key": "person:…",
    "kind": "person",
    "door": "web",
    "userId": "…"
  },
  "tenant": "…",
  "outcome": "ok",
  "code": null,
  "written": 2,
  "approval": null,
  "trace": "…",
  "fields": { "document": { "id": "…" } }
}
```

As built: absent fields are left out (no `null`s); `code` only on an error; `written` only on a call
that succeeded (a failed call keeps no writes); `trace` waits for layer 3. A job writes
`action: "job.<name>"`; an internal action writes no `action` and only the actor's `kind` (its
`ctx.run` calls write full events). `ctx.log.set` exists without `observe` and does nothing.

- `actor` is the existing `actorRecord(actor)`, the shape `auditLog` already stores.
- `outcome` is `ok` or `error`; readers filter by `code`.
- Duration, path, usage and request ID come from Convex's own event with the same `request_id`.
- IDs and codes only. No arguments, no values, no messages.

Layer 3: the outermost call makes a `trace` ID; the library hands it on with the actor (`actingAs`,
an optional field, so jobs scheduled before the deploy still validate).

## Checks for "looks and reads right"

Six scenarios, run in a consumer app every round, in the same order:

1. A person runs a write: ok.
2. An agent (MCP) tries an action without the right: refused.
3. A person hits a validation failure that has why/fix.
4. A mutation crashes unexpectedly.
5. A mutation succeeds; the job it scheduled fails later.
6. A query succeeds (must not log), and a query is refused (must log).

- The toast shows message, why, fix and the reference (desktop and mobile screenshots).
- Searching the request ID in the log backend finds the call event plus Convex's event.
- Scenario 5 shows both calls under one trace.
- A snapshot test pins the event shape; events contain no values (amounts, names, emails).
- Docs follow `docs/WRITING.md`.
- At most two rounds per item, then find the cause before the next patch.

## Rounds

| Round | Work                                                                                                                                                                       | State                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 0     | Contract                                                                                                                                                                   | Done; layer 2 part not reviewed yet                                           |
| 1     | Layer 1 PR                                                                                                                                                                 | Done: #361, `pnpm verify` green locally (audit not run, no dependency change) |
| 2     | Luis: upgrade from rc to 1.0.x/0.1.x in its own PR, then install #361's build (pinned by commit) on one branch; add why/fix to the failures a user can act on; screenshots | Done 2026-11-11; see "Round 2 results"                                        |
| 3     | Layer 2; log stream on the Luis dev deployment; run the six scenarios                                                                                                      | Layer 2 built, `pnpm verify` green (3865 tests); log stream next              |
| 4     | Layer 3                                                                                                                                                                    |                                                                               |
| 5     | Layer 4 docs                                                                                                                                                               |                                                                               |
| 6     | Release; production log streams after approval                                                                                                                             |                                                                               |

## Round 2 results (Luis, 2026-11-11)

Worktree `1_apps/luis2-observability`.

- `chore/better-convex-1.0` (574a7f7): the upgrade to nuxt 1.0.2 and functions/agents 0.1.0. `pnpm check`
  and 11/11 e2e journeys pass. It needs no quarantine exception: 1.0.2 is older than 24 hours from
  2026-11-10 16:15 UTC on.
- `test/better-convex-obs-errors` (local only, never merge): 507fde2 installs the #361 builds pinned to
  `95aad3c`; 9296ad2 is the Luis change. It waits for the release of this stack.

Findings:

- **Luis people read German text from a code map, not server text.** All 133 error displays go through
  `convexErrorMessage(error, fallback)` (`app/features/errors/api/convexErrors.ts`); the server messages
  are English and written for agents. So `why`/`fix` in Luis are for the MCP door, and the German map
  stays the UI text. The docs must say this: `why`/`fix` help callers that show server text (agents,
  single-language apps); an app with its own UI text maps `code`.
- **Most agent-facing failures already carry the fix** in the message (`field: rule`,
  `Use list_import_accounts`). Five failures got `why`/`fix` where it adds a reason or a next step, not
  the 10 to 15 planned. A throwaway `callTool` run showed the agent gets `{ code, message, fix }`.
- **The reference costs one function in an app with a central error helper.** The fallback now ends with
  `Referenz: <request ID>`; one unit test pins it and the hidden wire text.
- **The join works on a real backend.** A crash in the client sheet showed `Referenz: b461cf01bb1b9378`;
  `npx convex logs --jsonl` had exactly one event with that `requestId`: `clients:create`, the full
  error and stack, the execution time. The plain `convex dev` log lines do not show the request ID, so
  the layer 4 docs must point to the dashboard, `convex logs --jsonl` or the log stream.
- **Luis UX gap, not ours:** a sheet shows its form error at the end of a long form, out of view when the
  person is at the top. Desktop and mobile screenshots needed a scroll.
- **pkg.pr.new in an app needs two test-branch-only settings:** `blockExoticSubdeps: false` (the Nuxt
  build depends on the Vue build by URL) and, while the base release is younger than 24 hours, an
  exact-version quarantine exclude so pnpm can replace it.
- Two Nuxt component suites time out in their setup hook (10 s) under the full parallel run on the test
  branch; they pass alone. Load, not the change.

## Round 3 results (Luis dev `next-narwhal-215`, 2026-11-11)

- Dev had had no deploy since 2026-10-12 and still held the pre-cutover Better Auth rows, which the
  current component rejects. With Matthias's OK, its 9 auth rows were deleted (user 1, session 4,
  account 1, jwks 1, rateLimit 2), and the Luis test branch (9d4bbbe + a `schemaValidation: false`
  commit for two fields removed in Luis #10) was pushed with Convex's own CLI
  (`CONVEX_DEPLOYMENT=dev:next-narwhal-215`; the Better Convex CLI takes the deployment only from
  `.env.local`, by design). PostHog Error Tracking and PostHog Logs are set on dev (Matthias).
- Calls through `convex run` (no user): `clients:list` and `clients:create` wrote `NOT_SIGNED_IN`
  events (request IDs `c80d6e0f0e0198a1`, `a3a8019629462870`); `crons:cleanupEmails` and
  `billingAutomation:startDaily` wrote job events; the scheduled `sweep` and 8 `processContract` runs
  each wrote a `billing.edit` event with actor `system:billing.startDaily`.
- **Layer 3 is needed:** Convex's records do not link scheduled work to its parent
  (`parentExecutionId: null`, `caller: "Scheduler"`, a new request ID per run). The handed-over actor
  says who; only a trace ID says which call.
- Convex stores every line as `'{"type":…}'` (in quotes). Whether PostHog gets it quoted: to check
  in PostHog.

## Open

- Shown in Luis on a local backend (2026-11-11, test branch 9d4bbbe, functions from a local tarball of
  d8597bd): each event sits in the same `convex logs --jsonl` record as Convex's own event, under one
  request ID, and the crash's `Referenz` in the UI is that ID. Convex records the line as
  `'{"type":…}'` (in quotes): check in round 3 whether the stream sends it quoted; if PostHog cannot
  parse it, log an object instead of a string.

- Round 3 questions, answered only by a real log stream: does the line arrive and is it searchable in
  PostHog; does a mutation retried after a write conflict write duplicate events; do Convex's own
  events already link a scheduled job to its parent (then layer 3 shrinks). Decide layer 3 after.
- Round 3 needs Matthias: a PostHog project (EU host) and its key, set as a log stream on the Luis dev
  deployment in the Convex dashboard.

- Luis has two `fail` functions (the library's and one in `convex/documents/policy.ts` with app
  codes). Converge them later; the call event must record app codes meanwhile.
- `why`/`fix` are server text in one language. A multilingual app maps `code` to its own text and
  uses `why`/`fix` as a fallback.
- Gap: no automated test drives a composable over a real WebSocket in a browser. Round 2 covered it
  in Luis with a throwaway Playwright spec; a playground e2e journey would make it permanent.
- Done in #361: the error-handling page says who `why`/`fix` are for and where to search a request ID.
- `packages/agents/test/types.test.ts` pins line numbers in `test/door/projects.ts`.
