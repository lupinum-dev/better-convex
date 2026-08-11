# Changelog

## Unreleased

## v0.8.0-beta.35

- Retire the unpublished beta.34 Vue/Nuxt candidate after the first clean
  Ubuntu pull-request run exposed a missing source mapping for the maintained
  MCP starter's `better-convex-mcp` import. The local workspace had an existing
  package link, while a fresh root install correctly did not.
- Preserve beta.34/beta.22 as failed local evidence and never publish or reuse
  those coordinates. Reserve beta.35/beta.23 with the MCP test program bound
  directly to the reviewed package source; packed-consumer gates remain the
  authority for package installation behavior.

## v0.1.0-beta.23 (`better-convex-mcp`)

- Retire unpublished beta.22 with the failed beta.34 family and reserve a fresh
  MCP coordinate from the corrected clean source. The MCP runtime and public
  API are unchanged.

## v0.8.0-beta.34

- Retire the unpublished beta.33 Vue/Nuxt candidate set after its immutable
  artifacts were minted from commit `442e910a` but full Nuxt certification
  failed in the broad source test gate. The candidate-lock corruption matrix
  exceeded Vitest's default five-second timeout under the parallel suite. The
  isolated-consumer static sentinel also treated the updater's frozen and
  refresh base argument arrays as missing `--strict-peer-dependencies`; the
  updater appends that flag only for the four pnpm 11 starter profiles because
  the pnpm 10 demo intentionally uses default peer handling.
- Preserve the exact beta.33 artifacts as failed evidence and never rebuild or
  publish that coordinate. Reserve beta.34 for the durable, profile-aware
  certification correction from one clean source commit.

## v0.1.0-beta.22 (`better-convex-mcp`)

- Retire the unpublished beta.21 MCP artifact minted from commit `442e910a`.
  The coordinated `release:prepare` family stopped at the failed Nuxt source
  gate before MCP completed full certification.
- Preserve the exact beta.21 evidence and never rebuild or publish it. Reserve
  beta.22 with the corrected family even though the MCP runtime and public API
  are unchanged.

## v0.8.0-beta.33

- Retire the unpublished beta.32 Vue/Nuxt candidate set after its full release
  rehearsal exposed stale extended E2E assertions for the removed boolean auth
  state and raw signout path. Commit `fd9b49af` corrects the matrix to exercise
  the canonical string auth state and integrated signout contract.
- Never rebuild or publish beta.32; reserve one fresh closed Vue/Nuxt candidate
  set from the corrected clean source commit.

## v0.1.0-beta.21 (`better-convex-mcp`)

- Retire the unpublished beta.20 MCP candidate with the failed beta.32 release
  family because protected workflows build all packages from one clean source
  commit. Never rebuild or publish beta.20; reserve one fresh coordinate without
  changing the MCP runtime or public API.

## v0.8.0-beta.32

- Retire the unpublished beta.31 Vue/Nuxt candidate set after its full clean
  release rehearsal exposed an integrated-auth race: one Better Auth refetch
  could resolve after a competing refresh became authoritative but was still
  pending or refetching, causing a successful browser operation to reconcile
  against stale session data.
- Await canonical Better Auth session settlement after refetch with one bounded,
  leak-free watcher before reconciling Convex identity. The public auth API and
  its sanitized failure contract are unchanged.
- Advance Vue with Nuxt as one exact closed candidate set even though the Vue
  runtime is unchanged; no second version or source-commit path is retained.

## v0.1.0-beta.20 (`better-convex-mcp`)

- Retire the unpublished beta.19 MCP candidate with the failed beta.31 release
  family. The protected workflows build every package from one fresh checkout,
  so a corrected source commit must not mint different beta.19 evidence.
- Preserve the beta.19 provider-neutral MCP implementation and public contract
  unchanged while reserving one fresh immutable coordinate for certification.

## v0.8.0-beta.31

- Hard-cut the client API to one Vue-owned lifecycle: queries use `undefined`
  for absence, preserve backend `null`, accept exact no-argument references,
  and expose the same state through Nuxt-native awaitable query and pagination
  objects. Pagination now requires `initialNumItems` and uses
  `data`/`canLoadMore`.
- Preserve one canonical stable direct callable and reject asynchronous
  optimistic handlers. Remove `.safe`, callbacks, reset, wrapper-side function
  reconstruction, shared-query state, optimistic convenience helpers, generic
  user/storage URL helpers, and the upload queue instead of retaining
  compatibility aliases.
- Make Better Auth opt-in. Auth-enabled builds expose one integrated inferred
  client whose Promise operations resolve only after the canonical provider
  session is re-read and Convex accepts the corresponding token. No-auth builds
  exclude Better Auth imports, routes, middleware, components, and declarations.
- Replace the reconstructable embedded runtime with one frozen, token-free
  attachment that requires an explicit anonymous transport. Plain Vue, Nuxt,
  maintained starters, demos, fixtures, and packed consumers now use the same
  attachment/query/callable contracts.
- Replace user-sync boilerplate with an explicitly derived, rebuildable user
  projection. The helper owns its indexed auth ID and prevents projection
  callbacks from changing that source-of-truth field.
- Make invalid server credential combinations unrepresentable, preserve
  official no-argument call arity, and tighten single-file upload URL/result
  typing while deleting the generic queue/config state machine.
- Remove Kysely as a direct requirement. Better Auth and OAuth Provider are
  exact optional peers; an ordinary Convex-only install has no auth dependency
  graph.
- Retire the unpublished beta.30 candidate, delete obsolete workspace
  overrides, and preserve the exact reviewed Nuxt `4.5.1`, Vue `3.5.40`, and
  Convex `1.42.2` tuple.

## v0.1.0-beta.19 (`better-convex-mcp`)

- Replace the reusable wrapper-shaped handler with one request-scoped
  `handleMcpRequest(request, options)` call backed by a fresh official server
  and deterministic close lifecycle.
- Mount the complete protected-resource metadata route graph, preserve exact
  issuer identifiers, consolidate verifier ownership under authorization, and
  revalidate provider access through the Better Auth component before exposing
  application tools.
- Export nameable MCP App lifecycle/error types and close failed client
  transports. Keep `runMcpTool` explicitly narrow: stock MCP Server 2.0 does
  not provide a universal operation-error projection hook.
- Retire the unpublished beta.18 MCP candidate with the coordinated beta.30
  Vue/Nuxt set, and certify the final MCP 2026-07-28 contract on the official
  Server `2.0.0` implementation without adding a legacy protocol path.

## v0.8.0-beta.30

- Retire the unpublished beta.29 Vue/Nuxt candidate after its clean local
  candidate matrix exposed two Team starter integration tests that could exceed
  Vitest's generic five-second unit-test timeout under sustained workload.
- Give the Team starter's Convex integration suite one explicit 15-second test
  budget. The product assertions and runtime behavior are unchanged.
- Remove the exact official MCP package-age exclusions after every pinned
  package passed the normal 24-hour supply-chain age policy.
- Preserve Nuxt `4.5.1`, Vite `8.1.5`, Vue `3.5.40`, and the existing public
  Vue/Nuxt API without adding a compatibility path or runtime behavior change.

## v0.1.0-beta.18 (`better-convex-mcp`)

- Retire the unpublished beta.17 MCP candidate with the coordinated beta.29
  Vue/Nuxt set; no MCP implementation or public contract changed.
- Preserve the existing provider-neutral MCP contract and official SDK tuple
  without adding a protocol switch, fallback, or public API change.

## v0.8.0-beta.28

- Retire unpublished beta.27 after its immutable Vue, Nuxt, and MCP candidates
  passed protected verification, but npm correctly rejected Vue provenance
  because the packed package did not declare the repository URL.
- Bind all three publishable package manifests to the canonical
  `https://github.com/lupinum-dev/better-convex-nuxt` repository and make that
  provenance identity a release-certification invariant.
- Build the MCP workspace entry directly through the root `unbuild` authority
  during Nuxt prepack so pnpm cannot create a nested package lockfile.
- Preserve the exact Nuxt `4.5.1`, Vite `8.1.5`, Vue `3.5.40`, and experimental
  MCP `2026-07-28` boundaries.

## v0.1.0-beta.16 (`better-convex-mcp`)

- Retire unpublished beta.15 with the coordinated beta.27 set.
- Declare and certify the canonical repository URL required for npm trusted
  publishing and signed provenance.

## v0.8.0-beta.27

- Supersede the partially staged beta.26 family after its exact Vue and Nuxt
  candidates reached npm, but the reserved `@better-convex` npm scope proved
  unavailable for the independently packaged MCP candidate.
- Hard-cut the MCP package coordinate to the available unscoped
  `better-convex-mcp` name, keeping one consistent Better Convex package
  family. No alias, compatibility package, or second release path is retained.
- Preserve Nuxt `4.5.1` and the already-certified runtime and security
  boundaries while producing a fresh coordinated candidate set.

## v0.1.0-beta.15 (`better-convex-mcp`)

- Retire the unpublished `@better-convex/mcp@0.1.0-beta.14` candidate because
  its npm scope is unavailable.
- Publish the same provider-neutral MCP contract under the unscoped
  `better-convex-mcp` coordinate as one breaking prerelease cut.

## v0.8.0-beta.26

- Retire unpublished beta.25 after its immutable MCP candidate and all
  artifact-dependent MCP gates passed, then the source-test build command
  caused pnpm 11 to create a nested workspace lockfile. No registry
  publication job ran.
- Build the MCP source-test entry through the root workspace's installed
  `unbuild` command and explicit package directory. The source checkout stays
  read-only while the same public MCP entry is compiled before tests.

## v0.1.0-beta.14 (`@better-convex/mcp`)

- Retire unpublished beta.13 with the coordinated beta.25 set.
- Keep source-test compilation under the root dependency authority so the
  nested MCP workspace cannot create a package-local lockfile.

## v0.8.0-beta.25

- Retire unpublished beta.24 after its protected tag workflow passed candidate
  construction, release security, artifact identity, and Vue certification,
  then the clean Linux Nuxt source gate imported the unbuilt workspace MCP
  entry. No registry publication job ran.
- Make the self-contained MCP source-test runner build its workspace package
  before Vitest imports the maintained MCP starter. Exact candidate checks
  still consume the retained tarball and never repack it.
- Preserve the exact Nuxt `4.5.1`, Vite `8.1.5`, Vue `3.5.40`, and experimental
  MCP 2026-07-28 draft/RC boundaries from beta.24.

## v0.1.0-beta.13 (`@better-convex/mcp`)

- Retire unpublished beta.12 with the coordinated beta.24 set.
- Ensure clean-checkout source tests compile the workspace MCP public entry
  before importing it; immutable candidate verification remains separate.

## v0.8.0-beta.24

- Retire unpublished beta.23 after its protected tag workflow verified the
  candidate set and release security, then the Nuxt hybrid auth gate linked the
  unbuilt workspace MCP package instead of installing the retained MCP
  candidate. No registry publication job ran.
- Pass the exact retained MCP tarball into hybrid auth verification alongside
  the exact Nuxt and Vue tarballs. Clean-checkout verification no longer
  depends on a prior workspace MCP build.
- Preserve the exact Nuxt `4.5.1`, Vite `8.1.5`, Vue `3.5.40`, and experimental
  MCP 2026-07-28 draft/RC boundaries from beta.23.

## v0.1.0-beta.12 (`@better-convex/mcp`)

- Retire unpublished beta.11 with the coordinated beta.23 set.
- Make the immutable MCP candidate the MCP dependency used by the coordinated
  Nuxt hybrid auth proof.

## v0.8.0-beta.23

- Retired after protected candidate construction and security passed but the
  Nuxt hybrid auth gate used an unbuilt workspace MCP link. Nothing was
  published.
- Retire unpublished beta.22 after its protected tag workflow produced the
  Vue/Nuxt artifacts but MCP prepack triggered pnpm dependency verification and
  dirtied the checkout with `packages/mcp/pnpm-lock.yaml`.
- Run release prepack with dependency verification disabled after the workflow
  has already completed its frozen root install. The clean-tree guard remains
  mandatory and no generated package lock is ignored or deleted.
- Preserve the exact Nuxt `4.5.1`, Vite `8.1.5`, Vue `3.5.40`, and experimental
  MCP 2026-07-28 draft/RC boundaries from beta.22.

## v0.1.0-beta.11 (`@better-convex/mcp`)

- Retire unpublished beta.10 with the coordinated beta.22 set.
- Prevent MCP prepack from performing an implicit dependency install, so the
  reviewed frozen workspace remains the only dependency authority.

## v0.8.0-beta.22

- Retired after the protected tag workflow produced immutable Vue/Nuxt
  artifacts but failed before MCP certification. Nothing was published.
- Prepared Vue/Nuxt `0.8.0-beta.22` for the same-day experimental
  `next-staging` release after beta.21 failed immutable verification and
  remained unpublished.
- Replace the exact Nitro Azure build-only `brace-expansion@2.1.2` exception
  with `2.1.3`; the reviewed constant-pattern call path and non-runtime
  mitigation are unchanged, and the replacement expires on 2026-08-28.
- Hard-cut the supported Nuxt tuple to the patched `4.5.1` release with
  `@nuxt/kit@4.5.1`, `@nuxt/schema@4.5.1`, Vite `8.1.5`, and Vue `3.5.40`.
- Delete the workspace-wide Vite override; maintained consumers now declare the
  coordinated runtime directly.
- Keep final MCP maturity, real-host MCP evidence, strict Ginko npm
  compatibility, and protected Better Convex cloud staging outside this
  experimental release claim.

## v0.1.0-beta.10 (`@better-convex/mcp`)

- Retired after MCP prepack implicitly created an untracked package lock in the
  protected workflow. No MCP artifact or registry package was produced.
- Prepared MCP beta.10 with experimental support for the `2026-07-28` draft/RC
  after coordinated beta.9 remained unpublished.
- Retain the stable official SDK ownership and stateless contract without
  claiming final specification or stable conformance support.
- Keep final MCP maturity, real-host MCP evidence, strict Ginko npm
  compatibility, and protected Better Convex cloud staging outside this
  experimental release claim.

## v0.8.0-beta.21

- Retired after immutable verification resolved `brace-expansion@2.1.3`, which
  was outside the exact `2.1.2` exception. This coordinate was not published.
- Retire beta.20 after the exact clean npm consumer again failed closed on
  `brace-expansion@2.1.2` in Nitro's Azure deployment-only `archiver@7`
  graph.
- Admit one exact, 30-day advisory exception after source review proved Nitro
  supplies a constant glob over generated build output and the vulnerable
  dependency is absent from the application runtime.
- Preserve the exact `@nuxt/kit@4.4.8` tuple pin added after beta.19; it closes
  package-owned version drift even though it was not the root cause of the
  Nitro advisory.

## v0.1.0-beta.9 (`@better-convex/mcp`)

- Retired with its coordinated beta.21 companions and never published.
- Reserve a fresh coordinated source identity after beta.8 independently
  passed its complete lane but could not remain in a candidate set whose
  Vue/Nuxt companion failed.
- Preserve the beta.8 package behavior unchanged.

## v0.8.0-beta.20

- Pin the package-owned `@nuxt/kit` runtime to the exact certified Nuxt
  `4.4.8` tuple after the beta.19 clean npm consumer correctly rejected
  semver drift to an unreviewed transitive dependency graph.
- Retire beta.19 as immutable failed evidence; it was never published and
  cannot be rebuilt under the same version.
- This correction closed `@nuxt/kit` tuple drift but did not remove Nitro's
  independent Azure deployment-only `archiver@7` advisory path; beta.20
  therefore also failed exact clean-consumer certification.

## v0.1.0-beta.8 (`@better-convex/mcp`)

- Reserve a fresh MCP source identity so the Vue, Nuxt, and MCP candidates are
  all bound to the corrected clean source commit.
- Preserve the independently passing beta.7 MCP behavior while retiring that
  unpublished artifact from new candidate sets.

## v0.8.0-beta.19

- Retire beta.18 after the dependency graph changed; the old coordinate remains
  immutable historical evidence and cannot be rebuilt or published.
- Patch current production advisories across the root and maintained consumer
  locks, retaining one bounded build-tool-only exception for
  `brace-expansion@1.1.16`.
- Close the final-tree cleanup with one Vue lifecycle owner, one MCP server
  owner, and no restored compatibility paths.

## v0.1.0-beta.7 (`@better-convex/mcp`)

- Reserve a fresh MCP source identity after beta.6 was retired with the shared
  dependency-security review.
- Preserve the locked release-candidate protocol behavior and public API; final
  MCP `2026-07-28` support remains gated on the published specification and
  compatible official SDK evidence.

## v0.8.0-beta.18

- Canonically format the deployed interaction fixture before source-integrity
  certification.
- Retire beta.17 as an immutable failed candidate after the formatting gate
  rejected its source commit; retain independently certified MCP beta.6.

## v0.8.0-beta.17

- Pair the exact Vue/Nuxt candidates with MCP beta.6 after the beta.16
  candidate gate rejected the retained beta.5 artifact's superseded public
  declaration surface.
- Preserve beta.16 as an immutable failed candidate rather than rebuilding it
  after the current API-admission contract changed.

## v0.1.0-beta.6 (`@better-convex/mcp`)

- Remove the five unadmitted handler and diagnostic type declarations from the
  packed public entry, matching the current hard-cut source API.
- Retire beta.5 for new candidate sets after exact package-export validation
  proved that its declarations predated the public API admission review.

## v0.8.0-beta.16

- Certify the private locked-RC high-impact interaction through the complete
  authorization, live-grant revocation, stale-impact, replay, concurrency,
  browser, and disclosure matrices.
- Reserve fresh Vue/Nuxt source identities for exact interaction-lifecycle
  certification while retaining the independently certified, byte-unchanged
  `@better-convex/mcp@0.1.0-beta.5` artifact.

## v0.8.0-beta.15

- Bind the OAuth/MCP starter's retained `@better-convex/mcp` dependency to
  exact immutable beta.5 bytes throughout the Nuxt candidate consumer matrix.
- Retire the immutable beta.14 Vue/Nuxt artifacts after their consumer proof
  correctly rejected an unpublished MCP registry lookup; MCP beta.5 remains
  valid in its independently certified release lane.

## v0.8.0-beta.14

- Record the extracted relationship engine and updated auth-derived targets in
  the upstream provenance ledger.
- Retire the immutable beta.13 Vue/Nuxt artifacts after the provenance gate
  correctly rejected stale derived-target hashes; MCP beta.5 remains valid in
  its independent release lane.

## v0.8.0-beta.13

- Upgrade the build graph to patched `postcss@8.5.16` after the beta.12
  candidate failed the High-severity advisory gate.
- Retire the immutable beta.12 Vue/Nuxt artifacts; MCP beta.5 remains valid in
  its independent release lane because its production artifact does not
  contain PostCSS.

## v0.1.0-beta.5 (`@better-convex/mcp`)

- Align the release-only documentation invariant with the package-owned SDK
  lifecycle after the full MCP project passed.
- Retire beta.4 after its immutable artifact reached the stale wording check.

## v0.1.0-beta.4 (`@better-convex/mcp`)

- Correct the installed-package credential-boundary proof for the
  package-owned official SDK server lifecycle.
- Retire the immutable beta.3 artifact after its stale external consumer
  correctly failed before release certification completed.

## v0.1.0-beta.3 (`@better-convex/mcp`)

- Own the official SDK server instance inside the package and expose only a
  configuration callback, eliminating duplicate-SDK identity coupling.

## v0.8.0-beta.12

- Make Nuxt SSR pagination status honor the same execution decision and error
  state as its data path.
- Remove `null` as query lifecycle control state and extract JWKS response and
  relationship-graph machinery from the auth plugin and adapter mutation
  implementation.

## v0.1.0-beta.2 (`@better-convex/mcp`)

- Add the experimental provider-neutral Convex-native MCP package on the locked
  `2026-07-28` release candidate and exact official TypeScript SDK beta.
- Certify one immutable package through direct public-client PKCE with Better
  Auth and an independent signed-token verifier, both deployed through real
  Convex HTTP Actions without bearer-token passthrough.
- Prove locked-RC stateless discovery, tools, live authorization and revocation,
  safe application failures, transport bounds, and explicit unsupported
  capabilities while retaining truthful legacy conformance evidence.
- Rebuild authenticated requests as credential-free SDK inputs, narrow the
  transport to bounded unary tools/resources, and require live Better Auth
  authority validation.
- Use the RC-required stateless `server/discover` envelope in every exact
  external consumer; the unpublished beta.1 artifact was retired after its
  independent Convex consumer exposed legacy initialize negotiation.

## v0.8.0-beta.11

- Add the optional `better-convex-vue/mcp-app` lifecycle entry on the exact
  official MCP Apps SDK without pulling MCP dependencies into ordinary Vue.
- Prove progressive fallback, host-mediated tool and link behavior, restrictive
  iframe boundaries, exact teardown, and credential-free production bundles
  through neutral and Ginko CMS consumers.
- Repair identity-generation dispatch fencing, authentication coordination,
  query/pagination state, official-client SSR, Better Auth relationship
  semantics, read-only JWKS discovery, and raw-cause containment.
- Certify the packed Nuxt lifecycle with a complete `convex/browser` fixture
  surface after the beta.9 candidate correctly failed its production bundle
  gate.
- Coordinate Vue and Nuxt with the same clean source commit as the corrected
  MCP beta.2 candidate; the passing beta.10 pair remains immutable but is not
  reused across source commits.

## v0.8.0-beta.4

- Bind auth-schema release certification to the exact immutable Nuxt and Vue
  candidate tarballs, so unpublished companion versions never fall through to
  the public registry during packed deployment proof.

## v0.8.0-beta.3

- Settle auth-enabled anonymous Vue clients through the exact
  `convex@1.42.2` public browser-client surface, without relying on an
  unavailable `clearAuth()` method.
- Prove anonymous settlement and cross-tab realtime updates against one exact
  trusted Better Auth/Nuxt origin before rebuilding the Vue/Nuxt candidate pair.

## v0.8.0-beta.2

- Add the provider-neutral `better-convex-vue` embedded-runtime attachment used
  by separately bundled Vue applications without exposing tokens or a
  replaceable raw Convex client.
- Complete the Nuxt-to-Vue lifecycle hard cut for client ownership, identity
  fencing, queries, pagination, mutations, and actions while preserving Nuxt
  SSR and authentication behavior.
- Accept Convex's nullable terminal pagination cursor and certify the shared
  lifecycle through the Ginko Studio proving consumer.
- Render deterministic connection telemetry during Nuxt SSR before the
  client-only shared Vue runtime is installed.

## v0.8.0-beta.0

- Establish the Better Convex vNext architecture and executable implementation
  ledger without adding premature public packages or compatibility paths.
- Prove the two official-SDK MCP deployment topologies against neutral fixtures,
  including exact-call binding, canonical Convex values, OAuth bearer isolation,
  URL-interaction safety, and credential-free Vue MCP App boundaries.
- Add package-qualified, descriptor-bound release certification for artifact
  identity, production manifests, entry purity, dependency direction, SBOMs,
  maintained consumers, and runtime fingerprints while preserving the existing
  Nuxt package behavior.
- Refresh vulnerable build and protocol-laboratory transitive dependencies to
  their patched releases after the release advisory gate identified newly
  published archive, URL-parser, SVG, shell-parser, and Hono advisories.

## v0.7.0-beta.1

- Certify the installed `better-convex-nuxt/server` entry through a production
  Nitro query, mutation, and action lifecycle, including structured,
  unstructured, transport, authentication, and diagnostic-redaction evidence.
- Document safe application-owned server-call diagnostics and the runtime-only
  `ConvexCallError.cause` boundary without exposing a debug hook, raw cause,
  additional error kind, or testing API.

## v0.7.0-beta.0

- Preserve a valid local-backend startup timeout through the checked Convex CLI
  runner without treating it as deployment authority, and reject invalid
  non-positive values before starting Convex.
- Document the independent social-login, OAuth authorization-server, and
  resource-server roles, plus the deployment-wide Convex token-exchange quota
  and the application-owned authorization boundary.
- Certify the packed package through a byte-compared npm consumer, a production
  Nitro authentication lifecycle, and strengthened OAuth/MCP browser evidence.
- Resolve Convex session-token verification through the deployment-owned HTTP
  Actions JWKS route, so remote deployments can authenticate local Nuxt apps
  without requiring a public tunnel to the host origin.
- Treat credential-free browser token bootstrap as `200 { token: null }` while
  preserving `401` for malformed, expired, revoked, or unsupported credentials.
  The client and OpenAPI contracts now expose `string | null`, eliminating the
  expected anonymous request failure without weakening session validation.
- Bound every shipped cookie-to-token exchange to its H3 request and one
  ingress-authenticated client IP. Production auth now requires an explicit
  single-IP ingress header and a private Nuxt-to-Convex signing secret; the raw
  public token-exchange helper was removed so consumers cannot collapse users
  onto one Nitro egress rate-limit identity.
- Abort and quarantine active and queued uploads when the authenticated identity
  generation changes, preventing work started by one principal from publishing
  state or callbacks under the next principal.
- Enforced canonical compound uniqueness for accounts, organization members,
  and team members inside the adapter mutation, including update and concurrent
  create paths. This advances the generated schema fingerprint to v2 as a
  greenfield hard cut; do not deploy over populated v1 auth data without first
  auditing and reconciling duplicates.
- Corrected the local setup contract to use the Convex-managed `.env.local` as
  the single local deployment configuration, with Nuxt commands loading it
  explicitly instead of documenting a competing `.env` file. A checked Convex
  CLI runner now parses that authority once, rejects ambiguous selectors and
  target overrides, removes inherited Convex settings, and permits deploy only
  with a production deployment-scoped key or exact self-hosted authority.
- Expanded diagnostic redaction for common consumer-defined JWT, API-key,
  private-key, bearer, and passphrase labels.

### Authentication platform hard cut

- Replaced the legacy component dependency with one package-owned Better Auth
  component, one generated schema contract, and one adapter implementation used
  by both the packaged and advanced local-component modes.
- Added persisted-session-only Convex JWT exchange, additive JWKS rotation,
  strict same-origin proxying, database-backed rate limiting, versioned secrets,
  protected credential storage, and real-backend concurrency invariants.
- Regenerated and freshness-gated the Team and Agentic SaaS local-component
  schemas from their canonical Better Auth options; local-component consumers
  must regenerate schema and metadata together when plugin tables change. Their
  final component schemas now use those generated tables directly, so untracked
  hand-added indexes cannot diverge from the adapter descriptor. The generator
  now owns the organization membership, team membership, pending-invitation, and
  `createdAt` sort indexes used by live authorization and pagination.
- Added the constrained OAuth authorization-server beta and delegated MCP path
  with authorization code plus PKCE, exact issuer/client/resource/subject/scope
  binding, live Convex authorization, consent and revocation, and no refresh or
  dynamic-registration compatibility path.
- Added one internal, time-bounded `URL.canParse` capability fill because the
  pinned Convex isolate lacks the primitive required by the pinned official
  OAuth Provider. Real-backend evidence pins the removal trigger; this is not a
  second auth or protocol path.

### Release and verification

- Added immutable candidate artifacts, candidate-rooted SBOM and provenance
  evidence, clean-consumer verification, security sentinels, fuzzing, mutation
  testing, OAuth/MCP interoperability harnesses, and protected cloud rehearsal.
- Added safe, opt-in structured auth diagnostics and an exact-tarball
  pkg.pr.new preview workflow for black-box consumer testing before npm
  publication.
- Added an explicit destructive `external-disposable` MCP evidence mode for a
  fresh already-running preview deployment; the self-contained local fixture
  remains the default and no external lifecycle or cleanup path is inferred.
- Made exact-tarball MCP fixtures derive their isolated runtime links from the
  product and starter manifests, so workspace ancestor resolution cannot hide a
  missing production dependency.
- Removed migration documentation and every maintained legacy runtime path. This
  is a greenfield-only beta and does not migrate an existing auth database.

## v0.6.1

[compare changes](https://github.com/lupinum-dev/better-convex-nuxt/compare/v0.6.0...v0.6.1)

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

[compare changes](https://github.com/lupinum-dev/better-convex-nuxt/compare/v0.5.0...v0.6.0)

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

[compare changes](https://github.com/lupinum-dev/better-convex-nuxt/compare/v0.4.0...v0.5.0)

### 🩹 Fixes

- Remove unnecessary override for parent workspace in pnpm configuration ([7f6b2bb0](https://github.com/lupinum-dev/better-convex-nuxt/commit/7f6b2bb0))

### 💅 Refactors

- Simplify landing feature syntax in documentation ([eef25d41](https://github.com/lupinum-dev/better-convex-nuxt/commit/eef25d41))

### ❤️ Contributors

- Mat4m0 <matthias.amon@me.com>

## v0.4.0

[compare changes](https://github.com/lupinum-dev/better-convex-nuxt/compare/v0.3.4...v0.4.0)

Reconstructed from the tagged commit range and the published `0.4.0` npm
release; this section was missing from the changelog until the vNext Phase 6
repair. No new facts beyond what the commit range and the release itself
show — see the [`v0.4.0` GitHub release](https://github.com/lupinum-dev/better-convex-nuxt/releases/tag/v0.4.0)
and the [published package](https://www.npmjs.com/package/better-convex-nuxt/v/0.4.0)
for the authoritative record if this summary is ever in question.

### 🚀 Enhancements

- Export `ConvexUser` from the module entrypoint ([c78b6926](https://github.com/lupinum-dev/better-convex-nuxt/commit/c78b6926))
- Harden starters and add the MCP approval flow, including Convex Nuxt runtime
  contract hardening, SSR-safe mutation callables, extracted server auth
  snapshot/shared-query/upload-queue/paginated-query internals, unified live
  query subscriptions, and a Better Auth Organization-backed team starter
  ([6fbf0bd5](https://github.com/lupinum-dev/better-convex-nuxt/commit/6fbf0bd5))

### 🩹 Fixes

- Prepare starters and demo for the `0.4.0` release ([d18763fb](https://github.com/lupinum-dev/better-convex-nuxt/commit/d18763fb))

### ❤️ Contributors

- Mat4m0 <matthias.amon@me.com>

## v0.3.4

[compare changes](https://github.com/lupinum-dev/better-convex-nuxt/compare/v0.3.0...v0.3.4)

### 🏡 Chore

- **release:** V0.3.1 ([134fbdc](https://github.com/lupinum-dev/better-convex-nuxt/commit/134fbdc))
- Update .npmignore and nuxt.config.ts ([5133e3e](https://github.com/lupinum-dev/better-convex-nuxt/commit/5133e3e))
- Refine .npmignore to exclude additional unnecessary files ([1ad761a](https://github.com/lupinum-dev/better-convex-nuxt/commit/1ad761a))
- Bump version to v0.3.3 to fix npm release pipeline ([638c188](https://github.com/lupinum-dev/better-convex-nuxt/commit/638c188))

### ❤️ Contributors

- Mat4m0 <matthias.amon@me.com>

## v0.3.1

[compare changes](https://github.com/lupinum-dev/better-convex-nuxt/compare/v0.3.0...v0.3.1)

## v0.3.0

[compare changes](https://github.com/lupinum-dev/better-convex-nuxt/compare/v0.2.12...v0.3.0)

### 🚀 Enhancements

- Enhance permissions handling and DevTools integration ([2c3ec80](https://github.com/lupinum-dev/better-convex-nuxt/commit/2c3ec80))
- Add guard pages for pending authentication and enhance query handling ([8fd90d9](https://github.com/lupinum-dev/better-convex-nuxt/commit/8fd90d9))
- Enhance defineSharedConvexQuery with fingerprinting and duplicate key handling ([5b8e339](https://github.com/lupinum-dev/better-convex-nuxt/commit/5b8e339))
- Api polish, prepare for release ([a9fb1c3](https://github.com/lupinum-dev/better-convex-nuxt/commit/a9fb1c3))
- Api polish ([83728a5](https://github.com/lupinum-dev/better-convex-nuxt/commit/83728a5))
- Add consumer smoke test setup ([5cacd7c](https://github.com/lupinum-dev/better-convex-nuxt/commit/5cacd7c))

### 🩹 Fixes

- Enhance testing commands and improve local environment setup ([b0c2a09](https://github.com/lupinum-dev/better-convex-nuxt/commit/b0c2a09))
- Update TypeScript comment in nuxt.config.ts for clarity ([1eabe82](https://github.com/lupinum-dev/better-convex-nuxt/commit/1eabe82))
- Update CI workflow for module packing and verification ([55323c0](https://github.com/lupinum-dev/better-convex-nuxt/commit/55323c0))

### 💅 Refactors

- Auth ([157fd65](https://github.com/lupinum-dev/better-convex-nuxt/commit/157fd65))
- Enhance authentication configuration and documentation ([d09c42a](https://github.com/lupinum-dev/better-convex-nuxt/commit/d09c42a))
- Streamline Convex configuration and enhance authentication handling ([2d09cdb](https://github.com/lupinum-dev/better-convex-nuxt/commit/2d09cdb))
- Unify Convex configuration access across composables ([b78a514](https://github.com/lupinum-dev/better-convex-nuxt/commit/b78a514))
- ⚠️ Modernize Nuxt 4/Vue 3.5 runtime, harden auth proxy, and add cache-reuse recipe/demo ([7e7eb57](https://github.com/lupinum-dev/better-convex-nuxt/commit/7e7eb57))
- Update error handling and improve component structure ([6cefde9](https://github.com/lupinum-dev/better-convex-nuxt/commit/6cefde9))
- Migrate to useConvexAuth for authentication handling ([16f82c7](https://github.com/lupinum-dev/better-convex-nuxt/commit/16f82c7))
- Finish release Candidate ([a50ea1d](https://github.com/lupinum-dev/better-convex-nuxt/commit/a50ea1d))
- Split useConvexQuery => useConvexQueryLazy ([03852a9](https://github.com/lupinum-dev/better-convex-nuxt/commit/03852a9))
- Streamline Convex URL handling and improve site URL derivation ([0ff5c2f](https://github.com/lupinum-dev/better-convex-nuxt/commit/0ff5c2f))
- Update mutation handling and query arguments in playground components ([4f1c399](https://github.com/lupinum-dev/better-convex-nuxt/commit/4f1c399))
- Improve runtime configuration handling for Convex ([4d10fdc](https://github.com/lupinum-dev/better-convex-nuxt/commit/4d10fdc))

### 📖 Documentation

- Enhance documentation for HTTP-only mode in Convex queries ([b15f832](https://github.com/lupinum-dev/better-convex-nuxt/commit/b15f832))
- Update data fetching and pagination examples for reactive arguments ([d0fadb9](https://github.com/lupinum-dev/better-convex-nuxt/commit/d0fadb9))
- Enhance permissions setup and introduce upload queue functionality ([4228ae4](https://github.com/lupinum-dev/better-convex-nuxt/commit/4228ae4))
- Update import paths and enhance documentation for file storage and query handling ([6e17d3e](https://github.com/lupinum-dev/better-convex-nuxt/commit/6e17d3e))
- Enhance authentication and data fetching documentation ([1e35508](https://github.com/lupinum-dev/better-convex-nuxt/commit/1e35508))
- Update API surface documentation and generation script ([252ac6d](https://github.com/lupinum-dev/better-convex-nuxt/commit/252ac6d))
- Update query/mutation handling ([5b657bc](https://github.com/lupinum-dev/better-convex-nuxt/commit/5b657bc))
- Update mutation handling to use `execute()` instead of `mutate()` ([ae179a9](https://github.com/lupinum-dev/better-convex-nuxt/commit/ae179a9))

### 🏡 Chore

- **release:** V0.2.12 ([df71928](https://github.com/lupinum-dev/better-convex-nuxt/commit/df71928))
- Bump deps ([d8bbdbd](https://github.com/lupinum-dev/better-convex-nuxt/commit/d8bbdbd))
- Add Nuxt test-utils configuration and update dependencies ([e7c5f5c](https://github.com/lupinum-dev/better-convex-nuxt/commit/e7c5f5c))
- Update testing configurations and enhance test scripts ([78c5f0f](https://github.com/lupinum-dev/better-convex-nuxt/commit/78c5f0f))
- Polish and prepare beta ([5c03668](https://github.com/lupinum-dev/better-convex-nuxt/commit/5c03668))
- Update pnpm-lock.yaml to include @vitejs/plugin-vue ([3a95bd9](https://github.com/lupinum-dev/better-convex-nuxt/commit/3a95bd9))
- Add Playwright browser installation step in CI workflow ([d979e22](https://github.com/lupinum-dev/better-convex-nuxt/commit/d979e22))
- Update playground for new API ([3746396](https://github.com/lupinum-dev/better-convex-nuxt/commit/3746396))
- Enhance playground configuration and logging ([a288f22](https://github.com/lupinum-dev/better-convex-nuxt/commit/a288f22))
- Update project configuration and improve mutation handling ([96645b1](https://github.com/lupinum-dev/better-convex-nuxt/commit/96645b1))
- Clean up nuxt.config.ts by removing unnecessary whitespace ([62dc1d1](https://github.com/lupinum-dev/better-convex-nuxt/commit/62dc1d1))
- Update deps & format ([16e0b8f](https://github.com/lupinum-dev/better-convex-nuxt/commit/16e0b8f))
- Update dependencies and Renovate configuration ([1e7e9e0](https://github.com/lupinum-dev/better-convex-nuxt/commit/1e7e9e0))
- Prepare package version for release ([7dd3ee7](https://github.com/lupinum-dev/better-convex-nuxt/commit/7dd3ee7))

### ✅ Tests

- Improve selector logic in useConvexConnectionState behavior tests ([e7fddb2](https://github.com/lupinum-dev/better-convex-nuxt/commit/e7fddb2))
- Enhance connection state behavior tests with improved waiting logic ([b3285a7](https://github.com/lupinum-dev/better-convex-nuxt/commit/b3285a7))
- Harden dedup, permission guard, and optimistic update coverage ([6a33a8a](https://github.com/lupinum-dev/better-convex-nuxt/commit/6a33a8a))
- Add end-to-end test for plugin server misconfiguration overlay ([b33601e](https://github.com/lupinum-dev/better-convex-nuxt/commit/b33601e))

#### ⚠️ Breaking Changes

- ⚠️ Modernize Nuxt 4/Vue 3.5 runtime, harden auth proxy, and add cache-reuse recipe/demo ([7e7eb57](https://github.com/lupinum-dev/better-convex-nuxt/commit/7e7eb57))

### ❤️ Contributors

- Mat4m0 <matthias.amon@me.com>
