# Platform facts we verified

Behaviour of Convex, convex-test, MCP hosts, Better Auth and Vercel that this
work depended on. Each fact says how we know it. Versions at the time
(2026-10-07): `convex` 1.42.2, local backend `precompiled-2026-09-28-5c7cb5b`,
`better-auth` 1.7.6, `@modelcontextprotocol/server` 2.2.0, `ai` 7.0.127.
Check a fact again before you build on it with newer versions.

## Convex

| Fact                                                                                                                                                                                                                                                                                             | Evidence                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files under `convex/` whose name has more than one dot are not deployed, so `*.test.ts` and `test.setup.ts` never reach a deployment.                                                                                                                                                            | `node_modules/convex/dist/cjs/bundler/index.js`: "Skipping … that contains multiple dots"                                                                                 |
| `convex codegen` needs a deployment, because it reads the installed components from it. A local anonymous deployment is enough and works with no network.                                                                                                                                        | Verified in a scratch copy with outbound network blocked (docs: CLI reference)                                                                                            |
| Argument and return values may not contain keys that start with `$`, such as `$schema` from a JSON Schema. The MCP door strips them; the in-app runtime stores messages as JSON strings.                                                                                                         | Deploy and runtime errors in the skeleton (STRESS.md)                                                                                                                     |
| Top-level `args` must be an object validator. A union is rejected at deploy.                                                                                                                                                                                                                     | Deploy error on `save` in the skeleton; a test now checks every registered function's args                                                                                |
| A pagination cursor is valid only for the same query. A sweep that pages must keep its filter values (for example one cutoff) fixed.                                                                                                                                                             | R27                                                                                                                                                                       |
| An action has no transaction. What a raw internal function wrote from an action stays written, even when the action then fails. Only the static no-bypass check prevents it.                                                                                                                     | R25                                                                                                                                                                       |
| Work scheduled inside a mutation, and its arguments, roll back with that mutation.                                                                                                                                                                                                               | `approve` runs the tool in a sub-transaction; a failed tool leaves no follow-up                                                                                           |
| Each execution in the logs carries `usageStats` (documents and bytes read and written), `parentExecutionId` for nesting, and `cachedResult`. `npx convex logs --history N --jsonl --success` prints the history and then keeps watching. A dev deployment keeps about the last 1,000 executions. | `usage.py`, measurements.md                                                                                                                                               |
| Billing counts database I/O in bytes, not documents.                                                                                                                                                                                                                                             | convex.dev/pricing, docs "limits" page, 2026-10-07                                                                                                                        |
| Queries called from HTTP actions are served from the query cache when nothing they read changed (67 of 77 grant checks).                                                                                                                                                                         | Logs, measurements.md                                                                                                                                                     |
| A non-admin WebSocket request for a component function is refused before it runs; the socket closes with code 1011 "InternalServerError".                                                                                                                                                        | Source review: `crates/sync/src/worker.rs:581`, `crates/application/src/api.rs:322` at `5c7cb5b`; integration test "admits sessions only through the component transport" |
| The local backend `precompiled-2026-07-06` left `CONVEX_SITE_URL` unset inside a nested `ctx.runMutation`; `precompiled-2026-09-28` sets it. The newer runtime also has `URL.canParse`.                                                                                                          | Integration tests on both pins                                                                                                                                            |

`crypto.randomUUID()` inside a mutation (the follow-up token of approved
work): verified on the local backend by the approve step of the `mcp-auth`
integration test, and on the cloud by the approve step of `pnpm test:live`
(preview deployments of `better-convex-live`, 2026-10-07).

Oversized requests on the Convex cloud edge (cloud smoke, then a Codex
experiment with 10 requests per case, 2026-10-07):

- An HTTP action that answers 413 with an empty body, or before the client has
  finished uploading, reaches the client as Cloudflare **520** (3 MiB: 10 of
  10). Convex's log shows the action's 413.
- A short JSON body fixes almost every case (3 MiB chunked: 1 in 10 was a 502).
- Reading the whole upload first gave 413 in 160 of 160, at about 0.3–0.5 s of
  action time for 3 MiB. The door therefore reads refused uploads up to 4 MiB
  and answers with a JSON-RPC error body; larger uploads are refused at once.
- An action read a 25 MiB body in full, although the HTTP actions page names a
  20 MB request limit.

Evidence: `bc-live/.evidence-live/exp/` (git-ignored, next to this worktree).

## convex-test

| Fact                                                                                                                                                                                                                                                                                                                                                                                                                     | Evidence                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `vi.useFakeTimers()` with `finishAllScheduledFunctions(vi.runAllTimers)` moves the clock past session and grant expiry, so later calls fail with `NOT_SIGNED_IN` or `AGENT_DISABLED`. Faking only `setTimeout` and `clearTimeout`, then `vi.runOnlyPendingTimers()` and `t.finishInProgressScheduledFunctions()`, works. `finishAllScheduledFunctions` stops with "too many iterations" when only `setTimeout` is faked. | Docs-only slice; testing page                     |
| `countDocuments` counts at the database syscalls: a patch counts as a read, rows skipped by `.filter()` do not. Calls must not run in parallel while it counts.                                                                                                                                                                                                                                                          | `packages/functions/src/test.ts`                  |
| The AI SDK's retry backoff needs real macrotasks to run under fake timers.                                                                                                                                                                                                                                                                                                                                               | Skeleton agent harness (`MessageChannel` pumping) |

## MCP hosts and models

| Fact                                                                                                                                                                                                                                       | Evidence                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Hosts cache `tools/list`. After a deploy that changed tools, Claude Code kept the old schemas until it reconnected. A stateless door cannot send `tools/list_changed`. So change tools additively; a breaking change gets a new tool name. | G11, live with Claude Code                    |
| Models send "no cursor" in many forms: `""`, `"null"`, `"None"`. They are treated as the first page; any other bad cursor is an `INVALID_INPUT`.                                                                                           | Live with an OpenRouter model                 |
| Some hosts send `request_id` as a number.                                                                                                                                                                                                  | Live, R-series                                |
| Hosts render tool text as Markdown, so text from rows must be made inert before a host shows it.                                                                                                                                           | Live with Claude Code                         |
| Escaping does not stop prompt injection through tool results (crawled text). The limits are scopes, `approve` for destructive actions, rate limits and the activity log.                                                                   | Threat model page                             |
| The AI SDK wraps provider errors in `RetryError`; the runtime unwraps it to give coded model failures.                                                                                                                                     | Skeleton runtime                              |
| ChatGPT and Claude.ai connected to an app's MCP door in an earlier pilot (luis, 2026-07-28); Claude Code as host and GPT-6 Luna through OpenRouter in this work.                                                                           | Memory `luis-mcp-pilot`; evidence/10-packages |

## Better Auth and the Nuxt module

| Fact                                                                                                                                                                                                      | Evidence                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Signing out deletes the session, and the OAuth grants are bound to it, so sign-out disconnects MCP hosts (D32).                                                                                           | Live, B2 (retired skeleton harness); now `mcp-auth` integration and `pnpm test:live` |
| MCP access tokens live 10 minutes. A person who approves later than that needs `requireMcpPrincipal(…, { allowExpiredToken: true })` for the approved work; grant, session and consent are still checked. | Round 1 review                                                                       |
| A session refresh is `/api/auth/convex/token`: rate limit, session and user read by Better Auth's middleware, again by our endpoint, then the signing keys. The Convex token lives 15 minutes.            | Codex investigation, D36                                                             |
| rc.1 trusts one site origin, so localhost could not sign in against a deployment whose `SITE_URL` is the production site. Several origins are on `main` (#244).                                           | F8                                                                                   |

## Vercel

| Fact                                                                                                                                                                       | Evidence                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Vercel serves over IPv4 only. A rate-limit test that uses IPv4 and IPv6 from one machine is one client, not two.                                                           | B11 (still needs a second public network to prove) |
| The client IP for Better Auth's rate limits comes from `x-real-ip` (`BCN_AUTH_TRUSTED_CLIENT_IP_HEADER`); a client cannot choose its bucket by sending that header itself. | B11 spoofing check                                 |
