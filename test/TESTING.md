# Testing

## Layout

```
test/
├── unit/          Pure TypeScript logic, type tests
├── security/      Auth, OAuth provider/resource-server and proxy regressions
├── auth-fuzz/     Seeded hostile auth/OAuth input corpus
├── convex/        Component behavior through convex-test
├── mcp/           MCP package, starter and docs-sample contracts
├── nuxt/          Composables in the Nuxt runtime (happy-dom)
├── browser/       Component rendering in Chromium
├── integration/   Real local Convex backend suites (+ check-auth-schema.mjs)
├── live/          Cloud smoke: the starter on a fresh Convex preview deployment
├── mutants/       The mutation check: table, transform and runner
├── packed/        Packed-tarball tests: exports, secrets, starters, Vue/Nuxt/MCP consumer apps
├── e2e/           Full-stack Nuxt suites; extended/ runs with --full
├── helpers/       Shared harnesses, including the pinned backend (local-backend.mjs)
└── fixtures/      Consumer and component fixtures
```

`playground/convex/*.test.ts` and `demo/convex/*.test.ts` run in the `convex` project.
`packages/functions/test` and `packages/agents/test` are the `functions` and
`agents` projects. The starter's tests (`starters/mcp-oauth-agent/convex`) run
in the `mcp` project, and in `pnpm test:starters` from the packed tarballs.

`test/fixtures/consumers/` holds four small apps on the functions and agents
packages: agency, content, marketplace and site checks. Each has one journey and
one leak table. Their tests run in the `mcp` project from source, and in
`pnpm test:starters` from the packed tarballs.

The `pnpm test` suites import the Vue package from source; packed checks use the build.

## Commands

```bash
pnpm test               # unit, security, convex, nuxt, browser, auth-adapter, auth-fuzz, mcp, functions, agents
pnpm test:integration   # real local Convex backend (builds the packages first)
pnpm test:e2e           # full-stack E2E; `node scripts/run-e2e.mjs --full` adds extended/
pnpm test:packed        # after `pnpm build`: publint, attw, packed imports, secret scan, consumer typechecks
pnpm test:starters      # every starter, the consumer apps and the packed Vue/Nuxt/MCP consumers, from local tarballs
pnpm test:mutants       # each security guard broken in memory; `--only <id>[,<id>]` for some rows, `--shard 1/3` for a part
pnpm test:live          # by hand: the starter on a Convex preview deployment (see "Cloud smoke")
```

`pnpm test:live` is outside `pnpm test` and `pnpm verify`. A plain
`vitest run` without `--project` also runs `live`, which fails without its
environment.

Run one project or file after `pnpm exec nuxt-module-build prepare`:

```bash
pnpm exec vitest run --project=convex
pnpm exec vitest run --project=integration test/integration/oauth-code.integration.test.ts
```

## The pinned local backend

E2E and integration suites run against one reviewed Convex local backend
release, recorded with its archive and binary SHA-256 in
`test/helpers/local-backend.json`. `ensureLocalBackend()` downloads and verifies
it on first use into `~/.cache/convex/binaries/<version>`, so the Convex CLI
never fetches an unreviewed binary. The manifest's `convexVersion` must equal the
`convex` dev dependency; bump both together.

`test/helpers/local-convex.ts` owns backend startup, local selection, environment
writes, deployment readiness and backend cleanup for both suites. E2E keeps its
retained backend; integration keeps its per-fixture ports and random secrets.

## Integration suites

Each suite owns a temporary directory, its backend, ports and random secrets,
and removes them when it ends. Most run on a temporary copy of
`starters/mcp-oauth-agent` with the built packages installed and the operator-only
functions from `test/fixtures/mcp-oauth-agent/evidence.ts`.

- `multi-origin`: two Nuxt sites share sign-in on one deployment; forged and signed unlisted origins fail over real HTTP.
- `mcp-auth`: OAuth discovery, two public PKCE clients, live Convex
  authorization on every tool call (membership, role, tenant, user, resource,
  client link, project ownership, approval), terminal revocation (session,
  client disable/delete, consent), `mcp:write` step-up, and the stateless MCP
  protocol envelope through the official client SDK.
- `oauth-code`: a concurrent double redemption has one winner; replay,
  wrong PKCE, another client, a wrong Basic secret and a post-consume signing
  fault burn the code without persisting a token; no credential in browser storage.
- `mcp-sizes`: the door's 1 MiB response limit (found by search, for each kind of
  escaped character and a very long JSON-RPC id: whole just under, the marker just
  over, never HTTP 502), a write that retries after an oversized result, an
  approval document of exactly 256 KiB (and one byte more), the stored result limit
  and the 20 open requests. The limits are read from the product source; the starter
  copy gets three test-only tools.
- `oauth-transport-quota`: authorize/token/revoke quotas shared across the Nuxt
  proxy and direct Convex HTTP per signed client IP; forged IP pairs; disabled
  OAuth routes; hardened login and consent pages.
- `credentials-at-rest`: a browser auth lifecycle (SSR, hydration, revocation,
  sign-out) and an OAuth flow, then a real Convex snapshot export that must not
  contain any raw secret, token, code, verifier or password in any encoding.
- `auth-concurrency` (playground copy): session admission only through the
  component transport, logical-id/unique/compound races, consume-once, lost
  updates, trigger rollback, exact rate limits and JWKS rotation.
- `auth-upgrade`: 1.0.0-beta.7 auth data upgrades to 1.0 through a normal
  `convex dev` push; a control push with a required `bcnConsentId` must fail.
  Set `BCN_AUTH_UPGRADE_KEEP=1` to keep the temporary deployment.

The MFA proof is `test/e2e/extended/auth-two-factor.e2e.test.ts` (run with `--full`).

## E2E

`pnpm test:e2e` starts the pinned backend itself (`CONVEX_E2E_AUTO_START=true`),
configures the E2E-only auth values, and stops only the backend it started.

To run the backend yourself, keep `convex dev` running in `playground` with the
pinned version, then configure it and run with auto-start off:

```bash
cd playground
pnpm exec convex dev --local-backend-version <backendVersion in test/helpers/local-backend.json>
# in another terminal
pnpm exec better-convex convex env set SITE_URL http://localhost:3050
printf '%s' "$BETTER_AUTH_SECRETS" | pnpm exec better-convex convex env set BETTER_AUTH_SECRETS
printf '%s' "$BCN_AUTH_PROXY_IP_SECRET" | pnpm exec better-convex convex env set BCN_AUTH_PROXY_IP_SECRET
cd .. && CONVEX_E2E_AUTO_START=false pnpm test:e2e
```

Generate the two secrets in the shell; never pass them as arguments or print
them. `CONVEX_SITE_URL` is a Convex built-in; do not set it with `convex env set`.

## Real-stack journeys

`test/e2e/extended/auth-session-matrix.e2e.test.ts` runs the journeys users
notice in a real browser with the real Convex client and the local backend. The
page `/labs/use-auth-test` records every visible state change in
`window.__bcnTrace` (`<auth status>|<notes status>:<rows>|<permission context>`),
and each journey compares that trace with a literal list:

| Journey                                  | Guards against                                                                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed-in hard reload                    | a loading or empty frame after hydration, a Convex JWT or session token in the HTML, more than one token request or `Authenticate` per socket, public JWKS refused for a browser with cookies |
| Anonymous hard reload                    | server-rendered public data dropped during hydration                                                                                                                                          |
| Token refresh (`page.clock.fastForward`) | no new token before expiry                                                                                                                                                                    |
| Browser clock one hour fast              | fresh tokens judged by the local clock                                                                                                                                                        |

Every browser context also carries an unrelated platform cookie (`__vdpl`), as
browsers on Vercel do. Add a journey when a bug shows only in the real stack.

## One layer per behavior

Vue unit tests cover the client lifecycle: queries, writes, and discarded results
after identity changes. Nuxt tests cover SSR, hydration, and auth wiring.
Real-stack E2E journeys cover Convex client timing: refresh, acceptance, and
reconnect. Use convex-test with real Better Auth for auth component behavior.
The local-backend integration suite covers real HTTP between Nuxt and Convex.

Do not mock Better Auth to test behavior. Better Auth disables origin (CSRF)
checks in test environments. Enable production checks in tests that depend on
these checks. Set the host `NODE_ENV=production` and `TEST=false` in
`vi.hoisted` before importing Better Auth, then restore both in `afterAll`.
Better Auth captures `NODE_ENV` at import and reads `TEST` when it creates the
request context. Changing only the edge-runtime environment is insufficient.
Explicit `disableOriginCheck: false` and `disableCSRFCheck: false` also enable
both checks. See `test/convex/auth-site-origins.test.ts`.

## Design rules

1. Nuxt composable wiring goes to `test/nuxt`. Behavior that depends on the real
   Convex client (auth timing, token refresh, reconnects, re-execution after
   authentication) needs a real-stack journey: the test transport fetches one
   token and never refreshes, so it cannot show those bugs.
2. Pure DOM visibility/render rules go to `test/browser`.
3. E2E stays thin: only what needs the full Nuxt stack.
4. Backend behavior belongs in `playground/convex/*.test.ts` or `test/convex`;
   behavior that needs the real backend (concurrency, exports, pushes) goes to
   `test/integration`.
5. Avoid fixed sleeps in `test/nuxt` and `test/browser`.
6. Assert behavior, not source text. A static source check is fine only when it
   cheaply guards a security boundary in code users copy (starters, samples).
7. A guarantee of an operation (deny, row rules, limit, audit, error masking)
   is tested on every entry path where its contract applies: public call,
   internal call from an action, scheduled, `ctx.runMutation`, MCP door, in-app
   agent, `runTool`, approved run. The tables are in
   `packages/functions/test/doors.test.ts` and `packages/agents/test/doors.test.ts`.
   A new guarantee gets a table; a new path gets a row in every table. Every
   table has one cell that succeeds, so a setup that refuses everything fails.
8. A batched job or a scan is tested with more data than its limits: more rows
   than one batch in every table, several tables sharing one step's read
   budget, other people's rows before the relevant ones, and a few documents
   near 1 MiB. Run it to the end with `drain(t, { maxSteps })` from
   `test/helpers/drain.ts`; it fails when the work needs more steps than the
   literal bound (a loop that makes no progress) or a scheduled step failed.
   Byte limits are tested on the real backend (`mcp-sizes`).
9. A check that reports problems (`launchProblems`, definition errors) has one
   valid fixture and variants one change away from it. Each variant asserts
   its exact problem, and undoing the change clears it. Invalid input never
   grants anything: bad-value tables assert the exact promised outcome (a
   throw, a refusal or a request for approval).

## Regression workflow

1. Reproduce with a failing test in the right tier.
2. Write a passing test for the valid case next to the bug: what the old code
   got right must keep working.
3. Fix the bug.
4. Keep both tests.
5. For a security guard, add a row to `test/mutants/mutants.ts` whose `kills`
   names the test, and prove it with `pnpm test:mutants --only <id>`.

## Mutation check

`test/mutants/mutants.ts` has one row per security guard: the file, a one-line
break (`find` and `replace`), and the tests that must fail (`kills`) in the
named vitest `projects`. `pnpm test:mutants` runs a baseline, then each row
with `BC_MUTANT=<id>`. The Vite transform in `test/mutants/plugin.ts` applies
the row in memory as the file loads; nothing is written to the working tree.
The type tests and the integration harness apply the row to their own copies.

A row fails when `find` does not match exactly once, when a `kills` test
passes, or when a `kills` test does not run. A full run also fails when an
invariant in `internal/functions-and-agents/plan.md` section 6 has no row. A
break that no test can see goes into `equivalents`, with the reason. Never edit
a source file on disk to try a mutant.

The four `integration` rows (the approval link page) start the starter with
`nuxt dev` on the local backend, so each one takes about 80 seconds.

## Cloud smoke

`pnpm test:live` runs one journey on the MCP OAuth starter in the cloud: sign
up, PKCE consent, `tools/list`, `create_project` twice with one `request_id`
(one row), `archive_project` approved with the person's own session, a body of
64 KiB + 1 byte and one of 3 MiB (413, never 5xx), and sign-out (then 401). It
checks what the local backend cannot: the cloud runtime, the edge in front of
`.convex.site`, and that the built packages deploy.

The run copies the starter with the built packages and the operator-only
functions of `test/fixtures/mcp-oauth-agent/evidence.ts`, runs
`convex deploy --preview-create <name>`, sets `SITE_URL`, `BETTER_AUTH_SECRETS`
and `BCN_AUTH_PROXY_IP_SECRET` (random for each run), and starts the starter's
Nuxt server on this machine against the deployment. Convex deletes old preview
deployments on its own.

| Variable                | Value                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `CONVEX_DEPLOY_KEY`     | A preview deploy key of the dedicated live project. Other kinds (`prod:`, `dev:`, …) are refused.      |
| `BCN_LIVE_PREVIEW_NAME` | Optional: the name of the preview deployment. Default: `bcn-live-local-<random>`.                      |
| `BCN_LIVE_LOCAL=1`      | Without a deploy key: the same journey on the pinned local backend. It checks the test, not the cloud. |

```bash
CONVEX_DEPLOY_KEY=… BCN_LIVE_PREVIEW_NAME=bcn-live-mine pnpm test:live
BCN_LIVE_LOCAL=1 pnpm test:live
```

Load the key into the shell from a password manager; do not type it on a
shared machine. In CI, `.github/workflows/live.yml` runs the smoke by hand
(`workflow_dispatch`) in the protected `live` environment, with the secret
`CONVEX_PREVIEW_DEPLOY_KEY` and the name `bcn-live-<run id>`.

## Manual host checklist

Only when a release changes the MCP door (`packages/agents/src`), OAuth
discovery or the auth proxy. About 10 minutes. Write pass or fail in the
release PR.

1. Deploy the starter to a preview deployment as the cloud smoke does, and
   start its Nuxt server.
2. Connect Claude Code to `<CONVEX_SITE_URL>/mcp`. Sign in and consent.
3. List the tools: the six starter tools are there.
4. Call one read tool (`search_projects`) and one write tool (`create_project`).
5. Call `archive_project`, open the link that the tool returns, and approve in
   the browser. Then let the host call `check_approval`: it says `approved`.

## Vercel check

Only when a release changes the auth proxy, site origins or client-IP code.
About 15 minutes.

1. Deploy the starter to a Vercel preview against a Convex preview deployment.
2. Make one MCP call through the proxy: sign in, consent, `search_projects`.
3. Send sign-in requests with a forged `x-real-ip`. The rate-limit bucket must
   not change: Vercel sets that header, a client cannot choose it.

## Release checklist

On the release SHA: the head of the Version packages PR, which is what merges
and publishes.

1. CI `ci` is green on that SHA, mutants included.
2. The `live` workflow is green on that SHA: run it on the branch
   `changeset-release/main`. About 2 minutes of attention.
3. Only if the MCP door, OAuth discovery or proxy files changed since the last
   release: the manual host checklist. About 10 minutes.
4. Only if auth-proxy, site-origin or client-IP code changed: the Vercel
   check. About 15 minutes.

Walk `internal/functions-and-agents/review-checklist.md` in PR review, where a
finding can still change the PR, not at release.
