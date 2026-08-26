# Changelog

## Unreleased

- Add five fixed, value-free Convex operator labels for auth initialization
  stages while preserving the existing generic public auth failure.

## mcp-v1.0.0-beta.1

- Release `@lupinum/better-convex-mcp` on its independent 1.0 beta line while
  preserving the coupled Vue/Nuxt version and release history.
- Consolidate MCP server operation on the `better-convex` command with
  provider-neutral request handling, OAuth resource verification, live access
  checks, and sanitized tool-failure hooks.
- Provide the experimental Vue MCP App boundary from the MCP-owned `/vue`
  entrypoint so the Vue runtime remains provider-neutral.

## v1.0.0-beta.1

- Support stable `latest` releases and independent `mcp-v*` releases without
  changing the trusted publishing workflow identity or rebuilding artifacts.
- Align `@lupinum/better-convex-nuxt`, `@lupinum/better-convex-vue`, and
  `@lupinum/better-convex-mcp` on the first 1.0 beta contract.
- Replace the old auth export paths and separate executables with the focused
  `better-auth/*` entries and one `better-convex` command.
- Move the Vue MCP App integration to `@lupinum/better-convex-mcp/vue` so the
  Vue runtime remains identity-safe and provider-neutral.
- Standardize public reactive progress on `pending` and adopt bounded Nuxt,
  Convex, Vue, and Node compatibility ranges backed by exact tested versions.
- Add deferred and lazy query lifecycles, dynamic keyed multi-query state, and
  resumable pagination with generation-safe reset and overlap handling.
- Add one reviewed `createBetterConvexAuth` factory and an idempotent,
  confirmation-gated development initializer that never prints generated secrets.
- Harden cookie forwarding, auth failure classification, serialized error revival,
  OAuth/MCP routing, and request-scoped sanitized MCP tool failure hooks.
- Focus DevTools on query gates, operation timelines, auth/proxy state, and
  sanitized agent boundary diagnostics without polling or editing controls.

## v0.8.0-beta.40

- Move all publishable packages to the `@lupinum` npm scope. This is a hard
  cutover: use `@lupinum/better-convex-nuxt`, `@lupinum/better-convex-vue`, and
  `@lupinum/better-convex-mcp`.
- Hard-cut Better Convex to one Vue-owned client lifecycle, one integrated
  Better Auth client, identity-partitioned SSR/query state, and direct callable
  mutation/action contracts without compatibility shims.
- Make authentication opt-in, keep no-auth installs free of Better Auth, and
  expose an opaque token-free attachment for embedded Vue consumers.
- Ship provider-neutral MCP request handling on the official server, exact
  OAuth resource verification, provider-owned live access checks, and the
  experimental Vue MCP App client boundary.
- Replace repeated release rehearsals with one source certification followed
  by immutable artifact checks, protected npm publication, and exact registry
  byte comparison.
- Refresh every maintained candidate lock against the final package bytes, make
  the local candidate registry compatible with the 24-hour dependency policy,
  and replace the demo's vulnerable `fontless` esbuild version.

## v0.8.0-beta.28

- Bind all three publishable package manifests to the canonical
  `https://github.com/lupinum-dev/better-convex` repository and make that
  provenance identity a release-certification invariant.
- Build the MCP workspace entry directly through the root `unbuild` authority
  during Nuxt prepack so pnpm cannot create a nested package lockfile.
- Preserve the exact Nuxt `4.5.1`, Vite `8.1.5`, Vue `3.5.40`, and experimental
  MCP `2026-07-28` boundaries.

## v0.1.0-beta.16 (`better-convex-mcp`)

- Declare and certify the canonical repository URL required for npm trusted
  publishing and signed provenance.

## v0.8.0-beta.26

- Build the MCP source-test entry through the root workspace's installed
  `unbuild` command and explicit package directory. The source checkout stays
  read-only while the same public MCP entry is compiled before tests.

## v0.6.1

[compare changes](https://github.com/lupinum-dev/better-convex/compare/v0.6.0...v0.6.1)

### 🔒 Dependency and CI hardening

- Updated the exact supported Convex version to `1.42.1` across the package,
  fixtures, demo, and maintained starters.
- Updated the release toolchain, including ESLint 10, Playwright 1.61,
  `@nuxt/eslint-config` 1.16, `@vitejs/plugin-vue` 6.0.8, `convex-test` 0.0.54,
  lint-staged 17, oxfmt 0.59, and the latest compatible stable supporting
  packages.
- Updated pinned GitHub Actions for checkout, Node setup, pnpm setup, and
  TruffleHog; the TruffleHog binary input now matches the pinned action, and
  checkout credentials are not persisted into subsequent job steps.
- Kept TypeScript on the latest compatible 5.9 release because TypeScript 7 is
  outside the current Nuxt, ESLint, and Convex peer ranges.

### ✅ Reliability

- Adapted error construction and local assignments to the stricter ESLint 10
  rules without changing public behavior.
- Made the small Convex backend test corpus run serially, avoiding CPU-contention
  timeouts while preserving the existing per-test failure bound.
- Regenerated and frozen-validated the exact candidate resolution in the demo
  and all five maintained starters.

## v0.6.0

[compare changes](https://github.com/lupinum-dev/better-convex/compare/v0.5.0...v0.6.0)

This is the vNext hard cutover. It replaces the pre-0.6 auth, query-argument,
error, and server-call surfaces outright — there is no compatibility shim and
no deprecation period. Upgrading requires reading the sections below; most
consumers will need source changes.

### 🔒 Security hardening

- Fixed authentication to one same-origin `/api/auth` proxy, GET/POST only,
  with one validated upstream request, no server-side redirect following, and
  no caller-controlled forwarding headers.
- Preserved request bytes and one deadline through complete response
  consumption, including bounded request/response bodies and deterministic
  stream cancellation.
- Made Better Auth's public reactive session the canonical client identity
  source across built-in, raw, and plugin operations, MFA settlement, expiry,
  cross-tab logout, and account switching.
- Serialized complete sign-in, sign-up, and sign-out operations so stale work
  cannot publish a superseded identity.
- Removed cross-origin CORS/trusted-origin configuration, custom proxy routes,
  the cross-request JWT cache, and its public clear helper.
- Hardened maintained demo and starter Convex functions with server-side
  authorization, tenant ownership checks, bounded reads/writes, pagination,
  body limits, and invariant tests.
- Narrowed supported Nuxt versions to `^4.4.0`; Better Auth, its Convex adapter,
  and Convex use exact tested peer versions.

### ✅ Release assurance

- Added deterministic isolated E2E execution, real Nitro proxy probes, seeded
  proxy property tests, browser identity lifecycle coverage, and a two-tab
  session/account-switch matrix.
- Added a machine-checked OWASP ASVS 5.0.0 Level 2 responsibility/evidence
  ledger covering all 253 applicable Level 1/2 controls.
- Added production dependency auditing, CycloneDX SBOM generation, secret
  scanning, CodeQL, pinned CI actions, Dependabot, and exact-tarball release
  gates across the demo and all five maintained starters.
- Release preparation now builds and packs once, verifies that exact immutable
  tarball, records its manifest and SHA-256, and leaves npm publication and Git
  tagging as explicit operator actions.

### 💥 Breaking changes

**Auth installation, config, and runtime topology**

- Removed `auth.enabled` as a separate boolean. Authentication now installs by
  default (or via an options object); pass `auth: false` as the sole
  off-switch. `defaults.auth` no longer exists.
- Removed `auth.cache.enabled` and `auth.unauthorized.enabled`/`auth.unauthorized`.
  The auth cache option is now a plain `false | options` value with no nested
  `enabled` flag, and unauthorized-route recovery no longer exists in module
  options, runtime config, or source.
- Removed `auth: 'auto'`. Query auth modes are exactly `required | optional | none`,
  with identical meaning on client and server. The default mode is `optional`.

**Query modes and cross-identity isolation**

- `optional`/`required` queries now wait for initial auth settlement before
  running, and are partitioned by the caller's stable identity key plus an
  `identityGeneration` counter — no query, paginated page, optimistic update,
  mutation/action result, upload, callback, or seeded-profile state can leak
  across a sign-in/sign-out/user-switch boundary.
- `none` queries always use a dedicated, permanently anonymous transport and
  never observe a Convex identity, even when the app is otherwise signed in.
- Same-user token rotation (refresh) no longer forces query reacquisition.
- Every identity-key change (anonymous↔user, user↔user) retires and closes the
  previous primary `ConvexClient` and replaces it; the public `useConvex()`
  handle and the dedicated anonymous client stay stable across the swap.

**Explicit query arguments; surface removal**

- Queries must always be called with an explicit args object or the literal
  string `'skip'`. Omitted-argument calls (e.g. `useConvexQuery(api.x.y)`) are
  no longer accepted.
- Removed `getQueryKey` and the `better-convex-nuxt/composables` subpath.
  Public types are imported from the package root.

**`ConvexCallError`**

- Introduced `ConvexCallError` as the one public error type for both throwing
  and safe (`{ data, error }`-style) call paths. It survives Nitro/SSR
  serialization with its identity and public fields (`kind`, `code`, `message`,
  `status`, `data`) intact; `cause` is never serialized or logged.
- Unstructured upstream response bodies can no longer reach public errors,
  logs, or payloads.

**Typed Better Auth client**

- Better Auth client plugins are now registered once per Nuxt app through
  `defineConvexAuthClient` in a project's `convex-auth.ts`, using the
  framework-free `better-convex-nuxt/auth-client` entry. Removed
  `createBetterConvexAuthClient`, `resolveBetterConvexAuthBaseURL`, and the
  `BetterConvexAuthClientOptions`/`BetterConvexAuthClientPluginList` types.

**Atomic sign-in/sign-up**

- `signIn`/`signUp` now synchronize the Convex identity automatically as part
  of the call; there is no manual post-sign-in/sign-up refresh step. `refresh()`
  remains available only for advanced raw-client or claim-change flows.
- `useConvexAuth()` is available both when auth is enabled and when it is
  disabled (module option `auth: false`), reporting status `'disabled'` in the
  latter case.

**Server caller and credential exchange**

- `serverConvex` is now the only public server call API. Removed
  `serverConvexQuery`, `serverConvexMutation`, `serverConvexAction`, and
  `useConvexCall`.
- Better Auth cookie credential exchange is bounded, never follows a redirect
  with the credential attached, and never logs secrets. Raw Better Auth session
  tokens are not accepted as public bearer credentials.
- Removed the built-in `permissions` module option (both the `true` and
  `false` states) and the `createPermissions` permissions runtime. Permission
  rules are application/Convex policy, not library machinery. Replace package
  permission helpers with an application-owned UI capability composable backed
  by Convex queries, and continue enforcing authorization inside Convex handlers.

### 🧹 Cleanup

- Deleted `research/` and `experiments/` (concluded Phase 0 exploration,
  distilled into `src/ARCHITECTURE.md` and ADRs where durable; retained only in
  Git history).
- Removed the Phase 0 `test/proofs/auth-races`, `test/proofs/isolation`,
  `test/proofs/onupdate-rebinding`, and `test/proofs/ssr-errors` prototype
  fixtures; their guarantees are now covered by permanent unit, Nuxt, and e2e
  tests (`test/unit/auth-generation-races.test.ts`, `test/unit/client-owner.test.ts`,
  `test/nuxt/auth-two-app-isolation.nuxt.test.ts`,
  `test/e2e/ssr-errors-consumer.e2e.test.ts`, and related identity/anonymous-
  transport Nuxt tests).

### 📖 Documentation

- Rewrote guides and examples onto the final vNext API (explicit query args,
  `optional`-by-default auth modes, `serverConvex`, `defineConvexAuthClient`,
  the replacement-safe `useConvex()` handle, structured error classification,
  and application-owned UI capabilities).

## v0.5.0

[compare changes](https://github.com/lupinum-dev/better-convex/compare/v0.4.0...v0.5.0)

### 🩹 Fixes

- Remove unnecessary override for parent workspace in pnpm configuration ([7f6b2bb0](https://github.com/lupinum-dev/better-convex/commit/7f6b2bb0))

### 💅 Refactors

- Simplify landing feature syntax in documentation ([eef25d41](https://github.com/lupinum-dev/better-convex/commit/eef25d41))

### ❤️ Contributors

- Mat4m0 <matthias.amon@me.com>

## v0.4.0

[compare changes](https://github.com/lupinum-dev/better-convex/compare/v0.3.4...v0.4.0)

Reconstructed from the tagged commit range and the published `0.4.0` npm
release; this section was missing from the changelog until the vNext Phase 6
repair. No new facts beyond what the commit range and the release itself
show — see the [`v0.4.0` GitHub release](https://github.com/lupinum-dev/better-convex/releases/tag/v0.4.0)
and the [published package](https://www.npmjs.com/package/better-convex-nuxt/v/0.4.0)
for the authoritative record if this summary is ever in question.

### 🚀 Enhancements

- Export `ConvexUser` from the module entrypoint ([c78b6926](https://github.com/lupinum-dev/better-convex/commit/c78b6926))
- Harden starters and add the MCP approval flow, including Convex Nuxt runtime
  contract hardening, SSR-safe mutation callables, extracted server auth
  snapshot/shared-query/upload-queue/paginated-query internals, unified live
  query subscriptions, and a Better Auth Organization-backed team starter
  ([6fbf0bd5](https://github.com/lupinum-dev/better-convex/commit/6fbf0bd5))

### 🩹 Fixes

- Prepare starters and demo for the `0.4.0` release ([d18763fb](https://github.com/lupinum-dev/better-convex/commit/d18763fb))

### ❤️ Contributors

- Mat4m0 <matthias.amon@me.com>

## v0.3.4

[compare changes](https://github.com/lupinum-dev/better-convex/compare/v0.3.0...v0.3.4)

### 🏡 Chore

- **release:** V0.3.1 ([134fbdc](https://github.com/lupinum-dev/better-convex/commit/134fbdc))
- Update .npmignore and nuxt.config.ts ([5133e3e](https://github.com/lupinum-dev/better-convex/commit/5133e3e))
- Refine .npmignore to exclude additional unnecessary files ([1ad761a](https://github.com/lupinum-dev/better-convex/commit/1ad761a))
- Bump version to v0.3.3 to fix npm release pipeline ([638c188](https://github.com/lupinum-dev/better-convex/commit/638c188))

### ❤️ Contributors

- Mat4m0 <matthias.amon@me.com>

## v0.3.1

[compare changes](https://github.com/lupinum-dev/better-convex/compare/v0.3.0...v0.3.1)

## v0.3.0

[compare changes](https://github.com/lupinum-dev/better-convex/compare/v0.2.12...v0.3.0)

### 🚀 Enhancements

- Enhance permissions handling and DevTools integration ([2c3ec80](https://github.com/lupinum-dev/better-convex/commit/2c3ec80))
- Add guard pages for pending authentication and enhance query handling ([8fd90d9](https://github.com/lupinum-dev/better-convex/commit/8fd90d9))
- Enhance defineSharedConvexQuery with fingerprinting and duplicate key handling ([5b8e339](https://github.com/lupinum-dev/better-convex/commit/5b8e339))
- Api polish, prepare for release ([a9fb1c3](https://github.com/lupinum-dev/better-convex/commit/a9fb1c3))
- Api polish ([83728a5](https://github.com/lupinum-dev/better-convex/commit/83728a5))
- Add consumer smoke test setup ([5cacd7c](https://github.com/lupinum-dev/better-convex/commit/5cacd7c))

### 🩹 Fixes

- Enhance testing commands and improve local environment setup ([b0c2a09](https://github.com/lupinum-dev/better-convex/commit/b0c2a09))
- Update TypeScript comment in nuxt.config.ts for clarity ([1eabe82](https://github.com/lupinum-dev/better-convex/commit/1eabe82))
- Update CI workflow for module packing and verification ([55323c0](https://github.com/lupinum-dev/better-convex/commit/55323c0))

### 💅 Refactors

- Auth ([157fd65](https://github.com/lupinum-dev/better-convex/commit/157fd65))
- Enhance authentication configuration and documentation ([d09c42a](https://github.com/lupinum-dev/better-convex/commit/d09c42a))
- Streamline Convex configuration and enhance authentication handling ([2d09cdb](https://github.com/lupinum-dev/better-convex/commit/2d09cdb))
- Unify Convex configuration access across composables ([b78a514](https://github.com/lupinum-dev/better-convex/commit/b78a514))
- ⚠️ Modernize Nuxt 4/Vue 3.5 runtime, harden auth proxy, and add cache-reuse recipe/demo ([7e7eb57](https://github.com/lupinum-dev/better-convex/commit/7e7eb57))
- Update error handling and improve component structure ([6cefde9](https://github.com/lupinum-dev/better-convex/commit/6cefde9))
- Migrate to useConvexAuth for authentication handling ([16f82c7](https://github.com/lupinum-dev/better-convex/commit/16f82c7))
- Finish release Candidate ([a50ea1d](https://github.com/lupinum-dev/better-convex/commit/a50ea1d))
- Split useConvexQuery => useConvexQueryLazy ([03852a9](https://github.com/lupinum-dev/better-convex/commit/03852a9))
- Streamline Convex URL handling and improve site URL derivation ([0ff5c2f](https://github.com/lupinum-dev/better-convex/commit/0ff5c2f))
- Update mutation handling and query arguments in playground components ([4f1c399](https://github.com/lupinum-dev/better-convex/commit/4f1c399))
- Improve runtime configuration handling for Convex ([4d10fdc](https://github.com/lupinum-dev/better-convex/commit/4d10fdc))

### 📖 Documentation

- Enhance documentation for HTTP-only mode in Convex queries ([b15f832](https://github.com/lupinum-dev/better-convex/commit/b15f832))
- Update data fetching and pagination examples for reactive arguments ([d0fadb9](https://github.com/lupinum-dev/better-convex/commit/d0fadb9))
- Enhance permissions setup and introduce upload queue functionality ([4228ae4](https://github.com/lupinum-dev/better-convex/commit/4228ae4))
- Update import paths and enhance documentation for file storage and query handling ([6e17d3e](https://github.com/lupinum-dev/better-convex/commit/6e17d3e))
- Enhance authentication and data fetching documentation ([1e35508](https://github.com/lupinum-dev/better-convex/commit/1e35508))
- Update API surface documentation and generation script ([252ac6d](https://github.com/lupinum-dev/better-convex/commit/252ac6d))
- Update query/mutation handling ([5b657bc](https://github.com/lupinum-dev/better-convex/commit/5b657bc))
- Update mutation handling to use `execute()` instead of `mutate()` ([ae179a9](https://github.com/lupinum-dev/better-convex/commit/ae179a9))

### 🏡 Chore

- **release:** V0.2.12 ([df71928](https://github.com/lupinum-dev/better-convex/commit/df71928))
- Bump deps ([d8bbdbd](https://github.com/lupinum-dev/better-convex/commit/d8bbdbd))
- Add Nuxt test-utils configuration and update dependencies ([e7c5f5c](https://github.com/lupinum-dev/better-convex/commit/e7c5f5c))
- Update testing configurations and enhance test scripts ([78c5f0f](https://github.com/lupinum-dev/better-convex/commit/78c5f0f))
- Polish and prepare beta ([5c03668](https://github.com/lupinum-dev/better-convex/commit/5c03668))
- Update pnpm-lock.yaml to include @vitejs/plugin-vue ([3a95bd9](https://github.com/lupinum-dev/better-convex/commit/3a95bd9))
- Add Playwright browser installation step in CI workflow ([d979e22](https://github.com/lupinum-dev/better-convex/commit/d979e22))
- Update playground for new API ([3746396](https://github.com/lupinum-dev/better-convex/commit/3746396))
- Enhance playground configuration and logging ([a288f22](https://github.com/lupinum-dev/better-convex/commit/a288f22))
- Update project configuration and improve mutation handling ([96645b1](https://github.com/lupinum-dev/better-convex/commit/96645b1))
- Clean up nuxt.config.ts by removing unnecessary whitespace ([62dc1d1](https://github.com/lupinum-dev/better-convex/commit/62dc1d1))
- Update deps & format ([16e0b8f](https://github.com/lupinum-dev/better-convex/commit/16e0b8f))
- Update dependencies and Renovate configuration ([1e7e9e0](https://github.com/lupinum-dev/better-convex/commit/1e7e9e0))
- Prepare package version for release ([7dd3ee7](https://github.com/lupinum-dev/better-convex/commit/7dd3ee7))

### ✅ Tests

- Improve selector logic in useConvexConnectionState behavior tests ([e7fddb2](https://github.com/lupinum-dev/better-convex/commit/e7fddb2))
- Enhance connection state behavior tests with improved waiting logic ([b3285a7](https://github.com/lupinum-dev/better-convex/commit/b3285a7))
- Harden dedup, permission guard, and optimistic update coverage ([6a33a8a](https://github.com/lupinum-dev/better-convex/commit/6a33a8a))
- Add end-to-end test for plugin server misconfiguration overlay ([b33601e](https://github.com/lupinum-dev/better-convex/commit/b33601e))

#### ⚠️ Breaking Changes

- ⚠️ Modernize Nuxt 4/Vue 3.5 runtime, harden auth proxy, and add cache-reuse recipe/demo ([7e7eb57](https://github.com/lupinum-dev/better-convex/commit/7e7eb57))

### ❤️ Contributors

- Mat4m0 <matthias.amon@me.com>
