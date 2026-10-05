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
├── packed/        Packed-tarball tests: exports, secrets, starters, Vue/Nuxt/MCP consumer apps
├── e2e/           Full-stack Nuxt suites; extended/ runs with --full
├── helpers/       Shared harnesses, including the pinned backend (local-backend.mjs)
└── fixtures/      Consumer and component fixtures
```

`playground/convex/*.test.ts` and `demo/convex/*.test.ts` run in the `convex` project.

The `pnpm test` suites import the Vue package from source; packed checks use the build.

## Commands

```bash
pnpm test               # unit, security, convex, nuxt, browser, auth-adapter, auth-fuzz, mcp
pnpm test:integration   # real local Convex backend (builds the packages first)
pnpm test:e2e           # full-stack E2E; `node scripts/run-e2e.mjs --full` adds extended/
pnpm test:packed        # after `pnpm build`: publint, attw, packed imports, secret scan, consumer typechecks
pnpm test:starters      # every starter and the packed Vue/Nuxt/MCP consumer apps, from local tarballs
```

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

## Integration suites

Each suite owns a temporary directory, its backend, ports and random secrets,
and removes them when it ends. Most run on a temporary copy of
`starters/mcp-oauth-agent` with the built packages installed and the operator-only
functions from `test/fixtures/mcp-oauth-agent/evidence.ts`.

- `mcp-auth`: OAuth discovery, two public PKCE clients, live Convex
  authorization on every tool call (membership, role, tenant, user, resource,
  client link, project ownership, approval), terminal revocation (session,
  client disable/delete, consent), `mcp:write` step-up, and the stateless MCP
  protocol envelope through the official client SDK.
- `oauth-code`: a concurrent double redemption has one winner; replay,
  wrong PKCE, another client, a wrong Basic secret and a post-consume signing
  fault burn the code without persisting a token; no credential in browser storage.
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
pnpm exec convex dev --local-backend-version precompiled-2026-07-06-44f7aa7
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

## Design rules

1. Composable behavior goes to `test/nuxt`. Behavior that depends on the real
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

## Regression workflow

1. Reproduce with a failing test in the right tier.
2. Fix the bug.
3. Keep the test.
