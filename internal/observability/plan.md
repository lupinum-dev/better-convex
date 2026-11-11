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
2. `obs/event`: the call event and `ctx.log.set`.
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

## Layer 2 contract (draft, needs review before `obs/event` starts)

```ts
defineFunctions({ …, observe: true })   // off by default; true = one JSON console line per call
handler: (ctx) => { ctx.log.set({ document: { id } }) }
```

```json
{
  "type": "better-convex.call",
  "action": "documents.send",
  "kind": "mutation",
  "actor": { "key": "person:…", "kind": "person", "door": "web", "userId": "…" },
  "tenant": "…",
  "outcome": "ok",
  "code": null,
  "written": 2,
  "approval": null,
  "trace": "…",
  "fields": { "document": { "id": "…" } }
}
```

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
| 2     | Luis: upgrade from rc to 1.0.x/0.1.x in its own PR, then install #361's build (pinned by commit) on one branch; add why/fix to the failures a user can act on; screenshots | Next                                                                          |
| 3     | Layer 2; log stream on the Luis dev deployment; run the six scenarios                                                                                                      |                                                                               |
| 4     | Layer 3                                                                                                                                                                    |                                                                               |
| 5     | Layer 4 docs                                                                                                                                                               |                                                                               |
| 6     | Release; production log streams after approval                                                                                                                             |                                                                               |

## Open

- Luis has two `fail` functions (the library's and one in `convex/documents/policy.ts` with app
  codes). Converge them later; the call event must record app codes meanwhile.
- `why`/`fix` are server text in one language. A multilingual app maps `code` to its own text and
  uses `why`/`fix` as a fallback.
- Gap: no automated test drives a composable over a real WebSocket in a browser. Round 2 covers it
  by hand; a playground e2e journey would make it permanent.
- `packages/agents/test/types.test.ts` pins line numbers in `test/door/projects.ts`.
