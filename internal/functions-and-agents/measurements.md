# Measurements

What calls cost, measured on 2026-10-07. Compare new numbers against these
before you call a change cheaper or more expensive. The public cost page
(`docs/content/docs/3.build/8.functions/6.cost.md`) has the budget table that
apps can rely on; this file keeps the raw numbers, the method and the
per-user model.

## Two ways to count

| Method                        | What it counts                                                                                                                                                     | Where                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `countDocuments` budget tests | Documents read and written in `convex-test`, with a fake auth. Exact and repeatable. A patch also counts as a read. Rows that a `.filter()` skips are not counted. | `packages/functions/test/cost.test.ts`, `packages/agents/test/door/cost.test.ts` |
| Deployment logs               | Real executions on Convex: documents, bytes, nested executions, cache hits. Includes the auth component.                                                           | `usage.py` in this folder, against `little-goldfinch-420` (dev)                  |

The budget tests catch regressions in CI. The logs answer "what does this cost
on Convex". Both agree once you add the auth component's reads (below).

## Per call, live

Dev deployment `little-goldfinch-420`, skeleton on the packed packages, 1,000
executions over 74 minutes of Codex's live harness. Nested executions are
added to the call that started them (`usage.py`).

| Call                                                                      | Executions | Docs read | KB read           | Docs written | KB written | Root ms |
| ------------------------------------------------------------------------- | ---------- | --------- | ----------------- | ------------ | ---------- | ------- |
| List query (`projects:search`, page of 3)                                 | 1          | 7         | 1.9               | 0            | 0          | ~100    |
| Dashboard queries (organizations, pending, activity, connections, status) | 1          | 3–7       | 1.0–3.5, avg ~1.7 | 0            | 0          | 100–170 |
| Person renames a project                                                  | 1          | 6         | 1.7               | 1            | 0.4        | ~64     |
| Person creates a project                                                  | 1          | 5         | 1.4               | 1            | 0.4        | ~66     |
| Agent tool call through `POST /mcp` (grant check included)                | 3.9        | 13        | 7.2               | 1.4          | 1.0        | ~223    |
| `approve`                                                                 | 1          | 12        | 6.2               | 2.5          | 3.0        | ~147    |
| `decline`                                                                 | 1          | 5         | 3.1               | 2            | 2.7        | ~67     |
| Session refresh (`GET /api/auth/*`)                                       | 6.6        | 5.3       | 2.6               | 1.2          | 0.5        | ~300    |
| Sign-in and OAuth routes (`POST /api/auth/*`)                             | 9.7        | 12.7      | 7.1               | 3.7          | 2.9        | ~400    |
| In-app agent step (`assistant:step`, an action)                           | 2          | 0         | 0                 | 0            | 0          | ~373    |

Cache: the door's live grant check (`betterAuth:adapter:oauthLiveAccess`) came
from Convex's query cache in 67 of 77 calls; `findOne` in 95 of 171 and
`findMany` in 103 of 128. A cached query result re-reads nothing.

Session refresh in detail (Codex investigation, a cleaner capture of 49
refreshes: 5.2 executions, 3.1 documents): `/api/auth/convex/token` runs
`consumeRateLimit`, Better Auth's middleware `findOne(session)` and
`findOne(user)`, our endpoint's `findOne(session)` and `findOne(user)`, and
`findMany(jwks)`. The second session and user reads are the only waste; see
D36 for why they stay. The Convex client refreshes the 15-minute token about
10 seconds before it expires (`node_modules/convex/src/browser/sync/client.ts`).

## Budget tests versus live

| Call                         | Budget test       | Live                                 | Difference                                              |
| ---------------------------- | ----------------- | ------------------------------------ | ------------------------------------------------------- |
| Page of 3 projects           | 6 reads           | 7–8 reads                            | The session check in the auth component (about 2 reads) |
| Tool call with `request_id`  | 3 reads, 3 writes | 9 reads, 3 writes                    | The grant check in the auth component (6 reads)         |
| Tool call that asks a person | 4 reads, 2 writes | 10 reads, 2 writes (docs-only slice) | Same grant check                                        |

## What one user costs

Prices from convex.dev/pricing on 2026-10-07:

|                | Free / Starter                   | Professional ($25 per developer)  |
| -------------- | -------------------------------- | --------------------------------- |
| Function calls | 1M included, then $2.20 per 1M   | 25M included, then $2 per 1M      |
| Database I/O   | 1 GB included, then $0.22 per GB | 50 GB included, then $0.20 per GB |
| Action compute | 20 GB-hours, then $0.33          | 250 GB-hours, then $0.30          |

Convex bills database I/O by bytes, not per document. The docs say explicit
client calls, scheduled runs, subscription updates and file accesses count as
function calls. They do not say whether nested component calls count: the
model below counts them, to stay on the safe side.

The usage pattern is an assumption, not a measurement: one person on a
client's team who manages projects and uses an AI assistant, on a working day.

| Per day                                      | Count       | Executions | Database I/O      |
| -------------------------------------------- | ----------- | ---------- | ----------------- |
| Opens or reloads the app (6 live queries)    | 10          | 60         | 102 KB            |
| Live updates when teammates change something | ~60 re-runs | 60         | 102 KB            |
| Own writes                                   | 15          | 15         | 30 KB             |
| Session refreshes (app open ~2 hours)        | 8           | 53         | 24 KB             |
| Agent tool calls through MCP                 | 20          | 78         | 164 KB            |
| Approvals                                    | 2           | 2          | 18 KB             |
| In-app agent runs, ~4 steps                  | 2           | 26         | ~60 KB (estimate) |
| Total                                        |             | ~300       | ~500 KB           |

Per month, 22 working days: about 6,500 executions, 11 MB of database I/O and
0.004 GB-hours of compute. At Professional overage prices that is $0.013 +
$0.002 + $0.001, so about **$0.016 per active user per month**. The
Professional plan's included amounts cover about 3,800 such users; Free about 150. The library's own extra work (the agent grant check) is about $0.002 of
this. The model calls of the in-app agent are billed by the model provider
and are not in these numbers; they cost more than all of the Convex usage.

Where cost can grow: live updates multiply with the number of people watching
the same data, and the activity log and agent messages grow until
housekeeping deletes them (activity 365 days, decided requests 90, finished
runs 30).

## Re-measure

1. Deploy the skeleton (or an app) on the packed packages to a dev deployment.
2. Drive realistic traffic: `pnpm e2e:mcp`, `pnpm e2e:negative` and
   `scripts/stress/phase4-agent.ts` in `bc-skeleton/labs/skeleton` do.
3. Save the logs and run `python3 usage.py logs.jsonl`. Leave the harness's
   own `testQuery` rows out: they are inspection queries, not app traffic.
4. Compare with the tables above, and update this file with the date.
