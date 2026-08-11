# Testing Guide

## Why this layout

Flaky tests came from using full browser E2E for composable-level behavior.
The suite now uses deterministic tiers so we only use E2E where the full stack
boundary is required.

## Test layout

```
test/
├── unit/                                  # Pure TS logic
├── auth-fuzz/                             # Seeded hostile auth/OAuth input corpus
├── convex/                                # Component behavior via convex-test
├── mcp/                                   # MCP boundary and live-authorization contracts
├── nuxt/                                  # Composables in Nuxt runtime (happy-dom)
├── browser/                               # Native browser component rendering
├── e2e/                                   # Thin full-stack release-gate tests
├── helpers/                               # Shared deterministic harnesses
└── fixtures/                              # Minimal Nuxt fixture(s)

playground/convex/
├── *.test.ts                              # Backend function tests with convex-test
└── lib/*.test.ts                          # Backend helper/permission unit tests
```

## Vitest projects

- `unit`: Node-only tests.
- `convex`: backend logic via `convex-test` (`edge-runtime`).
- `nuxt`: composable contracts in Nuxt runtime.
- `browser`: component rendering in Chromium via Vitest Browser Mode.
- `e2e`: thin full-stack tests; serial execution.
- `auth-adapter`: pinned adapter contract/reference-model suite in an edge-like runtime.
- `oauth`: OAuth profile, provider integration, claims, and negative matrix.
- `auth-fuzz`: deterministic bounded proxy/OAuth fuzz corpus.
- `mcp`: fixed dispatch, bearer, proxy, and transactional-authorization contracts.

## Commands

```bash
# CI/local reliability gate (unit + convex + nuxt + browser)
pnpm test

# Fast dev loop for frontend/runtime
pnpm test:watch

# Nuxt runtime composables only
pnpm test:nuxt

# Browser component suite
pnpm test:browser

# Full-stack E2E (local and final release gate)
pnpm test:e2e

# Full repository verification
pnpm verify

# Auth/OAuth deterministic contracts
pnpm test:auth-adapter
pnpm test:oauth
pnpm test:auth-fuzz
pnpm test:auth-sentinels

# Static dependency, provenance, and live upstream review gates
pnpm check:auth-advisories
pnpm check:auth-provenance --source-only
pnpm check:auth-upstream

# Manifest-pinned real Convex backend proofs
pnpm check:auth-backend --install
pnpm check:auth-schema
pnpm test:auth-concurrency
pnpm test:auth-export-sentinels
pnpm test:auth-mfa

# Real OAuth/MCP clients and advertised-surface protocol scenarios
pnpm test:mcp-auth
pnpm test:mcp-conformance

# Complete auth release matrix
pnpm verify:auth
```

`check:auth-upstream` reads the canonical review in
`security/upstream-convex-better-auth.json`, queries the public GitHub API, and
fails on release, advisory, issue, PR, default-branch, or enumerated source-seam
drift. The checked-in review expires after 31 days, so the nightly and monthly
security workflow cannot silently turn a stale review into release evidence.

`test:auth-concurrency` combines the direct adapter/OCC load with two
self-contained provider gates. The transport-quota gate starts the maintained
OAuth/MCP fixture on a real local Convex backend and verifies the exact
authorize, token, and revoke database quotas across the Nuxt proxy and direct
Convex transports. It releases independent child processes at the last quota
slot, checks signed-IP isolation, invalid-pair rejection, and direct-metadata
fallback, probes the disabled
OAuth surface on both transports, and verifies the login/consent response
headers. The authorization-code gate then obtains provider-issued codes in a
browser and races one code through two independent child processes. It also
proves replay denial, guard-preserved resource/redirect failures, the
post-consume wrong-PKCE and alternate-client failures, and recovery through
fresh authorization transactions. Signatures, codes, verifiers, and token
bodies stay in process memory and are never written to the evidence log.

`test:auth-export-sentinels` uses that same disposable pinned-backend fixture,
but keeps one authorization code live and one access token persisted while it
adds encrypted social-provider tokens, an encrypted provider ID token, and an
encrypted signing-key canary through a temporary test-only action. It downloads
the real Convex snapshot, requires the credential-bearing component tables,
scans bounded extracted bytes for every raw canary, and deletes the entire
fixture and export directory in `finally`. The same gate statically pins the
live OAuth runner's local/session/cookie scans and its fail-closed empty Cache
Storage and IndexedDB assertions.

`test:mcp-auth` is self-contained by default: it creates and owns a temporary
starter, local Convex backend, Nuxt process, administrator, and secrets, then
removes only that temporary root. The only external selector is the exact
`BCN_MCP_TEST_MODE=external-disposable` value. It requires all of
`BCN_MCP_TEST_APP_DIR` (absolute), `BCN_MCP_TEST_ORIGIN`,
`BCN_MCP_TEST_CONVEX_URL`, `BCN_MCP_TEST_CONVEX_SITE_URL`,
`BCN_MCP_TEST_EMAIL`, and `BCN_MCP_TEST_PASSWORD`. The three supplied origins
must be distinct. The app origin may use loopback HTTP; both Convex origins must
be canonical managed HTTPS origins, including the same region when present,
and all three must exactly match
`SITE_URL`, `CONVEX_URL`, `CONVEX_SITE_URL`, `NUXT_PUBLIC_CONVEX_URL`, and
`NUXT_PUBLIC_CONVEX_SITE_URL` in the app directory's owner-only `.env.local`
(for example, mode 0600). That file must select the same managed Convex
deployment through a canonical non-production `CONVEX_DEPLOYMENT` value and
contain no competing Convex CLI authority or override. A sibling `.env` is not
allowed. The supplied password must satisfy the starter's 15-character minimum.

External mode is destructive one-shot evidence for a fresh, already-running,
disposable app and deployment only. The account must already exist with the
starter's `oauthAdmin` capability, and the exact starter functions must already
be deployed. The runner does not create, deploy, start, stop, reset, or destroy
external infrastructure, and its external release hook removes only the
isolated temporary CLI authority directory. It provisions fixture clients and
delegations, mutates live
authorization, deletes terminal-case sessions/clients/consents, and creates and
soft-deletes projects; terminal states are not restored. Never point it at
production, shared staging, populated data, or a deployment that must be
reused. Destroy the consumed deployment through its owner-controlled process.
Before the first mutation, the repository-pinned absolute CLI resolves the
deployment in an isolated directory and must report the exact origins and a
`dev` or `preview` type. External calls then use the supplied app directory as
`cwd`, the validated deployment name, and the private generated env file as
explicit arguments, preventing CLI auto-loading of app dotenv files. Test
credentials and every case variant of an ambient Convex override are stripped
from child environments.

`test:auth-cloud-staging` is intentionally not a local or general CI command.
The protected prerelease workflow supplies one deployment-scoped key and a
one-time bootstrap identity for the dedicated, pre-provisioned Convex project
`bcn-auth-staging`. Before any Convex deployment or data write, the runner
reverifies the downloaded Nuxt, Vue, and MCP artifacts and proves the host edge returns `403` for
unleased fingerprint, auth read/write, and MCP probes. Leased traffic must return
the package-owned runtime fingerprint from the diagnostic endpoint and the real
auth/MCP paths. The runner then clean-installs those exact tarballs into the
maintained OAuth/MCP starter, verifies the installed packages, deploys the
fixture, and requires one current `betterAuth` mount with zero rows in every
discovered auth model and application table. Only then does it create the
bootstrap account, cryptographically verify a session JWT and require Convex to
accept it, run same-ID, increment, public Better Auth lockout/reset,
authorization-code, and JWKS races, delete the rehearsal-owned rows, and
re-prove zero state before writing a bounded non-secret report. It does not
create, preview, or destroy cloud infrastructure. The dedicated deployment key,
edge lease, workflow concurrency group, and no-manual-writer policy must remain
exclusive for cleanup to be safe. Public read-only protocol metadata and JWKS
remain available for standards clients and Convex verification, and their bytes
are never treated as write authority. Provider-specific Nuxt deployment evidence
and proof that an older unmounted component never retained data remain external
release gates; the current component API cannot manufacture either record.

The artifact-aware `check:candidate-apps` gate builds every maintained consumer
from the candidate tarball. Its production `mcp-oauth-agent` build additionally
rejects `.map` files and inline maps under `.output/public`, starts the built
Nitro server, and requires both a hashed client-asset `.map` URL and the
predictable server-entry `.map` URL to return non-200.

## Design rules

1. Runtime/composable behavior goes to `test/nuxt`.
2. Pure DOM visibility/render rules go to `test/browser`.
3. End-to-end stays thin and intentional in `test/e2e`.
4. Backend behavior belongs in `playground/convex/*.test.ts`.
5. Avoid fixed sleeps in `test/nuxt` and `test/browser`.
6. Prefer direct reactive state assertions over scraping `body` text.

## E2E local requirements

1. Run a local Convex backend (or export its `CONVEX_URL` + `CONVEX_SITE_URL`).
2. Configure Better Auth in local Convex env:
   - `BETTER_AUTH_SECRETS`
   - `SITE_URL` (must be `http://localhost:3050` for the auth-loop E2E)
   - `CONVEX_SITE_URL` (the local HTTP Actions origin)
   - `BCN_AUTH_PROXY_IP_SECRET`
3. Run E2E locally when changing full-stack boundaries. Extended CI and the
   immutable-artifact release verifier both run the full E2E and proxy DAST
   suites; the faster compatibility job keeps the shorter deterministic set.

`pnpm test:e2e` sets `CONVEX_E2E_AUTO_START=true`. The helper launches the root
workspace's pinned Convex CLI directly with the exact backend version shown
below, reads the URLs written by the CLI, configures the E2E-only auth values,
and stops only the backend process it started. It does not assume fixed ports.

This is the supported Convex 1.42 ceremony. In a clean non-interactive checkout,
`convex dev` provisions an anonymous local deployment automatically. If
`.env.local` already selects a local deployment, the same command starts that
deployment. The removed `convex dev --local` flag is not supported by Convex
1.42. The backend manifest records reviewed Darwin arm64 and Linux x64 binary
digests. A clean machine downloads that exact version once, stops it, and runs
`pnpm check:auth-backend` before any test claims real-backend evidence.

### Auth-loop bootstrap

The automatic path needs no separate bootstrap:

```bash
pnpm test:e2e
```

To run the backend yourself, keep this command running in one terminal:

```bash
cd playground
CONVEX_DEPLOY_KEY= \
CONVEX_DEPLOYMENT_TOKEN= \
CONVEX_DEPLOYMENT= \
CONVEX_OVERRIDE_ACCESS_TOKEN= \
CONVEX_PROVISION_HOST= \
CONVEX_SELF_HOSTED_URL= \
CONVEX_SELF_HOSTED_ADMIN_KEY= \
CONVEX_AGENT_MODE=anonymous \
CONVEX_ALLOW_ANONYMOUS=true \
CONVEX_RUNNING_LIVE_IN_MONOREPO= \
CONVEX_VERSION_API_ORIGIN= \
CONVEX_VERSION_OVERRIDE= \
pnpm exec convex dev --local-backend-version precompiled-2026-07-06-44f7aa7
```

Then configure and run the suite from another terminal:

```bash
cd playground
pnpm exec better-convex-nuxt-convex env set SITE_URL http://localhost:3050
printf '%s' "$BETTER_AUTH_SECRETS" | pnpm exec better-convex-nuxt-convex env set BETTER_AUTH_SECRETS
printf '%s' "$BCN_AUTH_PROXY_IP_SECRET" | pnpm exec better-convex-nuxt-convex env set BCN_AUTH_PROXY_IP_SECRET
cd ..
pnpm check:auth-backend
CONVEX_E2E_AUTO_START=false pnpm test:e2e
```

Load the two secret variables from a secret manager or generate them in the
shell first; never place their values in command arguments or print them.

The selected backend supplies `CONVEX_SITE_URL` as a built-in. Keep its
generated value in `.env.local`; `convex env set` must not be used for that
reserved name.

For an account-linked project whose local deployment is not currently selected,
select it once before starting the backend:

```bash
cd playground
pnpm exec better-convex-nuxt-convex deployment select local
CONVEX_DEPLOY_KEY= \
CONVEX_DEPLOYMENT_TOKEN= \
CONVEX_DEPLOYMENT= \
CONVEX_OVERRIDE_ACCESS_TOKEN= \
CONVEX_PROVISION_HOST= \
CONVEX_SELF_HOSTED_URL= \
CONVEX_SELF_HOSTED_ADMIN_KEY= \
CONVEX_AGENT_MODE= \
CONVEX_ALLOW_ANONYMOUS= \
CONVEX_VERSION_API_ORIGIN= \
CONVEX_VERSION_OVERRIDE= \
node -- node_modules/convex/bin/main.js dev --env-file .env.local --local-backend-version precompiled-2026-07-06-44f7aa7
```

## Regression workflow

1. Reproduce with a failing test in the right tier.
2. Fix the bug.
3. Keep the regression test as a contract.
