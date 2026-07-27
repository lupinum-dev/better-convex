# Better Convex vNext — comprehensive audit

## 1. Audit identity

### Review identity and process

- **Audit date:** 2026-07-22, Europe/Vienna.
- **Process:** primary-agent production-first review plus ten bounded, read-only specialist reviews covering architecture, Vue, Nuxt/SSR, authentication/OAuth, MCP, MCP Apps and interaction, Convex transactions, Ginko CMS, release/supply chain, and maintainability. Specialist candidates were not accepted by aggregation: the primary reviewer re-read the normative documents and independently traced every accepted High/Medium issue, public-API criticism, second source of truth, and proposed deletion.
- **Severity contract:** the severity definitions in the audit assignment were applied. Several specialist reports called release or feature failures “High”; those were downgraded where they did not provide a practical unauthorized protected effect, broad disclosure, privilege escalation, or serious artifact-integrity bypass.
- **Evidence order:** production enforcement code, exact installed dependency bytes, tests, then prior evidence and documentation. Tests and evidence files are treated as claims, not enforcement.
- **Safe execution:** local, non-credentialed probes were used for error structured cloning, MCP callback header visibility, MCP subscription lifetime, MCP legacy streaming bounds, artifact hashing, workspace alignment, ASVS evidence integrity, and bundle budget checks. No production deployment, browser account, credential, `.env*` file, HAR, browser storage, secret-bearing log, publication, tag, branch, commit, push, or external mutation was used.
- **Repository writes:** the audit's only repository write is this file.

### Better Convex authority snapshot

| Field                | Audited value                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository           | `/Users/matthias/Git/convex/better-convex-nuxt`                                                                                                 |
| Branch               | `vnext`                                                                                                                                         |
| HEAD                 | `81f6c8071b47731a3fc2ad046f0f2992e5ed165b`                                                                                                      |
| Initial working tree | clean; `## vnext...origin/vnext`                                                                                                                |
| Root package         | `better-convex-nuxt@0.8.0-beta.6`                                                                                                               |
| Vue package          | `better-convex-vue@0.8.0-beta.6`                                                                                                                |
| MCP package          | `@better-convex/mcp@0.1.0-beta.0`                                                                                                               |
| Package manager      | `pnpm@10.30.3`                                                                                                                                  |
| Exact auth tuple     | `better-auth@1.7.0-rc.1`, `@better-auth/oauth-provider@1.7.0-rc.1`, `convex@1.42.2`, `kysely@0.28.17`, `nuxt@4.4.8`, `h3@1.15.11`, `jose@6.2.3` |

The immutable baseline remains `v0.7.0-beta.1` at `a6e76f1f61a483de5dbd3a19003ab35abcf75fad`; the audit did not move or repack it.

### Ginko CMS authority snapshot

| Field                        | Audited value                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| Repository                   | `/Users/matthias/Git/workspace/ginko-cms`                                                          |
| Branch                       | `codex/better-convex-mcp-apps`                                                                     |
| HEAD                         | `7babc91570cd9e3c458a149e485a0c75e8cd2020`                                                         |
| Initial working tree         | clean                                                                                              |
| Ginko release line           | `@lupinum/ginko-cms-convex@0.2.0-rc.1` and sibling `0.2.0-rc.1` packages                           |
| Declared Better Convex tuple | Nuxt/Vue `0.8.0-beta.4`; MCP `0.1.0-beta.0`                                                        |
| Actual local resolution      | Nuxt/Vue symlinked to the audited BCN beta.6 worktree; MCP links point at a removed temporary path |
| Package manager              | `pnpm@11.13.1`                                                                                     |

This declared-versus-installed skew is material. Conclusions about Ginko production source apply to the audited checkout. Its current local test installation is not evidence for the declared beta.4/MCP tuple or for exact published bytes.

### Standards and official tooling checked

Checked on 2026-07-22 against primary sources:

| Surface                       | Status/version checked                                                                                                                                                                                                           | Audit interpretation                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP core                      | Locked `2026-07-28` release candidate in the [official RC announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) and [draft specification](https://modelcontextprotocol.io/specification/draft) | Locked on 2026-05-21; final publication was scheduled for 2026-07-28 and had not occurred. It is valid implementation input, not a basis for claiming final compliance. |
| MCP TypeScript server/client  | `@modelcontextprotocol/server@2.0.0-beta.5`, `@modelcontextprotocol/client@2.0.0-beta.5`                                                                                                                                         | Official beta SDK for the RC; exact installed bytes were read.                                                                                                          |
| Legacy MCP SDK                | `@modelcontextprotocol/sdk@1.29.0`                                                                                                                                                                                               | Used by Apps and legacy tooling; not evidence of RC-core conformance.                                                                                                   |
| MCP Apps                      | stable extension protocol `2026-01-26`; `@modelcontextprotocol/ext-apps@1.7.4`; [official Apps specification](https://apps.extensions.modelcontextprotocol.io/)                                                                  | Stable extension, but BCN's Vue wrapper and Ginko production packaging remain experimental.                                                                             |
| Conformance                   | `@modelcontextprotocol/conformance@0.1.16`; [official repository](https://github.com/modelcontextprotocol/conformance)                                                                                                           | Installed server scenarios still center on initialize-era behavior; they do not certify the locked stateless RC surface.                                                |
| Inspector                     | `@modelcontextprotocol/inspector@0.22.0`; [official repository](https://github.com/modelcontextprotocol/inspector)                                                                                                               | Compatibility observation only, not normative compliance proof.                                                                                                         |
| OAuth resource metadata       | [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)                                                                                                                                                                               | Applicable to remote protected MCP resources.                                                                                                                           |
| Authorization response issuer | [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207)                                                                                                                                                                               | The RC adds issuer-validation hardening; final client/server interoperability still requires post-final proof.                                                          |

### Scope and exclusions

The review covers current production code, public exports, exact installed dependencies where relevant, tests, evidence, release automation, package artifacts present on disk, and the checked-out Ginko proving consumer. It does not claim results from a new live Convex deployment, real OAuth browser journey, protected GitHub environment, registry publication, real ChatGPT/Claude host, or final `2026-07-28` conformance suite. Those gaps are named with executable experiments in section 13.

Both worktrees remained unchanged during review until `Audit.md` was created in Better Convex. No pre-existing dirty work was present.

## 2. Executive verdict

### Overall product assessment

The **architecture is fundamentally sound and materially better than the 0.7 shape**. The package boundary is correct: one shared Vue lifecycle implementation, Nuxt as the full-stack/SSR/auth integration, and a separate provider-neutral MCP package using the official SDK. The RFC correctly leaves roles, memberships, workflows, high-impact review, effects, and tool inventories in applications. The decision not to create a catch-all package, public core package, RBAC DSL, generic Commands product, Trusted Calls product, or workflow/approval table is also correct.

The implementation is not yet the architecture's promised final shape. One shared lifecycle invariant is inverted, the MCP transport exposes more than its safe context implies and advertises streaming behavior it cannot safely own, and Ginko currently carries both the old Nitro MCP product and the new Convex-native product. Those are hard-cut/fix issues, not evidence that the package architecture should be abandoned.

### Overall security assessment

No Critical finding survived verification. **One High finding did:** a mutation/action can be initiated by Alice, wait for authentication settlement or a Ginko frontend preflight, then be dispatched by the stable client after identity replacement as Bob. The Promise is rejected only after the backend effect may already have committed under Bob's authority. That is a practical cross-user protected-write path.

The remaining accepted security issues are Medium or Low: stale authenticated state after a Convex auth rejection, public JWKS key creation, raw credential-bearing headers exposed to MCP callbacks, an unavailable live-revocation contract in one Better Auth verifier factory, Ginko limiter concurrency, and a post-demotion asset-recovery action race. Strong controls were also confirmed: token-class separation, OAuth administrator hardening, atomic authorization-code consumption, encrypted/private JWKS handling, application-owned live membership checks, credential hashing, transaction-bound destructive operations, and token absence from general Convex function arguments.

### Overall maintainability assessment

The Vue/Nuxt extraction achieved its main maintainability goal: there is one lifecycle engine, and Ginko deleted its generic query, pagination, mutation, and action engines. Net production growth from `v0.7.0-beta.1` to this HEAD is approximately **+866 lines** across `src/**` and `packages/**` (+5,144/-4,278), despite a much larger repository-wide diff caused by moves, tests, evidence, and generated material. That is a favorable result.

The principal maintainability regressions are localized: Ginko's blanket client wrapper creates a second policy gate; Ginko runs two MCP products; Nuxt owns a handwritten Convex HTTP codec; MCP exposes a version-era callback and unsupported subscriptions; Apps exposes a raw mutable SDK object plus an option whose SDK cleanup is broken. These should be deleted or narrowed, not generalized.

### Overall release-readiness assessment

**No-go for publication from this HEAD.** There is no beta.6 candidate. The existing protected publication workflow is still Nuxt-only while the product now requires a Vue-before-Nuxt coordinated release. It has no correct path for the independently versioned MCP package. Ginko's candidate tuple omits the MCP artifact and its local installation is source-linked/broken. Five maintained starter locks are stale. Ginko CI also uses floating actions and a PR-selected upstream checkout with a private-read token.

The artifact-certification machinery itself is strong: closed descriptors, clean source binding, immutable version directories, pack-once behavior, SHA-256/SRI/content manifests/SBOM, runtime fingerprints, npm and pnpm consumers, installed-byte comparisons, and registry equality are all present. The correct fix is to make the protected workflows use this machinery; do not build a second release framework.

### Specific readiness decisions

- **Vue/Nuxt hard cut:** architecturally successful, correctness-incomplete. One engine exists, but F-001/F-002/F-004 block release.
- **MCP Phase 5:** valuable production-quality _experimental architecture_, not a production-ready package at this HEAD. Official-SDK composition, provider-neutral verification, and explicit tool/resource registration are good; F-006–F-009 must be resolved.
- **MCP Apps:** ready for continued private/proving-consumer work. Not ready for a stable public guarantee or a Ginko production claim.
- **Ginko full cutover:** no. The old Nitro stack remains, `/mcp-pilot` is always generated, tool parity is absent, abuse controls diverge, and exact artifacts are not installed.
- **Stable release:** not recommended for Vue, Nuxt, MCP, Ginko integration, or Better Convex 1.0.

### Top five actions

1. Fix callable identity binding first: capture identity generation at invocation entry, reject before dispatch if it changes during settlement, and delete Ginko's async blanket client wrapper.
2. Close the other identity/SSR gaps: fail closed on every current-client auth rejection, purge same-user Nuxt protected payload/error state by identity generation, and use the official Convex value codec/client for SSR queries.
3. Make MCP's boundary truthful: scrub credentials before the SDK callback, disable subscriptions/list-changed and legacy SSE until bounded ownership exists, and remove the live-revocation claim/factory that cannot retain provider session state.
4. Complete Ginko's hard cut: one native `/mcp`, one atomic abuse-admission path, one tool inventory, terminal action reauthorization, then delete the entire Nitro/signed-bridge stack and the pilot route/name.
5. Repair coordinated release: build/verify/publish Vue then unchanged Nuxt, give MCP its closed protected lane, repair tracked locks, add MCP to Ginko's exact tuple, and prove cold npm/pnpm installed bytes before any publication.

## 3. System and authority map

| Boundary                   | Authenticates/proves                                                                                     | Authorizes                                                                                                 | Stores/forwards                                                                                                   | Must never receive or decide                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser / Vue              | Provider adapter state and a short-lived Convex token establish the current browser identity generation. | Nothing about business roles. It gates presentation/execution only.                                        | Holds an opaque stable client handle and reactive identity snapshot.                                              | Server secrets, Better Auth secrets, service proofs, provider-private grant references, or authority inferred from UI state.                 |
| Nuxt SSR                   | Request cookies are exchanged request-locally for a Convex session token.                                | Nothing beyond selecting anonymous/optional/required transport. Backend remains authoritative.             | Request-scoped token; identity-partitioned payload; `private, no-store` response headers for authenticated state. | Module-global user state, another request's token, cacheable authenticated output, or raw upstream errors.                                   |
| Better Auth                | Browser session and optional delegated OAuth grant/client/resource state.                                | OAuth administration only through mandatory application callbacks; it does not decide CMS authority.       | Session rows, hashed delegated tokens/client secrets, encrypted private JWK material.                             | Ginko roles as token claims, MCP application policy, dynamic registration by default, or a public path that creates canonical signing state. |
| Convex browser client      | Signature/audience validation of the Convex session JWT.                                                 | Convex functions re-read application state.                                                                | WebSocket/HTTP requests and official Convex values.                                                               | MCP OAuth bearer, Better Auth cookie, replacement-client control in embedded apps.                                                           |
| Convex HTTP actions        | Fixed auth/MCP resource boundaries.                                                                      | Only the fixed boundary plus application calls; general functions authorize themselves.                    | May receive the bearer at the logical MCP resource and must terminate it there.                                   | Forwarded bearer/cookie in args, logs, diagnostics, or arbitrary callback request objects.                                                   |
| OAuth authorization server | OAuth user session, client, consent, resource, code/PKCE, and delegated token issuance.                  | Delegation ceiling, not current CMS authority.                                                             | Hashed tokens/secrets; authorization code consumed atomically.                                                    | Ordinary-user OAuth administration, refresh grant in the fixed profile, or remote plaintext origins.                                         |
| OAuth resource verifier    | Signature, `typ`, `iss`, scalar `aud`, `azp/client_id`, `token_use`, lifetime, and scope ceiling.        | It does not decide membership/role/resource access.                                                        | Returns a sanitized access context; a certified provider adapter may privately retain a session/grant reference.  | Raw token in application context; provider reference in results/diagnostics; scope treated as role.                                          |
| MCP handler                | Exact resource credential and MCP protocol request.                                                      | Protocol admission and delegated scope requirements only.                                                  | Official SDK request, explicit server, explicit tools/resources, safe context.                                    | Credential-bearing headers after authentication; general automatic Convex-function exposure; unsupported capability claims.                  |
| MCP tools/resources        | Schema-valid application operation name and arguments.                                                   | Application code must re-read current credential/member/role/tenant/resource/preconditions at each effect. | Structured content plus text fallback; coarse errors.                                                             | Raw causes, provider references, cross-tenant existence, tool-to-function auto-dispatch.                                                     |
| MCP App iframe             | Official Apps handshake and host capability negotiation.                                                 | Nothing. Buttons request ordinary MCP operations; application backend remains authoritative.               | Structured tool input/result and allowlisted host context.                                                        | Tokens, cookies, proofs, raw Convex client, final high-impact authority, untrusted HTML execution.                                           |
| Ginko application policy   | Maps current user or MCP credential to current member/role/site and operation preconditions.             | All CMS business authority, contract compatibility, OCC, review policy, and effects.                       | Canonical members, credentials, entries, operations, reviews, projections with rebuild stories.                   | Framework-owned roles/RBAC, trust in scopes alone, frontend preflight as authority.                                                          |
| Release artifacts          | Clean source commit, package identity/version/dependency tuple, hashes/manifests/SBOM/fingerprint.       | Protected workflow and human governance decide publication.                                                | One immutable tarball per package; registry bytes compared with approved bytes.                                   | Workspace links, warm-store substitution, repacking between package publication, arbitrary CI-selected package paths.                        |

## 4. Confirmed findings summary

| ID    | Severity |  Confidence | Area               | Title                                                                       | Affected package | Protected/correctness effect                                                                                          | Timing                    |
| ----- | -------- | ----------: | ------------------ | --------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| F-001 | **HIGH** |        High | Vue identity       | Callable dispatch binds identity after settlement                           | Vue, Nuxt, Ginko | Alice-started write can execute as Bob before the caller receives `IDENTITY_CHANGED`                                  | P0                        |
| F-002 | MEDIUM   |        High | Vue auth           | First/current Convex auth rejection does not fail closed                    | Vue/Nuxt         | Stale Alice authenticated snapshot/data can survive SDK auth clearance                                                | P0                        |
| F-003 | MEDIUM   |        High | Nuxt SSR           | SSR query path bypasses Convex value encoding                               | Nuxt             | Valid Convex values are corrupted or rejected only on SSR, producing hydration divergence                             | P0                        |
| F-004 | MEDIUM   | Medium-high | Nuxt hydration     | Same-user new session can consume old protected payload/errors              | Nuxt             | Old-generation protected state can render in a later session of the same subject                                      | P0                        |
| F-005 | MEDIUM   |        High | JWKS               | Public `/jwks` can create deployment signing keys                           | Nuxt auth        | Anonymous first traffic mutates canonical signing state; concurrent first requests create multiple live keys          | P0                        |
| F-006 | MEDIUM   |        High | MCP boundary       | Raw bearer and cookie headers reach application callbacks                   | MCP              | Application callbacks can read/log credentials despite the safe-context boundary                                      | P0                        |
| F-007 | MEDIUM   |        High | MCP capability     | Subscriptions/list-changed are advertised but immediately terminate         | MCP              | Clients receive a false capability and cannot observe changes reliably                                                | P0                        |
| F-008 | MEDIUM   |        High | MCP transport      | SSE escapes response size and lifetime limits                               | MCP              | Oversized or indefinitely open responses bypass nominal 1 MiB/30 s controls                                           | P0                        |
| F-009 | MEDIUM   |        High | OAuth/MCP          | Public Better Auth verifier drops provider session identity                 | Nuxt auth/MCP    | The factory cannot perform promised next-call session/client/consent revocation                                       | P1 before certification   |
| F-010 | MEDIUM   |        High | Ginko Studio       | Blanket contract preflight contradicts backend policy                       | Ginko            | Bootstrap, credential revocation, role/invitation recovery, and diagnostics can be blocked; also extends F-001's race | P0 for Ginko              |
| F-011 | MEDIUM   |        High | Ginko MCP          | No single atomic invalid-auth admission budget                              | Ginko            | Native ingress bypasses limits; Nitro ingress admits concurrent bursts beyond configured budget                       | P0 for Ginko              |
| F-012 | MEDIUM   |        High | Ginko product      | Two MCP products and misleading `mcp:false`                                 | Ginko            | Disabled configuration still generates a reachable credentialed endpoint with a different tool contract               | P0 for cutover            |
| F-013 | MEDIUM   | Medium-high | Ginko transactions | Asset-recovery actions do not reauthorize terminal writes                   | Ginko            | An actor demoted during an action can still create/restore an asset                                                   | P0 for Ginko              |
| F-014 | MEDIUM   |        High | BCN release        | Protected publication workflow is Nuxt-only                                 | Nuxt/Vue/MCP     | It cannot publish the exact dependency graph it certifies; may publish Nuxt against unavailable Vue                   | P0                        |
| F-015 | MEDIUM   |        High | Ginko release      | Candidate tuple omits MCP and local proof uses non-exact sources            | Ginko            | Candidate verification cannot certify a cold-installable release tuple                                                | P0                        |
| F-016 | MEDIUM   | Medium-high | Ginko CI           | PR-selected upstream code runs with mutable tooling/private-read credential | Ginko            | Same-repository untrusted changes or mutable actions can expose broader read authority                                | P0 before protected CI    |
| F-017 | LOW      |        High | Vue query          | `null` is both valid result and lifecycle sentinel                          | Vue/Nuxt         | Valid null results lose transform/status/previous-data semantics                                                      | P1                        |
| F-018 | LOW      |        High | Error boundary     | Native `Error.cause` survives structured clone                              | Vue/Nuxt         | A consumer posting/cloning the error can move raw cause despite documentation                                         | P1                        |
| F-019 | LOW      |        High | Ginko UI           | Asset facets query is permanently skipped                                   | Ginko            | Counts/navigation remain zero despite a valid backend query                                                           | P0 for Ginko UX           |
| F-020 | LOW      |        High | MCP Apps           | Apps wrapper overclaims cleanup/opacity                                     | Vue Apps         | SDK logs bridge payloads, resize observer cleanup is lost, and raw `App` can replace lifecycle callbacks              | P1 before stable Apps API |

## 5. Detailed confirmed findings

### F-001 — Callable dispatch binds identity after settlement

**Severity:** High
**Confidence:** High
**Status:** confirmed by production trace; current unit test explicitly expects the unsafe order
**Affected snapshot:** `better-convex-vue@0.8.0-beta.6`, Nuxt beta.6, and Ginko HEAD

**Files:** [`packages/vue/src/internal/callable-controller.ts:69`](packages/vue/src/internal/callable-controller.ts#L69), [`test/unit/callable-lifecycle.test.ts:187`](test/unit/callable-lifecycle.test.ts#L187), RFC [`internal/RFC-better-convex-vnext.md:1380`](internal/RFC-better-convex-vnext.md#L1380); Ginko `packages/cms/studio-app/src/boundary/studio-host-context.ts:36-86`.

**Invariant.** The caller's identity generation must be captured when the application starts the call. If it changes while authentication settles or any pre-dispatch work awaits, the call must reject _before_ a mutation/action is sent. A stable handle must not turn identity replacement into delegation.

**Root cause and execution path.** `run()` starts state, awaits `handlers.settle()` at line 84, captures `getIdentityGeneration()` at line 92, and only then invokes the stable handle at line 94. The stable handle points to the latest underlying client. Alice can initiate a mutation while settlement waits; the runtime replaces Alice with Bob; settlement completes; generation is captured as Bob's generation; the mutation is dispatched and authorized as Bob. The after-effect comparison at lines 96-98 sees no change and reports success. Ginko adds a second window: its `guardedConvexClient` awaits a contract-status query before invoking the stable mutation/action, so replacement during that query dispatches the effect through the new client. Even if a later generation check rejects, the backend effect may already be committed.

**Impact.** A practical unauthorized protected write under the replacement user's authority, followed by application code that may misattribute the action to the initiating UI flow. This satisfies High because the path reaches protected mutation/action effects across users.

**Why defenses/tests fail.** Stable handles correctly prevent stale client exposure, and completion fencing correctly keeps late results out of reactive state, but neither prevents dispatch. The test at lines 187-224 intentionally changes generation during settlement and expects invocation and success; it encodes the opposite of RFC line 1393.

**Smallest correct fix.** Capture `{identityGeneration, operationRevision}` before settlement. After settlement and immediately before `invoke`, require both values unchanged; otherwise throw the existing safe `IDENTITY_CHANGED` error without dispatch. Keep the post-invoke check because replacement may occur while the remote call is in flight. Delete Ginko's `guardedConvexClient`; the canonical backend contract guard already binds and enforces write compatibility. Do not add a public preflight DSL.

**Rejected alternatives.** Pinning the old raw client would avoid Bob dispatch but could send an expired Alice credential; suppressing only callbacks/state leaves the committed effect; serializing all calls globally harms concurrency and still does not define authority; a compatibility flag preserves the vulnerable path.

**Tradeoff and proof.** Calls initiated while auth is unsettled may reject and require an explicit retry after settlement. That is the correct fail-closed behavior. Add deterministic mutation and action tests for replacement during settlement and Ginko preflight, asserting zero `invoke` calls. Then run the same invariant through plain Vue, Nuxt browser, embedded cross-copy Vue, and packed production consumers. This blocks every prerelease.

### F-002 — Convex authentication rejection can leave a stale authenticated snapshot

**Severity:** Medium
**Confidence:** High
**Affected snapshot:** `better-convex-vue@0.8.0-beta.6`

**Files:** [`packages/vue/src/internal/auth-adapter.ts:144`](packages/vue/src/internal/auth-adapter.ts#L144), especially lines 192-202 and 247-253; exact `convex@1.42.2` `authentication_manager.ts` token-clear path.

**Invariant.** When the current owned Convex client rejects its token, Better Convex must synchronously retire authenticated state, increment identity generation, clear the current client, and publish a settled error/anonymous boundary exactly once.

**Root cause/path.** The callback's first `authenticated === false` builds a rejection. When confirmation is not already `done`, line 198 only rejects the confirmation Promise. `failClosed()` is called only on a later false callback. Same-session refresh calls `confirm(...).catch(() => {})`, and explicit `refresh()` merely rejects to its caller. The exact Convex SDK clears its authentication before it emits false. Better Convex can therefore retain an Alice identity snapshot and protected data while the owned SDK client has become anonymous.

**Impact.** Meaningful stale-identity presentation and split-brain call behavior. Backend authority remains fail-closed, so this is not an unauthorized write by itself, but protected state can remain visible and calls can transition unpredictably.

**Tests.** Existing tests emphasize first settlement, successful refresh, and generation transitions; they do not assert the current snapshot/data after the first SDK rejection on initial confirmation, background refresh, and explicit refresh.

**Fix/deletion.** For a false callback that still belongs to the current configuration/client/generation, invoke one idempotent fail-closed transition before settling/rejecting the Promise. Delete the `if (done)` split and the swallowed background rejection; observability may receive a sanitized error, but state transition is authoritative. Prove one generation increment, protected-query retirement, no duplicate transition on repeated false callbacks, and recovery only through an explicit later provider transition. P0.

### F-003 — Nuxt SSR queries bypass the Convex value codec

**Severity:** Medium
**Confidence:** High
**Affected snapshot:** `better-convex-nuxt@0.8.0-beta.6`

**Files:** [`src/runtime/composables/useConvexQuery.ts:58`](src/runtime/composables/useConvexQuery.ts#L58), [`src/runtime/composables/useConvexQuery.ts:205`](src/runtime/composables/useConvexQuery.ts#L205), [`src/runtime/composables/useConvexPaginatedQuery.ts:140`](src/runtime/composables/useConvexPaginatedQuery.ts#L140), [`src/runtime/utils/query-execution.ts:27`](src/runtime/utils/query-execution.ts#L27), [`src/runtime/utils/convex-shared.ts:327`](src/runtime/utils/convex-shared.ts#L327); exact `convex@1.42.2` `browser/http_client.ts` uses `convex_encoded_json`, `convexToJson`, and `jsonToConvex`.

**Invariant.** SSR and browser transports must accept and return the same Convex value domain.

**Root cause/path.** Nuxt recursively resolves every object with `Object.entries`; an `ArrayBuffer` becomes `{}`. It then `$fetch`es `{path,args}` as ordinary JSON and hand-parses `value`. BigInt cannot be JSON-serialized, NaN/Infinity become `null`, `-0` loses sign, bytes are corrupted, and encoded response values are not decoded. The official client deliberately uses Convex's codec and an encoded format.

**Impact.** Valid queries work after hydration but fail or silently change values during SSR. Identity/cache decisions may be made from different arguments, and server/client output diverges. This is a repeated correctness failure at the full-stack boundary.

**Why tests miss it.** SSR tests use JSON-native fixtures and mocked envelopes. Packed type/build tests do not exercise special Convex values through production Nitro SSR.

**Smallest fix.** Use a request-scoped official `ConvexHttpClient` with the already captured token and a bounded/aborted fetch boundary, or use only the official public codec and exact HTTP contract if the official client cannot meet request bounds. Delete `parseConvexResponse` and the handwritten envelope/argument serializer. Add packed Nitro SSR/hydration vectors for BigInt, bytes, NaN, Infinity, `-0`, nested values, structured `ConvexError`, abort, timeout, and response size. P0.

### F-004 — Same-user new sessions can consume old protected Nuxt payload state

**Severity:** Medium
**Confidence:** Medium-high
**Affected snapshot:** Nuxt beta.6

**Files:** [`src/runtime/utils/convex-cache.ts:27`](src/runtime/utils/convex-cache.ts#L27), [`src/runtime/composables/useConvexQuery.ts:115`](src/runtime/composables/useConvexQuery.ts#L115), [`src/runtime/composables/useConvexPaginatedQuery.ts:96`](src/runtime/composables/useConvexPaginatedQuery.ts#L96), [`src/runtime/plugin.auth.client.ts:52`](src/runtime/plugin.auth.client.ts#L52).

**Invariant.** A new identity generation must not hydrate or re-seed protected data/errors produced by an old generation, even when the stable subject/identity key is the same.

**Root cause/path.** Nuxt payload keys contain auth mode and identity key, not generation. Client composables accept payload data/errors before the live Vue controller owns the query. The auth plugin clears Nuxt data only in its `anonymous` callback. The existing `purgeConvexIdentityPayloadKeys()` scans both payload data and state but is unused. If Alice's session N SSR payload remains and session N+1 is established for Alice—potentially with changed active tenant/role—a late-mounted composable uses the same key and can render N's data/error without observing a generation transition after mount.

**Impact.** Bounded same-subject stale protected-state disclosure/correctness, particularly when application policy changed between sessions. Cross-subject partitioning remains intact.

**Fix/deletion.** On every identity-generation transition, invoke one app-global purge of `required`/`optional` Nuxt payload data and the query-error state; retain `auth:none`. Reset already-mounted hydrated error projections. Do not put generation into persistent payload keys unless evidence shows purge cannot be made reliable; that would grow cache cardinality. Delete duplicate/manual purge paths and the currently unused helper after wiring one owner. Prove same-user replacement before and after mount, different tenant/role, hydration error, pagination seed, anonymous data preservation, and concurrent SSR isolation. P0.

### F-005 — Anonymous `/jwks` traffic can create canonical signing keys

**Severity:** Medium
**Confidence:** High
**Affected snapshot:** Nuxt auth beta.6 with Better Auth 1.7.0-rc.1

**Files:** [`src/runtime/convex-auth/plugin.ts:109`](src/runtime/convex-auth/plugin.ts#L109), [`src/runtime/convex-auth/jwks-rotation.ts:127`](src/runtime/convex-auth/jwks-rotation.ts#L127), [`src/runtime/server/api/auth/jwks.ts:1`](src/runtime/server/api/auth/jwks.ts#L1); exact Better Auth JWT `createJwk`/adapter fallback.

**Invariant.** Canonical deployment signing state is created/rotated only through the internal operator mutation described by `SECURITY.md`; credential-free metadata reads and token signing must fail closed when no key was provisioned.

**Root cause/path.** BCN requires `options.adapter.createJwk` to be undefined, then installs only `getJwks`. In the exact upstream plugin, an empty key set causes `/jwks` and signing to call upstream `createJwk`; with no adapter override, the internal adapter inserts the generated row. A bounded in-memory reproduction showed one anonymous GET creates a key; twelve concurrent initial GETs create twelve live rows.

**Impact.** Anonymous traffic mutates a load-bearing trust root and can cause a fresh-deployment key stampede/operational ambiguity. It does not disclose private key material or permit attacker-chosen key bytes, so Medium—not High—is appropriate.

**Why tests miss it.** Tests verify option shape, operator rotation, public serialization, and grace periods, but not the empty-store public route or first-sign race against exact upstream behavior.

**Smallest fix.** Install an explicit fail-closed `createJwk` adapter sentinel in normal runtime. The internal operator rotation helper should temporarily use its narrowly scoped commit callback; public read/sign paths encountering zero keys return a static configuration failure. Adjust the construction assertion to require the sentinel identity. Do not add a second key table, public initializer, or “auto repair.” Prove zero writes from empty `/jwks` and token-sign requests, concurrent public requests, one atomic operator winner, retained-key verification, and packed live rotation. P0.

### F-006 — Credential-bearing HTTP headers reach MCP application callbacks

**Severity:** Medium
**Confidence:** High
**Affected snapshot:** `@better-convex/mcp@0.1.0-beta.0` source at audited HEAD with server beta.5

**Files:** [`packages/mcp/src/handler.ts:73`](packages/mcp/src/handler.ts#L73), [`packages/mcp/src/transport.ts:15`](packages/mcp/src/transport.ts#L15); exact SDK request-extra construction.

**Invariant.** After the MCP resource boundary authenticates a bearer, application `createServer` and tool/resource callbacks receive only sanitized access context and protocol data. Raw Authorization, Cookie, and proxy credentials terminate at the boundary.

**Root cause/path.** Authentication reads `request.headers.authorization`; `prepareBoundedMcpRequest` copies every header except `content-length`; the official handler installs the resulting Request in callback `extra.http.req`. An executable exact-SDK probe read both `Authorization: Bearer ...` and `Cookie: ...` from a registered tool callback.

**Impact.** Application or third-party callback code can accidentally log, serialize, or reuse credentials. The token is not placed in Convex function arguments by BCN itself, but the safe access abstraction is bypassable.

**Why tests miss it.** Existing tests check that `extra.http.authInfo` is absent and scan arguments/results/diagnostics. They do not inspect `extra.http.req.headers` inside the callback.

**Smallest fix.** After verification and before constructing the official SDK request, create a new header set that removes `authorization`, `cookie`, `proxy-authorization`, and other credential headers while preserving required MCP routing/version/content headers. Continue passing sanitized `McpAccessContext` separately. Do not fork or wrap every tool callback. Add callback-level source and packed tests with unique sentinels and assert absence from request objects, args, results, diagnostics, logs, App messages, and bundles. P0.

### F-007 — MCP advertises subscriptions that its request lifecycle immediately closes

**Severity:** Medium
**Confidence:** High
**Files:** [`packages/mcp/src/handler.ts:94`](packages/mcp/src/handler.ts#L94), exact server beta.5 list-change/subscription implementation.

The handler creates a new official SDK handler/server per HTTP request and closes it in `finally` at lines 99-103. The SDK advertises `tools.listChanged` for registered tools and supports listen/subscription requests, but that bus belongs to the just-created handler. An official beta.5 client observed `tools.listChanged: true`, received a subscription acknowledgement, and then immediate completion when the handler closed.

This violates capability truthfulness and can make clients cache a stale tool list or rely on updates that can never arrive. It is not cross-request data leakage because no state survives; the failure is the opposite.

**Fix/deletion.** For the stateless RC profile, disable list-changed/subscription capability and reject/return zero duration for subscription requests until the final SDK exposes a truthful stateless cache/notification strategy that BCN actually owns. Prefer finite modern JSON responses. Do not add a distributed subscription registry, session store, or background bus absent a real consumer requirement. Prove discovery/list capabilities, listen rejection, and client cache behavior with the official beta/final client and packed handler. P0.

### F-008 — SSE responses bypass size and request-lifetime enforcement

**Severity:** Medium
**Confidence:** High
**Files:** [`packages/mcp/src/transport.ts:33`](packages/mcp/src/transport.ts#L33), [`packages/mcp/src/transport.ts:51`](packages/mcp/src/transport.ts#L51), [`packages/mcp/src/handler.ts:94`](packages/mcp/src/handler.ts#L94).

`boundMcpResponse` returns event streams without reading or counting them. `runMcpRequestDeadline` stops its timer once a `Response` object is returned, not when its stream completes. A legacy SDK probe returned 1,100,000 text characters as 1,100,096 response bytes despite the nominal 1 MiB maximum. A never-resolving tool returned HTTP 200/SSE in about 21 ms while the body remained open indefinitely, after the 30-second timer had been cleared.

An unauthenticated attacker cannot reach the tool path, but any valid low-privilege credential can consume connection/memory/output resources beyond the documented boundary. This is a nontrivial bounded DoS/control-bypass issue.

**Fix/deletion.** The smallest product-aligned solution is to reject the legacy SSE mode and subscriptions for this stateless handler and serve finite, bounded modern responses. If legacy streaming is an unavoidable support requirement, enforce cumulative bytes, per-message bytes, total lifetime, abort propagation, and concurrency before advertising it. Do not call a response bounded merely because its headers were bounded. Add oversize, never-settling, slow-chunk, abort, and concurrent-stream exact-client tests. P0.

### F-009 — Better Auth MCP verifier cannot support its live-revocation contract

**Severity:** Medium
**Confidence:** High
**Files:** [`src/runtime/convex-auth/oauth-resource.ts:105`](src/runtime/convex-auth/oauth-resource.ts#L105), RFC [`internal/RFC-better-convex-vnext.md:701`](internal/RFC-better-convex-vnext.md#L701) and lines 792-809; maintained starter [`starters/mcp-oauth-agent/convex/mcp.ts:240`](starters/mcp-oauth-agent/convex/mcp.ts#L240).

`verifyOAuthBearerToken()` returns a private `sessionId`. The public `createBetterAuthMcpAccessVerifier()` projects only issuer, subject, client ID, resource, scopes, and expiry. No later callback can recover the provider-owned session reference, so the factory cannot implement immediate Better Auth session/client/consent checks. A deleted provider session can remain accepted until the self-contained token's ten-minute expiry if an application uses only this factory and checks its own membership state.

The maintained starter avoids the defect by closing over the full verified principal request-locally and serializing `sessionId` only into its internal authorization chain. That proves the correct boundary, not the public factory.

**Fix/deletion.** Remove/deprecate the factory before stabilizing it. Keep low-level strict token verification. If a Better Auth adapter is admitted, it must own request-local private provider state and expose a certified live-check hook behind the verifier without adding the provider reference to `McpAccessContext`. External/offline verifiers must explicitly promise only expiry-bounded provider revocation while still requiring live application authorization. Do not expose `sessionId` publicly. Proof must revoke session, client, consent, membership, role, and application credential independently and assert the very next applicable effect fails for the certified Better Auth profile. P1, but P0 if current docs/evidence claim that profile today.

### F-010 — Ginko's blanket contract preflight contradicts canonical backend policy

**Severity:** Medium
**Confidence:** High
**Files:** Ginko `packages/cms/studio-app/src/boundary/studio-host-context.ts:36-86`, `packages/convex/src/functions.ts:78-101,272-327`, `packages/cms/studio-app/src/Layout.vue:43,107-117`, `packages/convex/src/members.ts:195-212`.

Ginko wraps every stable mutation/action in an async `getInstalledContractStatus` query. The component deliberately allows a closed whitelist of contract-bypass control-plane writes during missing/mismatched/transition-locked contracts: owner bootstrap, member/role/invitation repair, MCP credential create/revoke, diagnostics, and agent-run cleanup. The wrapper blocks those operations before the authoritative mutation can apply its explicit policy. Owner bootstrap is one direct production example.

This can make the system unrecoverable from the exact contract state where the backend preserved recovery/security controls. It also adds a network round trip to every write and creates F-001's second dispatch-after-replacement window. The existing test asserts blanket blocking rather than the backend distinction.

**Fix/deletion.** Delete `guardedConvexClient` and the Studio-wide transport policy. Generated host facades already bind expected hashes, and terminal component functions enforce the canonical policy atomically. Keep contract status for presentation and map structured backend failures. Prove bypass operations succeed during mismatch, ordinary content writes fail, uploads fail before byte transfer through their existing guarded session mutation, and writes lose one redundant query. Do not add per-function frontend metadata or an authorization DSL. P0 for Ginko.

### F-011 — Ginko has no single atomic invalid-auth admission budget

**Severity:** Medium
**Confidence:** High
**Files:** Ginko `packages/cms/src/server/mcp/_shared/request-auth.ts:133-176`, `packages/convex/src/mcpAuthLimiter.ts:7-133`, `packages/cms/templates/convex/ginkoCms/mcpPilot.ts:28-57`, `packages/convex/src/mcpHandler.ts:69-133`.

The old Nitro path reads a failure budget, performs credential resolution, then records failure in a separate mutation. Five concurrent invalid requests all observe admission and return 401; only the next request gets 429—behavior the current test explicitly expects. The new `/mcp-pilot` path hashes and resolves every bearer with no limiter at all. Convex OCC keeps counters consistent but cannot close a query→credential lookup→record gap.

An attacker can send a simultaneous burst or use the native route to exceed the configured five-per-credential and thirty-per-IP authentication work budget. The concrete effect is a security-control bypass and avoidable Convex cost/availability load; no credential guess or protected write follows from it.

**Fix/deletion.** As part of the one-route hard cut, create one application-owned mutation that checks bucket state, resolves the hashed credential, records an invalid attempt, and returns either sanitized access, invalid, or limited in one transaction. Reuse it at the only ingress. Delete `checkFailureBudget`, the split Nitro middleware path, and the pilot's direct resolver. Do not put Ginko rate policy into `@better-convex/mcp`. Execute high-concurrency invalid-IP/credential tests against a real deployment and assert bounded credential lookups and `429`. P0 for Ginko cutover.

### F-012 — Ginko currently ships two MCP products and `mcp:false` disables only one

**Severity:** Medium
**Confidence:** High
**Files:** Ginko `packages/cms/src/module.ts:191-200,263-281,364-413`, `packages/cms/src/module/convex.ts:34-63`, `packages/cms/templates/convex/http.ts:5-12`, `packages/cms/src/server/mcp/index.ts:1-10`, and `packages/cms/src/server/mcp/_shared/handler-tools.ts:16-38`.

The old Nitro `/mcp` stack has middleware, a signed caller bridge, `/mcp/code`, and 21 tools. The new Convex-native `/mcp-pilot` has three tools and is unconditionally included in generated Convex files/routes. The Nuxt option defaults to `mcp:false`, reports MCP disabled, and only gates the Nitro registration. A consumer can therefore disable MCP yet deploy a reachable native endpoint; previously issued application credentials remain usable there. The two routes also expose different tool/auth/error contracts.

This is a product security-control/configuration mismatch and a second source of protocol truth, not an unauthorized bypass of credential checks. It must be fixed before calling the Ginko pilot a cutover.

**Fix/deletion.** Decide one enablement meaning: either the route is explicitly registered or active credentials are the sole enablement. Then hard-cut to one Convex-native `/mcp` and one explicit tool inventory. Delete `packages/cms/src/server/mcp/**`, `packages/cms/src/server/middleware/mcp-auth.ts`, `/mcp/code`, `@nuxtjs/mcp-toolkit`, `mcpCaller` signed bridge plumbing, `GINKO_CMS_MCP_SERVER_SECRET`, and every `mcpPilot` compatibility name after parity. Prove one route, one exact `tools/list`, chosen disabled semantics, and absence searches. P0 for full Ginko cutover.

### F-013 — Ginko asset-recovery actions authorize before awaits but not at terminal mutation

**Severity:** Medium
**Confidence:** Medium-high
**Files:** Ginko `packages/convex/src/assetRecovery.ts:152-220,223-311,399-431,503-561`.

`createAssetRecoveryArtifact` and `restoreAsset` resolve an authorized app identity at action start, perform queries/storage/hash work, then call internal terminal mutations. Those mutations recheck contract/storage/data invariants but accept a captured `appIdentityId` and do not re-read current membership or `canManageAssetRecovery`. Sibling upload/replacement/purge terminal mutations do reauthorize.

An owner can start restore/export, be removed or demoted while storage work awaits, and still create the recovery artifact or insert the restored asset afterward. This is a bounded post-revocation protected write by an initially authorized actor.

**Fix/deletion.** Pass the canonical caller context—not an authoritative identity string—to the terminal mutation, re-resolve current member/role and the operation guard in that transaction, and use the resulting current identity for attribution. Reuse the existing caller/guard infrastructure; do not add a job or approval table. Prove demotion/removal between storage completion and mutation dispatch, transaction failure cleanup, and authorized success. P0 for Ginko release.

### F-014 — Protected publication is still Nuxt-only

**Severity:** Medium
**Confidence:** High
**Files:** [`scripts/package-candidate-set.mjs:9`](scripts/package-candidate-set.mjs#L9), [`scripts/prepare-candidate-set.mjs`](scripts/prepare-candidate-set.mjs), [`.github/workflows/publish-prerelease.yml:47`](.github/workflows/publish-prerelease.yml#L47), lines 113, 154, 212, and 225.

The closed candidate-set code correctly models Vue then Nuxt and freezes both artifacts. Root Nuxt depends exactly on Vue beta.6. The protected tag workflow hard-codes `--package nuxt` four times, runs only `release:artifact`, uploads/verifies one set, and publishes one Nuxt tarball. It has no closed MCP publication path. Since Vue beta.6 is not in the registry, the workflow cannot produce the intended pair; even a manually unblocked Nuxt publish would reference an unavailable dependency.

This is a release correctness blocker rather than artifact substitution: the workflow fails or publishes an unusable dependency graph, while the per-artifact integrity controls remain strong.

**Fix/deletion.** Replace the Nuxt-only path with the existing closed candidate-set path. Verify both; publish Vue; compare registry bytes; install the unchanged Nuxt candidate against registry Vue; publish/compare Nuxt; move shared tags last. Add a separate statically selected MCP lane. Delete the old single-Nuxt tag path rather than keeping two publication systems. Prove clean runner, empty caches, protected staging, immutable candidates, registry equality, failure preservation, and audited tag==source commit. P0.

### F-015 — Ginko candidate evidence omits MCP and is presently source-linked

**Severity:** Medium
**Confidence:** High
**Files:** Ginko `packages/cms/compatibility.json:3-24`, `packages/convex/package.json:57-64`, `scripts/candidate-pack.mjs:21-25,160-199`, `scripts/package-e2e.mjs:129-144,368-380,517-552`.

Ginko publishes a dependency on `@better-convex/mcp@0.1.0-beta.0`, but its release stack/artifact record includes only Content, Nuxt, and Vue. Candidate packing never copies MCP; candidate E2E later unconditionally calls `findTarball('better-convex-mcp')`, so a clean candidate fails. Locally, Nuxt/Vue resolve via a sibling worktree at beta.6 despite beta.4 manifests, MCP links point to a deleted temporary directory, the lock uses a different Git snapshot, and the App builder aliases current sibling source.

The current tests can therefore pass portions of source behavior while the declared/candidate bytes are absent or different. That meets Medium's “release evidence can certify materially different behavior” criterion.

**Fix/deletion.** After MCP runtime fixes, build a new exact MCP artifact/version and add its version, source commit, SHA-256, and tarball to Ginko's compatibility record and candidate pack. Remove the Git override and source aliases. Run fresh npm and pnpm consumers with isolated stores, assert lock references and installed-byte equality for all Better Convex artifacts, then production Vite/Nitro/Convex/App proof. Do not label workspace-link/source fixtures release evidence. P0.

### F-016 — Ginko PR CI combines mutable tooling, PR-selected upstream code, and private-read credentials

**Severity:** Medium
**Confidence:** Medium-high
**Files:** Ginko `.github/workflows/ci.yml:3-110`.

The workflow runs on `pull_request`, uses floating action major tags, installs `corepack@latest`, reads upstream commit IDs from PR-controlled `compatibility.json`, checks those repositories out with `LUPINUM_CI_REPO_READ_TOKEN || github.token`, retains checkout credentials by default, then installs and executes package scripts. Fork PRs normally do not receive the secret, but same-repository untrusted branches, a mutable action compromise, or an overly broad token can expose private repository read authority.

**Fix/deletion.** SHA-pin actions, pin Corepack to the committed toolchain, set `persist-credentials:false`, separate untrusted PR checks from any private-read credential, and allow protected upstream-candidate execution only after approval for commits reachable from reviewed refs. Narrow the PAT to the exact read-only repositories or eliminate it once public exact artifacts are the release input. Add permissions tests/static workflow governance. P0 before this workflow is treated as protected release evidence.

### F-017 — `null` is both a query result and an internal sentinel

**Severity:** Low
**Confidence:** High
**Files:** [`packages/vue/src/internal/query-controller.ts:100`](packages/vue/src/internal/query-controller.ts#L100), lines 120, 153-164, and 269-299; Nuxt hydration [`src/runtime/composables/useConvexQuery.ts:134`](src/runtime/composables/useConvexQuery.ts#L134).

The controller uses `RawT | null` to mean “no settled value,” resolves teardown with `null`, and treats `raw == null` as absent. A valid Convex query returning `null` therefore does not run transforms, is not retained as previous data, and can be replaced by `initialData` during hydration. No cross-user effect follows because isolation tags are otherwise correct.

Use an internal unique symbol/tagged settled state and track payload-key presence separately from value. Delete `hydrated ?? initialData` semantics in favor of `Object.hasOwn`. Prove valid `null` through source, SSR, hydration, keep-previous-data, transform, refresh, and packed consumers. P1.

### F-018 — `ConvexCallError.cause` survives structured clone

**Severity:** Low
**Confidence:** High
**Files:** [`packages/vue/src/errors.ts:57`](packages/vue/src/errors.ts#L57), especially lines 72-95 and the corresponding error documentation.

The cause is non-enumerable and omitted from `toJSON()`/custom inspect, which correctly protects JSON and console output. The comment additionally claims structured-clone invisibility. On the audited Node 24 runtime, both `structuredClone(error)` and `MessageChannel` preserved the native Error cause, including a sentinel raw body. No shipped BCN path was found that posts the error object, so this is a consumer-misuse/documentation boundary—not a current disclosure channel.

Do not use the native `Error` cause slot for potentially sensitive upstream objects. Store debugging cause in a module-private WeakMap with a server-only inspector, or remove raw cause entirely from the framework-neutral error. Preserve JSON/inspect redaction. Add structuredClone/postMessage/worker/SSR-payload/console tests. P1 before promising safe cross-realm errors.

### F-019 — Ginko asset facets query is always skipped

**Severity:** Low
**Confidence:** High
**Files:** Ginko `packages/cms/studio-app/src/composables/useCmsStudioQuery.ts:121-151` and `packages/cms/studio-app/src/composables/internal/useStudioAssetFinder.ts:135-170`.

`useCmsStudioQuery` converts `undefined` args to `'skip'`; the sole facets call omits args. It never subscribes and the UI permanently uses zero/empty fallback counts. Pass `{}` and make the wrapper's argument required so the failure cannot compile again. Do not add a facets cache/projection—the current bounded backend calculation is the simpler source of truth. Add a mounted behavior and type-contract test. Fix during Ginko P0 work, but severity remains Low under the audit's security/correctness scale.

### F-020 — Vue MCP Apps wrapper overclaims cleanup and boundary opacity

**Severity:** Low
**Confidence:** High
**Files:** [`packages/vue/src/mcp-app.ts:21`](packages/vue/src/mcp-app.ts#L21), exact `@modelcontextprotocol/ext-apps@1.7.4` `dist/src/app.js`.

Three issues share one premature-public-wrapper root:

1. The exact SDK logs parsed/sent bridge messages with `console.debug` and ping with `console.log`; there is no logger option. Ordinary tool inputs/results can therefore be duplicated into the host console.
2. SDK `setupSizeChangedNotifications()` returns a `ResizeObserver.disconnect()` cleanup, but `connect()` discards it. BCN's public `autoResize` option enables a listener it cannot retire reliably.
3. BCN returns the raw mutable `App`. A consumer can replace `onteardown`/`onerror`, call `close`, or otherwise invalidate the wrapper's “exact-once lifecycle” guarantee.

No credential was found in the App payload, source validation comes from the official transport, and result projections are cloned; this is not a credential/iframe compromise. Keep the entry experimental, remove `autoResize` until upstream owns cleanup, narrow the returned operations or narrow the guarantee, and obtain an upstream no-logging/logger control. Prove sentinel absence from console, exact-one observer/listener disposal, reconnect/unmount, malicious host/result data, and production bundle. P1 before stable Apps API.

## 6. Product and architecture findings

### The target package architecture is the right one

The review does **not** recommend returning to a Nuxt-only package or replacing vNext with a universal framework package. The smallest defensible product remains:

```text
better-convex-vue
  shared browser lifecycle and Vue integration

better-convex-nuxt
  Vue integration plus Nuxt SSR, server calls, auth proxy and token exchange

@better-convex/mcp
  provider-neutral, official-SDK-backed MCP server building blocks
```

The root Nuxt package should continue to consume the exact Vue package. The lifecycle source island is substantially real: Nuxt no longer carries a second query/pagination/callable engine, and the shared code does not import Nuxt, Nitro, H3, Better Auth, server code, or MCP. F-001 is a broken invariant in that shared engine, not evidence for duplicating it again.

The decision to keep `@better-convex/core` private is correct. There is not yet a third framework consumer or a stable low-level contract that would justify making internal controller types permanent. A public core package now would freeze implementation seams and increase coordinated-release cost without giving an application a supported capability it cannot already obtain through Vue or Nuxt.

### Product ownership boundaries are generally correct

The RFC's most important product choice survived the audit:

- Better Convex owns client identity provenance, lifecycle fencing, protocol transport, bounded parsing, redaction, OAuth resource-server verification, and exact-artifact proof.
- Applications own roles, membership, capability meaning, tool inventories, canonical jobs, review records, destructive effects, and current-state authorization.
- Official SDKs own MCP and extension wire formats.

Ginko's strongest backend paths follow this model. Membership and role are loaded from canonical state at the effect; API credentials are random and stored as hashes; destructive preview/execute flows bind principal, arguments and canonical version and execute transactionally. These controls should be reused, not generalized into a Better Convex RBAC, Commands, workflow, or approval product.

F-010 and F-013 show the consequence of violating the boundary in the other direction: a generic frontend preflight became more restrictive than canonical backend policy, while an action trusted a pre-await authorization result for a later write. The repair is to remove the frontend authority claim and recheck application authority at the transaction, not to add another shared authorization system.

### Public API admission assessment

| Surface                                                  | Recommendation                                     | Reason/evidence                                                                                                               | Required deletion or gate                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Vue query, pagination, mutation and action composables   | **Keep, fix before next beta**                     | They solve general Vue lifecycle problems and are used by Nuxt and Ginko; identity fencing is the differentiator.             | Correct F-001/F-002/F-017 and low pagination cases before certification.                                   |
| Opaque embedded Vue runtime                              | **Keep experimental, then stabilize**              | It lets an embedded app reuse host identity without receiving a token.                                                        | Prove app-root ownership/unmount and same-user generation changes; keep raw tokens/client replacement out. |
| Nuxt SSR/auth/server integration                         | **Keep**                                           | It is genuinely Nuxt-specific and has no sensible home in plain Vue.                                                          | Correct F-003/F-004/F-005 and preserve request isolation.                                                  |
| `@better-convex/mcp` explicit tool/resource API          | **Keep beta**                                      | A neutral and Ginko consumer need the same official-SDK boundary.                                                             | Fix F-006–F-009; certify exact tarball and final spec before stable.                                       |
| `ConvexMcpRequestContext.era`                            | **Delete**                                         | An SDK/spec lifecycle label is not application input and creates compatibility pressure.                                      | Remove the callback field/extra callback argument before stable.                                           |
| Public Better Auth MCP verifier factory                  | **Redesign or remove**                             | Its input discards the session identifier needed for its stated live-revocation behavior (F-009).                             | Expose only a contract that can be honored; do not synthesize a session projection.                        |
| Vue MCP Apps wrapper                                     | **Experimental only**                              | Useful progressive UI primitive, but exact SDK logging and cleanup defeat current guarantees (F-020).                         | Narrow API and guarantees; real-host/different-origin proof before stable.                                 |
| Preconfigured bearer verifier                            | **Experimental pending a second neutral consumer** | Ginko is the only material production-shaped consumer; stabilizing it now would encode one transition path.                   | Prove a materially different verifier or delete from stable surface.                                       |
| URL interaction/review projection                        | **Private proof now; no stable export yet**        | The locked RC supplies a credible negotiated input-required mechanism, but final wire behavior and clients are not certified. | Reconcile with final spec and two clients; Better Convex must not own review state.                        |
| Tasks extension                                          | **Remain blocked**                                 | Entry gates in the RFC are not met and structured status is currently sufficient.                                             | No code, tables, compatibility layer, or public API until every gate is evidenced.                         |
| Universal principal/RBAC/Commands/Trusted Calls packages | **Reject**                                         | They erase provenance or duplicate application authority/workflow state.                                                      | Preserve direct application guards and exact-call mapping.                                                 |
| Svelte or catch-all `better-convex` runtime              | **Reject for this line**                           | No proven consumer and would prematurely freeze the private lifecycle island.                                                 | Reassess only after Vue/Nuxt are stable and a real third framework exists.                                 |

### The selected MCP topology remains provisional but rational

The Convex-native official-SDK topology is the smaller product when it passes runtime constraints: one public endpoint, application functions beside canonical state, and no separate service-call assertion protocol. The earlier Nitro-native laboratory remains valuable engineering evidence, especially its exact-call binding and canonical-argument work, but it should be archived as a decision artifact rather than shipped as a peer topology. Supporting both would double parsing, authentication, deployment, diagnostics, and conformance surfaces.

The proviso matters. The selected topology is acceptable only while the official SDK and required crypto execute without a Better Convex protocol fork. F-007 and F-008 show that copying stream-shaped SDK capabilities into a per-request Convex action without owning their lifetime is not acceptable. The near-term product should be honest and unary: tools, resources, structured results, OAuth challenges, and bounded JSON. Advertised subscription/list-change or streaming capability must be deleted until a durable topology can implement it.

### Architecture decisions to preserve

1. Preserve a single Vue lifecycle implementation and hard-cut defects there.
2. Preserve identity key **and** monotonically changing identity generation; capture generation before any await that can change dispatch identity.
3. Keep user authentication, OAuth access-token verification, service/bearer verification, and anonymous access as provenance-specific inputs. Do not flatten them into a universal principal token.
4. Keep ordinary writes ordinary. Use application-owned review only for genuinely high-impact operations.
5. Keep exact application-call mapping explicit; never auto-expose Convex functions as MCP tools.
6. Keep authorization out of token roles/scopes alone; re-read canonical state for every effect.
7. Keep one MCP topology after the laboratory decision. Archive losing evidence; delete losing production code.
8. Keep coordinated packages a closed candidate set with independent artifact identities.

## 7. Ginko CMS assessment

### Overall verdict

Ginko is a valuable proving consumer because it stresses embedded Vue lifecycle, public and authenticated reads, ordinary writes, destructive review, OAuth/MCP, large pagination, assets, and an MCP App. It should remain a consumer that can reject a weak generic primitive, not the domain model for Better Convex.

The backend security foundation is stronger than the current packaging state. Canonical membership, role and credential checks are live on core effects; API credentials are hash-only; invitations use random tokens and atomic acceptance; bootstrap and last-owner protection are transactional; derived projections are labeled and generation-fenced; destructive operation confirmation is bound and revalidated. Those are application controls worth preserving.

The current branch is **not ready for a production MCP cutover**. It contains two materially different MCP products, misleading disablement, non-atomic ingress limiting, two terminal asset-recovery authorization races, source-linked candidate evidence, and a CI trust-boundary problem. The correct next move is a hard cut after parity proof, not another bridge layer.

### Required Ginko hard cut

The end state should contain one Ginko MCP endpoint and one tool/resource contract. The Convex-native endpoint must prove the complete supported read and ordinary-write behavior, current application authorization, OAuth challenge/revocation, bounded failures, and exact installed Better Convex MCP artifact. Then delete the legacy Nitro MCP server, its middleware assertion bridge and its Convex caller. The audited legacy surface is more than 2,200 production lines before tests; retaining it “for fallback” would create a permanent second authority and protocol surface.

The `mcp:false` setting must mean no Ginko MCP endpoint is generated. If a separately named experimental pilot is needed during proof, it must require explicit opt-in, be impossible to confuse with production disablement, and be deleted during the hard cut. Do not preserve a second route under a compatibility alias.

### Application authorization changes

- Remove the blanket Studio contract preflight from calls whose canonical backend policy intentionally permits recovery, bootstrap or control-plane access. Keep contract compatibility checks where the specific domain operation actually requires them.
- Capture the Better Convex identity generation before any Ginko `beforeExecute`/preflight await, or preferably remove the duplicate wrapper once F-001 is fixed centrally.
- In asset export/restore, pass a caller context to the terminal mutation and re-resolve current membership/role and operation guard in that transaction. Do not accept an identity string produced before object-storage awaits as authority.
- Implement one canonical atomic invalid-auth admission rule shared by the selected ingress. A database transaction must claim the attempt and decide allowance together; no in-memory/per-route peer limiter or second table is needed.
- Treat frontend capability/contract state as presentation only. Backend functions remain the sole effect authority.

### Studio lifecycle and deletion opportunities

Ginko retains redundant application-level observers despite using the shared Better Convex engine. Query and mutation wrappers repeatedly instantiate CMS auth/access state; the audited Studio has at least 37 query and 12 callable wrapper sites. Consolidate this into one app-scoped auth snapshot and one canonical access query, provided to thin domain wrappers. Do not add another generic controller.

The upload queue fences presentation state using a principal key, not the Better Convex identity generation/auth epoch. A same-user replacement can therefore let old completion update the new session's UI. Bind UI completion to the shared generation and reauthorize terminal backend writes as above.

The embedded Studio has a host-attachment path but no strong owner proving exactly-once unmount/remount of that runtime across host lifecycle changes. Add one app-root owner and make individual composables consumers, not owners. Prove two roots, unmount, remount, same-user generation change, Alice-to-Bob, and no lingering subscription/client callback.

### Ginko public API and maintainability corrections

The CMS Nuxt transport publicly exports a process-global `setNuxtMcpTestClientFactory`. It mutates module state used by every request and only tests consume it. Remove the public export and global state; test an explicit injected caller in a fixture or the real route. A process-global test override in credentialed request code is not a maintainable product API.

The 1,121-line Ginko schema is now the second large manual ownership map and is absent from its size governance. Split table maps by existing domain folders and compose one canonical `defineSchema`; do not introduce schema registries or generated indirection. Generated Better Convex schema metadata is large by nature and should not be split for line count.

The Studio main bundle measured 633,795 bytes against a 600,000-byte informational budget. The attached entry still statically reaches `ConvexClient` through the Vue runtime context. First determine with a production bundle graph whether an attached-only entry can avoid constructing/importing the standalone client. If yes, create a direct attached entry and delete duplicate browser-client code from that bundle; if no material user cost is demonstrated, adjust the budget transparently rather than adding a loader shim.

F-019 is a small but revealing wrapper-contract problem: optional query arguments silently mean skip. Make arguments required and pass `{}`. This is preferable to adding a second `enabled` convention in Ginko.

### What Ginko should keep application-owned

Ginko should continue to own CMS roles, tenant membership, credential scopes, collection contracts, editorial policy, asset recovery, destructive-operation previews, requester/reviewer rules, activity records, and exact tool descriptions. Better Convex should provide identity-safe calls, MCP transport/context, OAuth verification, Apps lifecycle and evidence—not a CMS policy adapter.

## 8. MCP and standards assessment

### Standards status at the audit date

The `2026-07-28` MCP release candidate was locked on 2026-05-21, but its final publication date was six days after this audit. The locked candidate is sufficiently stable for private implementation and interoperability work. It is not truthful to label beta.5 SDK behavior “final 2026-07-28 compliant” before final publication and a reconciliation diff.

The RC materially changes the implementation target: stateless core operation, per-request metadata, server discovery, required agreement between MCP headers and body, and structured input-required flows with `inputRequests`, `inputResponses`, and `requestState`. Apps is a separate stable extension (`2026-01-26`). Tasks is an extension with separate maturity/client gates. These must not be blended into one support claim.

### Core MCP conformance matrix

| Requirement                          | Audited status                          | Required action                                                                                                                                 |
| ------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Official SDK owns wire protocol      | **Pass with caveat**                    | Keep official beta SDK; do not extend a handwritten parser. Reconcile exact SDK after final publication.                                        |
| Explicit tool/resource registration  | **Pass**                                | Preserve explicit schemas and mappings; no automatic Convex exposure.                                                                           |
| Structured results/errors            | **Pass in source tests**                | Repeat against exact tarball and real compatible clients.                                                                                       |
| Per-request safe application context | **Fail** (F-006)                        | Rebuild a synthetic allowlisted request/context; raw headers/request must not reach callbacks.                                                  |
| Request body/time bounds             | **Pass for JSON, fail for SSE** (F-008) | Support bounded unary JSON only until a durable streaming owner exists.                                                                         |
| Capability truthfulness              | **Fail** (F-007)                        | Remove subscriptions/list-changed capability and handlers, or implement durable lifetime outside per-request close. Recommendation: delete now. |
| Abort/timeout behavior               | **Partial**                             | JSON timeout exists; prove inbound abort propagation, SDK cancellation and no post-close callbacks.                                             |
| Diagnostics redaction                | **Mostly pass**                         | Await/catch async diagnostic sinks; keep args, tokens, headers, raw cause absent.                                                               |
| Inspector/conformance                | **Observed, not certifying**            | Existing versions do not cover the full locked RC; record as compatibility evidence only.                                                       |
| Production Convex-native runtime     | **Promising, incomplete**               | Repeat selected topology on a clean deployment with exact artifact, final SDK and real hosts.                                                   |

The official routing helper currently runs before Better Convex's method/path/authority boundary and ignores query/authority in route selection. No practical protected effect survived because the outer route is fixed and downstream checks fail safely, but final hardening should make the boundary decision first and pass only the normalized path/method agreed with the SDK. Do not fork SDK routing based on English strings.

### OAuth/resource-server assessment

The OAuth design is strong where it matters most:

- token classes are disjoint (`convex-session` versus `oauth-access`) despite shared JWKS;
- OAuth resource verification re-decodes the signature-verified compact token and requires scalar audience, exact issuer/resource, `client_id === azp`, access-token `typ`, bounded age and allowlisted claims;
- Better Auth OAuth administrator callbacks are mandatory and hardened fail-closed despite the upstream optional-callback footgun;
- dynamic/unauthenticated registration, refresh-token grant, DPoP, M2M, introspection and userinfo are disabled in the fixed profile;
- authorization-code consumption is a single Convex mutation;
- protected-resource and authorization-server discovery, PKCE and resource indicators are modeled;
- the starter's live policy rechecks session/user/client/resource/consent/membership/delegation at each effect.

F-009 is a contract-design gap, not a cryptographic failure: the generic verifier factory projects away the provider session ID before the application can perform the advertised live provider-session check. Fix the API or narrow its promise. Do not put provider sessions into a generic Better Convex database projection.

The security URL policy is implemented in three places with subtly different HTTPS/loopback rules. Replace them with one exact policy: HTTPS in production and exact loopback allowances only where explicitly required for local development. Separately, Better Auth secret validation warns rather than fails for weak values. For a security-hardened profile, enforce the upstream minimum of at least 32 bytes with a fixed, non-secret error. These are P1 hardening items because no production secret was inspected and no bypass was demonstrated.

### Token passthrough and application authorization

No generic token passthrough to Convex function arguments was found in the selected MCP package. The application callback receives a verified access context and maps an explicit tool/resource to an application call. Preserve that property with sentinel tests across successful results, errors, diagnostics and Apps messages.

OAuth scope, host confirmation UI, tool annotations and consent are ceilings/context, not application authorization. Every effect must still resolve the current Ginko actor/member/credential and resource permission in canonical state. Ordinary writes should execute normally after that check; only application-defined high-impact operations need a review/interaction step.

### Negotiated URL interaction

The earlier policy of waiting for all Phase 6 work is now too conservative. The locked RC has a concrete input-required/URL elicitation model, so a **private, deletable, neutral proof** can begin now. It must remain a projection of an application's existing canonical operation/review record:

1. The tool returns a negotiated input-required result only when the client advertises the capability.
2. The URL is built from one configured trusted origin plus an opaque random identifier; no token, identity or operation arguments are encoded.
3. `GET` is inert. The authoritative app requires login and an explicit state-changing request.
4. The app binds the current logged-in subject to the initiating subject where policy requires it, reloads current authority and current impact, and rejects forwarding, prefetch, crawler, expiry, stale impact, replay and concurrency.
5. Duplicate confirmation creates one canonical effect and one receipt.
6. A client without the capability receives a truthful unsupported/domain result; Better Convex must not invent an unnegotiated link flow.

Do not stabilize the projection API until the final spec is reconciled and at least two compatible clients execute it. Better Convex must not create a generic approval/review/handoff table.

### MCP Apps

Apps is useful progressive enhancement, not the security boundary. The intended shape is correct: a registered `ui://` resource, structured/model-visible fallback, explicit CSP/sandbox/permissions, and app-initiated effects routed through the same MCP/application authorization. No credential or raw Convex client should enter the iframe.

Current evidence is not enough for production. The fixture aliases sibling source, the host harness bypasses the normative different-origin sandbox proxy, Ginko's production handler does not supply the App HTML, and F-020 exposes SDK logging/cleanup limitations. Continue a private proof, but require an exact installed artifact, official host/proxy behavior, at least one real compatible host, malicious bridge/result cases, reconnect/unmount, CSP/external-link checks, and credential sentinel absence before Ginko production.

### Tasks and machine clients

Tasks remains correctly blocked. No current application workload proves that a structured status resource/result is insufficient; official SDK/client support and two relevant clients are not evidenced; and Ginko already has canonical job state. Do not add `tasks/list`, a compatibility implementation, a second job table, or generalized background workflow.

Client Credentials likewise requires a separate interoperability and threat-model proof. It is not a shortcut for Trusted Calls or a reason to forward bearer tokens into Convex arguments.

## 9. Release and supply-chain assessment

### Controls that are already strong

The candidate machinery is unusually disciplined. Package descriptors are statically reviewed rather than accepted as arbitrary CI paths. Candidates are packed once; source commit, SHA-256, SRI, content manifest, runtime fingerprint, SBOM and installed bytes are checked; consumer fixtures compare locks and package contents; Nuxt retains its deeper auth/OAuth/SSR gates. The candidate-set design correctly models Vue-before-Nuxt publication and holds shared tags until the graph is verified.

No practical artifact-substitution path survived review of the local candidate scripts. The blocker is that the protected workflow has not adopted the generalized candidate set (F-014), not that the hash/content model is weak.

### Existing exact artifacts

The following on-disk artifacts were re-hashed during this audit; hashes below are independently computed SHA-256 values, not copied assertions:

| Package/artifact                                     | Source commit recorded in artifact         | SHA-256                                                            |
| ---------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `better-convex-nuxt@0.7.0-beta.1` immutable baseline | `a6e76f1f61a483de5dbd3a19003ab35abcf75fad` | `1226e690b9f04562bd3ab44478976400b80a578aef596b60df60da8eb3ee6a84` |
| Nuxt `0.8.0-beta.0`                                  | `be64776e`                                 | `172c36914ae7f2dbb78a11735caa421912af9fb1df3829aba3a8ad6a469b4334` |
| Nuxt `0.8.0-beta.1`                                  | `d50f36d2`                                 | `8ed44e8f10aa3715a63b0fad0f861c2a586022fc16a8d57aa897350fd6c701b3` |
| Nuxt `0.8.0-beta.2`                                  | `715eac08`                                 | `a19477c886d656d879569d706d91554246f222c53a699b8502201a986b29eccb` |
| Nuxt `0.8.0-beta.3`                                  | `92d56001`                                 | `eb25f334b9bfd66a1cd53d8df18a878114b29e01a3c4e90967cf9efc0af13fbd` |
| Nuxt `0.8.0-beta.4`                                  | `1f740556`                                 | `dd039f0781ac005f3c209ab2ce493c51b022466cd2ac218d0735b8594dbcfa9c` |
| Nuxt `0.8.0-beta.5`                                  | `41ddaf9b`                                 | `abbbd417f18c271731025d84473f2c5f4cdffc4c30450fb591999ef3d7741f33` |
| Vue `0.8.0-beta.0`                                   | artifact metadata inspected                | `b9371c4b63444ecd1b146b72431d21865b7ff716fdd633336d85c243c5e2d4af` |
| Vue `0.8.0-beta.1`                                   | artifact metadata inspected                | `e8cccf664a9b0e3c790edf532b9b83b4defd16c317d3531fa4bb100786121a84` |
| Vue `0.8.0-beta.2`                                   | artifact metadata inspected                | `c88aa663c8ea81f9cc9ebec60a38a4b563410383b220ce8e8006e653308c7fc6` |
| Vue `0.8.0-beta.3`                                   | artifact metadata inspected                | `32a3e144a9e4564b25727df180e5c037a79abacb0f961477712f1cbb18990edb` |
| Vue `0.8.0-beta.4`                                   | artifact metadata inspected                | `d2b2b8a98fcd83beaddbcf32ddfb70628b96dd4cfb347746a8baec5e0ee0bf71` |
| Vue `0.8.0-beta.5`                                   | artifact metadata inspected                | `42f94508d91770969e5c86a452e37a9ef0ed09ee57558871538e18c18e26f89b` |
| MCP `0.1.0-beta.0`                                   | `ee065a3a`                                 | `578873af572cce575f272a42d404a78545baa45bfbafbfc68e14081f19581b6a` |

There is **no beta.6 candidate artifact** for the audited HEAD. Source version strings are not release evidence, and prior beta artifacts cannot certify F-001–F-020 fixes that do not yet exist.

### Release blockers beyond the confirmed findings

- Five starter manifests point at beta.6 while tracked lockfiles remain beta.0-era. `check-workspace-dependency-alignment.mjs` reported 12 alignment failures. Temporary candidate rewriting can mask that repository drift. Make tracked-lock alignment an explicit pre-pack gate.
- `pnpm check:asvs` fails because the evidence catalog references the deleted `src/runtime/server/mcp/proxy.ts`. Root `check` does not currently execute this check, while release verification does. Rebind the evidence to current enforcing code or delete the stale claim; never waive it.
- Ginko cannot cold-install the declared candidate tuple because MCP is omitted and local links/source aliases substitute for candidate bytes (F-015).
- Ginko's workflow trust boundary must be repaired before its green status is accepted as protected downstream evidence (F-016).
- A named Security Owner, licensing review, protected environments, and npm publication
  approval remain external governance blockers. A solo maintainer may own the prerelease
  roles, but the release record must not claim independent review.

### Required publication sequence

After P0 security and exact-artifact fixes:

1. Start from a clean, reviewed final commit; assert audited commit equals candidate source.
2. Build the closed Vue/Nuxt candidate set once. Produce independent hashes/SRI/SBOM/content/fingerprint records.
3. Run source, packed, production Vite, production Nitro, SSR/hydration, auth lifecycle, security and clean npm/pnpm consumer suites.
4. Run protected cloud staging against those unchanged bytes.
5. Publish Vue under a non-default prerelease tag; download and byte-compare registry content.
6. Install the unchanged Nuxt candidate against registry Vue; rerun the selected consumer gate; publish and compare Nuxt.
7. Publish MCP through its own static descriptor/lane only after its protocol gates pass; compare registry bytes.
8. Move shared prerelease tags only after the graph succeeds. Preserve candidates/evidence on failure.

Do not rebuild an artifact after staging, reuse an old candidate hash, or manually publish one member of the coordinated graph.

## 10. Maintainability and deletion assessment

### Size is not the primary problem

From `v0.7.0-beta.1` to the audited HEAD, production `src/**` plus `packages/**` changed by approximately **+5,144 / -4,278 lines, net +866**. That is consistent with a real Vue extraction and MCP package, not an unexplained 1,800-line accretion. The correct question is whether each remaining concept has one owner.

The generated 2,151-line schema metadata file should remain generated and canonical. Splitting it by hand would make maintenance worse. Large manual files with distinct ownership seams are different: the 1,032-line auth plugin and Ginko's 1,121-line schema should be divided along existing responsibilities after correctness work, without introducing registries or generic services.

### High-value deletion/simplification list

| Priority | Delete/simplify                                                                              | Why                                                                       | Proof before deletion                                                                       |
| -------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| P0       | Ginko legacy Nitro MCP server, assertion middleware and Convex caller (>2.2k production LOC) | Second MCP product/topology and second auth/diagnostic surface.           | Convex-native parity, OAuth, ordinary writes, exact artifact and production endpoint proof. |
| P0       | MCP subscriptions/list-changed advertisement and handlers                                    | Per-request endpoint cannot sustain them safely (F-007).                  | Capability negotiation reports only implemented unary behavior.                             |
| P0       | MCP legacy streaming/SSE path                                                                | Escapes bounds and is not required for current product (F-008).           | Bounded unary tools/resources and truthful client behavior.                                 |
| P0       | Ginko blanket Studio contract preflight wrapper                                              | Duplicates and contradicts backend policy; expands identity race (F-010). | Operation-specific backend guards and thin frontend presentation.                           |
| P0       | Nuxt-only protected publish path                                                             | Second, obsolete publication system (F-014).                              | Closed candidate-set workflow with registry equality.                                       |
| P1       | Public MCP `era` field                                                                       | Protocol lifecycle metadata is not application state.                     | Callback behavior unchanged without it.                                                     |
| P1       | Public/global Ginko MCP test client factory                                                  | Mutable process-global production state used only by tests.               | Explicit fixture injection or real route tests.                                             |
| P1       | MCP Apps `autoResize` option while SDK cleanup is not owned                                  | Public promise cannot be met.                                             | Upstream cleanup support or wrapper-owned exact cleanup.                                    |
| P1       | Native raw `Error.cause` storage                                                             | Cross-realm redaction promise is false (F-018).                           | Private WeakMap/server inspector or no raw cause.                                           |
| P1       | Duplicate Ginko auth/access observers                                                        | Repeated subscriptions and policy derivation across wrappers.             | One app-root state owner, multi-root/unmount proof.                                         |
| P2       | Stale RFC current-source references and completed `future-decisions.md` items                | Documentation claims deleted paths/current uncertainty.                   | Docs link/governance check covers RFC and decision files.                                   |
| P2       | Source-text OAuth quota test                                                                 | Tests implementation ordering rather than runtime invariant.              | Handler/database behavior test proving quota and no lookup drift.                           |

### Refactor only after correctness

The auth plugin contains separable concerns: JWKS/session issuance, OAuth parsing/claim guards, global profile validation, administrator profile validation, and composition/routes. Split those into direct modules after F-005 and the relevant security tests are fixed. Do not introduce an auth framework, registry or service container.

Ginko's schema should compose domain table maps from existing domain folders into one `defineSchema`. Add it to size/ownership governance. Do not split purely by line count, and do not move canonical indexes into documentation or generated parallel metadata.

The pagination controller has two lower-priority lifecycle cases that need direct tests before stable: a manual refresh whose terminal page shrinks can retain a stale tail, and a hydrated pagination seed can survive a same-identity argument change. Repair the single controller; do not create Nuxt-specific exceptions.

The RFC's “Current sources” section still links deleted starter/MCP proxy paths, and `future-decisions.md` retains decisions already completed. Update or delete these after P0. `plan.md` is explicitly historical and may remain if clearly labeled; it must not compete with the RFC/task ledger.

### Maintainability conclusion

The simplest maintainable path is a hardening-and-deletion release, not a new abstraction cycle. Fix the shared lifecycle once, narrow MCP to capabilities the selected topology can actually own, hard-cut Ginko to one endpoint, adopt the closed release graph, then split only the two manual ownership-heavy files. That path reduces production code while increasing proof.

## 11. Coverage ledger

“Executed” below means a test or bounded local probe actually ran against the audited checkout or exact installed dependency bytes. Prior evidence is named separately and is not promoted to current execution.

| Surface                                     | Production authority/enforcement inspected                                                                             | Strongest evidence inspected or executed                                                                                                  | Result                                                                                                                       | Residual gap                                                                                               | Confidence                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Shared client ownership and identity        | Vue client owner, auth adapter, stable handle, query/callable/pagination controllers, Nuxt and Ginko consumers         | Unit lifecycle suites, Nuxt browser/SSR fixtures, packed-history evidence, exact dependency auth-manager trace, adversarial interleavings | **One High, two Medium, several Low** (F-001, F-002, F-004, F-017 plus pagination cases)                                     | Corrected interleavings have not been implemented or run; same-user generation needs packed browser proof. | High for findings; medium-high for total absence of other races |
| Nuxt SSR/hydration/request isolation        | SSR query executor, payload cache/keying, auth server/client plugins, SSR headers, server caller                       | Source tests, SSR fixture/evidence, direct codec comparison with exact Convex client                                                      | **Two Medium** (F-003, F-004); request-scoped ownership otherwise holds                                                      | No new concurrent production SSR run; server calls lack an audited global response/deadline policy.        | High static; medium-high runtime                                |
| Better Auth and session JWT                 | Auth plugin, token exchange, JWKS rotation/storage, OAuth hardening, exact Better Auth/OAuth provider bytes            | Exact dependency reads; existing auth/OAuth suites and prior cloud evidence; bounded JWKS first-hit/concurrency probe                     | **One Medium** (F-005); token class/admin controls hold                                                                      | No new live rotation or sign-in/revocation run; provider-session lifetime policy remains a product choice. | High static; medium-high runtime                                |
| OAuth authorization server/resource server  | OAuth security/resource verification, discovery, proxy guards, code storage/consume, starter live authorization        | Claim-substitution tests and source, exact `jose`/provider behavior, concurrency design, prior cloud path                                 | **One Medium API gap** (F-009); no cryptographic bypass found                                                                | Final RC interoperability, live code contention and a second verifier require execution.                   | High static                                                     |
| MCP core and transport                      | Public handler, transport/body bounds, tool/resource mapping, diagnostics, official server beta.5                      | Exact SDK reads; synthetic callback header probe; oversized/never-ending SSE probes; subscription lifetime probe; unit/fixture evidence   | **Three Medium** (F-006–F-008) plus Low diagnostics/routing/API items                                                        | No clean deployed final-SDK run or real-host matrix.                                                       | High for findings; medium overall protocol certification        |
| MCP OAuth/application authorization         | Verifier contracts, protected metadata, scope/resource checks, explicit application access context, Ginko pilot policy | Neutral and Ginko source tests; claim and revocation paths inspected                                                                      | Token passthrough absent; F-009 and Ginko ingress/admission issues remain                                                    | External verifier fixture and exact-artifact live revocation not run.                                      | Medium-high                                                     |
| MCP Apps                                    | Vue wrapper, exact ext-apps bytes, fixture builder/host, Ginko route integration                                       | Source/Vite proof evidence; exact SDK logging/resize trace                                                                                | **Low API/boundary finding** (F-020); production proof incomplete                                                            | Source-linked fixture, no normative different-origin proxy, no real host, no Ginko HTML production path.   | Medium                                                          |
| URL interaction and Tasks                   | RFC/ledger gates, locked RC input-required design, Ginko canonical review records                                      | Standards reconciliation only; no accepted public runtime                                                                                 | No shipped vulnerability; private proof is now reasonable; Tasks correctly inactive                                          | Final spec and compatible clients not yet available/executed.                                              | High on no-go; low on future API shape                          |
| Convex transactions and Ginko authorization | Membership/role/credential functions, destructive operations, invitations/bootstrap/owner guards, assets, projections  | Production mutation/action trace; transactional invariants and existing tests                                                             | **Four Medium Ginko auth/product issues** (F-010–F-013, with F-012 product topology); canonical core guards otherwise strong | Asset demotion interleaving and ingress race need executed live proof after repair.                        | High static                                                     |
| Ginko Studio integration                    | Host context, composable wrappers, auth/access observers, upload queue, pagination/query call sites                    | Static use-site census, build/bundle evidence, behavior tests                                                                             | F-001 extension, F-010, F-019 and Low lifecycle/maintenance issues                                                           | Full hard-cut branch is source-linked; exact package browser proof absent.                                 | High for traced findings                                        |
| Release and supply chain                    | Package descriptor/certifier, candidate set, pack/verify/SBOM/fingerprint, workflows, Ginko pack/E2E/CI                | Independent artifact hashes, alignment and ASVS commands, workflow/code inspection                                                        | **Three Medium** (F-014–F-016) and stale-lock/evidence blockers                                                              | No beta.6 artifact, protected staging, registry comparison or publication.                                 | High local; no claim for protected external state               |
| Error/log/cache disclosure                  | Error normalization, diagnostic sanitizer, SSR headers, MCP diagnostics, Apps SDK logging                              | JSON/custom-inspect tests, direct structured-clone/MessageChannel probe, exact SDK logging trace                                          | F-018 and F-020 Low; raw MCP headers F-006 Medium                                                                            | Browser worker/iframe/SSR-payload sentinel matrix not run.                                                 | High for demonstrated behavior                                  |
| Maintainability and deletion                | Package graph, public exports, large manual files, Ginko dual topology, docs/decision ledger                           | LOC diff, public-export trace, source/use-site census                                                                                     | Architecture viable; significant deletion available                                                                          | Deletion depends on replacement parity; no code was changed in this audit.                                 | High                                                            |

### Acceptance-criterion coverage summary

- **Identity transitions:** existing suites cover broad transitions, but the callable test currently codifies the unsafe settlement order. This criterion is failed until F-001/F-002 are replaced with adversarial tests.
- **SSR and hydration:** request isolation is structurally sound; Convex value fidelity and same-user generation partitioning fail.
- **Provider-neutrality:** MCP base is not tied to Better Auth, and application policy remains external. The preconfigured bearer path needs a second neutral consumer before stable.
- **Official MCP SDK:** the selected package uses it, but capability/lifetime adaptation is not honest yet.
- **No token passthrough:** supported by production trace and tests; raw ingress headers nevertheless violate the callback boundary.
- **Ordinary writes:** product direction is correct. Ginko currently has duplicate ingress and preflight behavior that must be cut.
- **High-impact review:** Ginko's canonical preview/execute design is strong; shared URL projection is not yet implemented or certified.
- **Apps:** progressive UI proof exists only at source/fixture level and cannot certify a production sandbox.
- **Exact artifacts:** historical artifacts are strongly bound; the audited beta.6 source and Ginko tuple are not.

## 12. Rejected hypotheses

The following candidates were actively traced and rejected for the audited code. A rejection is bounded by the exact versions in section 1 and must be revisited when the relevant dependency or enforcing code changes.

| Hypothesis                                                                                       | Why it does not currently succeed                                                                                                                                                                                                                                                                 | Enforcing boundary                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Ordinary authenticated user becomes OAuth administrator because upstream callbacks are optional  | Better Convex refuses construction unless both client/resource privilege callbacks and custom claim callback are functions, wraps them fail-closed with timeout, and verifies the installed callback identity. Ginko/starter policy binds session user and reads an application-owned admin flag. | OAuth profile validation/hardening plus application callback |
| Convex session JWT is accepted as delegated OAuth access token                                   | Resource verification requires access-token `typ`, exact issuer/resource audience, bounded age and `token_use='oauth-access'`; a session token has `aud='convex'` and `token_use='convex-session'`.                                                                                               | `verifyOAuthBearerToken` and re-decoded claim assertion      |
| OAuth access token is accepted as a Convex session token                                         | Convex custom JWT provider requires `aud='convex'`; OAuth tokens target the registered resource.                                                                                                                                                                                                  | Convex provider audience plus token class                    |
| `azp`/`client_id` normalization hides a wrong client                                             | Better Convex re-decodes the already signature-verified compact bytes and requires scalar audience and exact `client_id === azp`.                                                                                                                                                                 | Raw signed-claim re-assertion                                |
| Authorization-code replay issues two tokens                                                      | The adapter reads and deletes the guard in one Convex mutation; conflicting consumers share the same record and Convex OCC.                                                                                                                                                                       | Atomic `consumeOne` mutation                                 |
| Dynamic registration, refresh grant, DPoP or M2M silently expands the fixed profile              | The hardened profile pins dynamic/unauthenticated registration off, grant type to authorization code, token storage hashed, resource enforcement on, and DPoP/M2M/introspection/userinfo empty.                                                                                                   | Construction-time profile validation                         |
| Private signing key is exposed at `/jwks`                                                        | Public serialization canonicalizes public RSA members; private JWK is versioned/encrypted at rest. F-005 concerns anonymous creation, not private material disclosure.                                                                                                                            | Stored-key validator and public JWK projection               |
| Percent-encoded path or dot-segment routes one proxy decision to another Better Auth endpoint    | The decision and forwarded target use the same normalized H3 pathname; escape normalizes outside the auth prefix and fails safe. Encoded-path checks reject ambiguous separators/control/dot segments.                                                                                            | H3 URL normalization and proxy path guard                    |
| Public token endpoint CORS exception forwards browser credentials                                | The exception is limited to the public PKCE token route, rejects credentials/cookies and constrains response cookies.                                                                                                                                                                             | CORS/credential guard and cookie namespace                   |
| Derived Ginko user projection grants stale authority                                             | Core authorization reads canonical Better Auth member/team/credential and application rows; projections carry display/derived data and are generation-fenced.                                                                                                                                     | Backend authorization functions                              |
| Ginko API credential plaintext is recoverable from storage                                       | Creation uses random credentials, persists hashes and displays plaintext only at creation; lookups hash the presented credential and recheck revocation/expiry/member.                                                                                                                            | Credential creation/lookup functions                         |
| Ginko destructive confirmation token alone grants authority                                      | Execution re-resolves the principal/permission and canonical version/impact in one mutation; expected blocked/stale outcomes are values.                                                                                                                                                          | Application preview/execute mutation                         |
| Better Convex automatically exposes arbitrary Convex functions as MCP tools                      | Tools/resources are registered explicitly with schemas and an explicit application callback mapping.                                                                                                                                                                                              | MCP tool/resource definitions                                |
| MCP tool scopes alone authorize a Ginko effect                                                   | Ginko effect paths re-read canonical member/credential/resource policy. Scopes are ceilings, not the final permission record.                                                                                                                                                                     | Application policy at effect                                 |
| Vue extraction left a second Nuxt client lifecycle engine                                        | Nuxt composables consume the shared Vue controllers/owner; the source island excludes Nuxt/server dependencies.                                                                                                                                                                                   | Package import graph                                         |
| Ginko retained a second generic query/pagination engine after its Vue migration                  | Ginko wrappers mainly add domain gates/error mapping around Better Convex controllers. Remaining duplication is auth/access observation and the unsafe callable preflight, not a second pagination engine.                                                                                        | Ginko wrapper/import trace                                   |
| MCP App iframe receives OAuth tokens, cookies or a raw Convex client through the intended bridge | The intended App result/bridge projection is structured and credential-free, and effects return through MCP. F-020 and source-linked proof prevent certification, but no token/client transfer was found.                                                                                         | App projection and explicit tool bridge                      |
| Candidate scripts can be pointed by CI input at arbitrary release paths                          | Package identities and paths come from a reviewed static descriptor rather than free-form workflow input.                                                                                                                                                                                         | Candidate descriptor validation                              |
| Existing candidate hashes are placeholders or mismatch their tarballs                            | Every artifact listed in section 9 re-hashed to its recorded value; runtime fingerprints inspected were non-placeholder.                                                                                                                                                                          | Independent SHA-256/content checks                           |

### Accepted bounded risk, not a finding

A valid Ginko Convex session token can remain usable until its approximately 15-minute expiry after the underlying Better Auth session is revoked, if the user's canonical application membership remains valid. That is a bounded bearer-token policy, not a bypass of the documented validator. Membership removal or role downgrade is immediate because application state is re-read. If Ginko promises immediate provider-session revocation for a specific high-impact path, use a current provider-session check there or shorten the token ceiling; do not copy sessions into another projection or add a blacklist by default.

## 13. Unresolved hypotheses and required experiments

These are not confirmed vulnerabilities. Each item names the missing evidence and the signal that would change the verdict.

1. **Corrected identity-settlement interleavings across real clients.** After F-001/F-002, execute Alice-started mutation/action during initial settlement, refresh rejection, Alice-to-Bob, same-user new generation and sign-out in Nuxt, plain Vite and embedded Studio. Capture backend actor/effect and client state. Any dispatch under a generation different from call start is release-blocking High.
2. **Convex value fidelity across SSR.** Run queries returning IDs, `bigint`, bytes, nested undefined-supported forms where applicable, `NaN`/infinities accepted by Convex, and `null` through server render, payload serialization and hydration against exact installed packages. Any source/client value mismatch is release-blocking.
3. **Server-side Convex deadlines and response bounds.** The audited SSR query/server caller does not expose a clear global deadline/response-size ceiling. Exercise slow functions, oversized values, client disconnect and concurrent SSR. Superlinear memory growth, unbounded pending calls or post-disconnect work should produce a new availability finding and a direct bound.
4. **JWKS bootstrap under live Convex OCC.** After moving creation off GET, execute concurrent authenticated first-token issuance and rotation on a clean deployment. Exactly one active key should be selected, with bounded retired keys and no public mutation. Multiple active bootstrap keys or failed issuance is release-blocking.
5. **Final `2026-07-28` MCP reconciliation.** On or after publication, diff the final specification and exact official SDK against the locked RC, update the decision record, and run the final official conformance suite. A required custom parser/protocol fork stops public MCP release and escalates upstream.
6. **Convex-native runtime/crypto production proof.** Deploy the neutral notes fixture from an exact MCP tarball and exercise tools, resources, errors, OAuth challenge/revocation, aborts, timeouts and concurrency through real HTTP. Runtime incompatibility without an upstream-supported solution invalidates the selected topology.
7. **Second provider-neutral verifier.** Implement one materially different verifier (not Better Auth and not a Ginko-shaped shared-secret clone) and prove issuer/audience/resource, revocation and current application authorization. If the current verifier API forces provider-specific fields, redesign before stable.
8. **Ginko atomic invalid-auth budget.** Fire synchronized invalid requests through every enabled ingress and tenant/IP key, advance a controlled clock, and inspect one canonical record. More accepted attempts than the rule, ingress divergence, or cross-key interference is release-blocking.
9. **Ginko asset demotion race.** Pause export/restore after storage work, remove/demote the actor, then resume terminal mutation. No asset/recovery record may be created; temporary object cleanup must complete. Any write is a protected post-revocation effect.
10. **Exact Ginko cold candidate.** From empty package-manager stores and no sibling checkout, install all recorded Better Convex and Ginko tarballs, assert lock and installed-byte equality, build/deploy, then run browser, Studio, MCP and Apps evidence. Any workspace/source resolution invalidates the candidate.
11. **MCP Apps normative host boundary.** Serve the iframe from the intended distinct origin through the official proxy/host implementation, run at least one real compatible host, and inject malicious results/messages/links plus credential sentinels. A credential/client in DOM, message, console or bundle; escaped navigation; missing CSP/sandbox; or leaked listener is release-blocking.
12. **Negotiated URL interaction.** Against the final SDK and two clients, prove capability absence, initiating-subject mismatch, forwarded link, same email/different issuer, prefetch/crawler, expiry, stale impact, replay, concurrency and lost notification. Only one canonical effect/receipt may exist and `GET` must remain inert.
13. **Packed beta.6 successor artifacts.** Build only after P0 from a clean final commit, run the closed candidate matrix and recompute every identity. Until that exists, no statement about current packed behavior is verified.
14. **Protected external governance.** Named solo ownership/licensing review, protected
    environment approval, OIDC/npm provenance and registry byte equality require authorized
    external execution. Independent review remains a stable-release gate. Failure blocks
    publication but does not block local repairs.

## 14. Remediation roadmap

This ordering is intentionally corrective and deletion-first. It does not authorize publication, deployment, repository settings, or Ginko writes; those remain separate user/governance actions.

### P0 — release and protected-effect blockers

1. **Freeze beta.6 publication and add failing identity tests.** Replace the current callable test that expects post-settlement capture. Cover initial settlement, preflight await, refresh, Alice-to-Bob, sign-out, same-user generation, mutation and action. Acceptance: no underlying dispatch occurs after generation differs from call start; no old completion updates state.
2. **Fix callable dispatch at the shared source.** Capture identity generation before settlement/preflight, recheck immediately before invoking the stable handle, and retain post-completion rejection. Delete Ginko's duplicate stable-handle/preflight dispatch window. Acceptance: adversarial suite across Vue, Nuxt and embedded Studio.
3. **Make auth rejection fail closed.** Treat the first/current SDK `false` callback and refresh-token rejection as an authoritative anonymous/error boundary: clear protected snapshots/data synchronously, increment generation, settle waiters deterministically, and surface a sanitized error. Acceptance: no Alice state after SDK auth clears; no swallowed rejection leaves `authenticated` true.
4. **Use Convex's codec for SSR and preserve `null`.** Replace native request/response JSON with the exact Convex encoded-json conversion used by the pinned client; introduce a unique internal unsettled sentinel. Acceptance: full value matrix, errors and `null` match client execution through SSR/hydration.
5. **Partition Nuxt payload by identity generation.** Bind protected payload/cache entries to a request-scoped generation/auth snapshot and purge on every generation transition, including same subject. Remove unused/anonymous-only purge logic. Acceptance: old data/error never hydrates a new session; anonymous public data remains correctly cacheable.
6. **Remove public mutation from JWKS discovery.** Make `/jwks` read-only and fail safely if no key exists. Bootstrap/rotate from authenticated issuance or explicit deployment-owned setup in one transaction. Acceptance: anonymous/concurrent GET performs zero writes; first issuance yields one active key; rotation/grace/public projection remain correct.
7. **Narrow MCP to a safe unary boundary.** Construct an allowlisted synthetic request/context with no authorization/cookie/raw headers; remove advertised subscriptions/list-change and legacy SSE/streaming; enforce method/path/header/body agreement before SDK routing; await and contain diagnostic sinks. Acceptance: credential sentinels absent, 1 MiB/30 s bounds apply to all responses, capability negotiation is truthful, abort closes work.
8. **Repair Ginko application correctness.** Remove blanket contract preflight; add transaction-time authority to asset terminal writes; implement one atomic invalid-auth admission rule; pass `{}` to facets and require args. Acceptance: recovery/control-plane paths follow backend policy, demotion races deny, synchronized ingress stays within quota, facets render.
9. **Complete the Ginko MCP hard cut.** Make the selected pilot explicitly opt-in during proof, achieve tool/resource/OAuth parity from an exact artifact, then delete the legacy Nitro server/assertion bridge/caller and make `mcp:false` disable the sole endpoint. Acceptance: one route, one tool inventory, one auth path, no compatibility alias, deletion diff and production proof.
10. **Repair coordinated release automation.** Replace protected Nuxt-only publication with the closed Vue/Nuxt candidate set and separate static MCP lane; enforce tracked-lock alignment and current ASVS references. Acceptance: clean runner, immutable candidates, Vue-first registry equality, unchanged Nuxt install/publish, MCP independent evidence, tags moved last.
11. **Make Ginko evidence exact and CI least-privileged.** Record/package MCP; delete source/Git overrides and App source aliases; SHA-pin actions, pin Corepack, disable persisted credentials, and split untrusted PR work from protected upstream reads. Acceptance: empty-store cold candidate, lock/byte equality, protected workflow governance test.
12. **Run the complete P0 matrix before creating any successor artifact.** Unit/type/lint, lifecycle, Nuxt SSR/browser, OAuth/security, MCP malformed/bounds, Ginko transaction/concurrency, production Vite/Nitro, exact npm/pnpm consumers and diff review. Acceptance: no High/Medium invariant failure and clean source worktree before packing.

### P1 — API hardening before stable surfaces

1. Redesign or remove the Better Auth MCP verifier factory so live-revocation claims are mechanically possible; prove Better Auth plus one external verifier.
2. Remove native raw `Error.cause` or store it in a server-private WeakMap; add structured-clone, MessageChannel/worker, SSR payload and console redaction tests.
3. Keep Apps experimental; remove `autoResize` and raw mutable `App` exposure unless guarantees can be narrowed and met; obtain logger control and prove exact cleanup/console redaction.
4. Remove public `era`, process-global Ginko test factory and any other proof-only public export.
5. Correct pagination terminal-tail refresh and same-identity arg/hydration cases in the one shared controller.
6. Consolidate exact HTTPS/loopback URL policy and fail construction on weak Better Auth secrets without logging values.
7. Add an app-root owner for Ginko auth/access/embedded lifecycle and bind upload presentation to identity generation.
8. Build the private, deletable neutral URL-interaction proof against locked RC primitives; expose no stable API until final reconciliation/two clients.

### P2 — maintainability, performance and documentation

1. Split the auth plugin by the five existing responsibilities after security behavior is green; delete the source-text quota test in favor of handler/database behavior.
2. Split Ginko schema table maps by existing domains and add the canonical schema to ownership/size governance.
3. Use a production bundle graph to decide whether an attached-only Vue entry materially removes standalone `ConvexClient`; add it only with measured value, otherwise document/adjust budget.
4. Update RFC current-source references, delete completed future-decision bullets, and include normative internal links in docs governance.
5. Archive the losing Nitro topology implementation/evidence in a non-shipping decision artifact, then remove all shipping code and dependencies.
6. Improve operator docs for supported/final versus experimental MCP, Apps, URL interaction and Tasks.

### P3 — post-final and optional evolution

1. Reconcile final MCP spec/SDK, repeat official conformance, Inspector and real-host matrix, then decide whether MCP can leave beta.
2. Stabilize URL interaction only after two clients and a neutral plus Ginko application projection pass every adversarial case.
3. Stabilize Apps only after exact-artifact, different-origin and real-host evidence.
4. Re-evaluate Tasks only when every RFC entry gate is true; Tasks must not block 1.0.
5. Consider a third framework or public core only after an actual consumer proves the need and Vue/Nuxt contracts are stable.
6. Perform a fresh offensive-security review and exact protected staging before any stable release.

### Rejected remediation

Do **not** solve these findings by adding:

- a token blacklist/session projection for all calls;
- roles or permissions in JWTs;
- a universal principal/RBAC/authorization DSL;
- a generic Commands, Trusted Calls, workflow or approval database;
- a second MCP topology or compatibility alias;
- automatic Convex-to-tool exposure;
- a background key bootstrap job when authenticated issuance/explicit setup suffices;
- a second Vue/Nuxt lifecycle engine;
- a stream buffer that merely increases the SSE limit;
- a test-only public runtime switch;
- source-link exceptions in release certification;
- legacy Tasks support or `tasks/list`;
- a catch-all `better-convex` package or speculative Svelte adapter.

## 15. Go/no-go gates

### Current decision table

| Activity                                                     | Decision at audited HEAD | Conditions to change decision                                                                                                                      |
| ------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Continue local vNext development                             | **GO**                   | P0 correctness/security work preempts feature expansion.                                                                                           |
| Create/distribute another local experimental tarball         | **NO-GO now**            | F-001–F-008 fixed, relevant tests green, exact clean candidate generated and clearly marked experimental.                                          |
| Publish a Vue/Nuxt npm prerelease                            | **NO-GO**                | All P0, closed candidate workflow, governance approval, protected staging and registry equality.                                                   |
| Publish MCP beta successor                                   | **NO-GO**                | F-006–F-009 resolved/narrowed, unary capability truth, final-spec reconciliation if published, external verifier and exact neutral/Ginko evidence. |
| Use Ginko Convex-native MCP in isolated non-production proof | **CONDITIONAL GO**       | Only after P0 transport/header/identity fixes, explicit pilot opt-in, exact pin and no claim of production/final compliance.                       |
| Ginko production MCP cutover                                 | **NO-GO**                | One endpoint/tool contract, atomic admission, asset authorization fix, exact cold candidate, OAuth/revocation/parity and legacy deletion.          |
| Private URL-interaction prototype                            | **GO**                   | Deletable neutral implementation, locked-RC capability negotiation, application-owned records, no stable API/support claim.                        |
| Production URL interaction                                   | **NO-GO**                | Final spec/SDK, two real clients, subject/stale/replay/concurrency evidence and one canonical effect.                                              |
| Private MCP Apps proof                                       | **GO WITH LIMITS**       | No credentials/client in iframe; treat source harness as development evidence only.                                                                |
| Ginko production MCP App                                     | **NO-GO**                | F-020 resolved, exact installed package, production HTML path, normative different-origin official host/proxy and real-host security matrix.       |
| Tasks implementation                                         | **NO-GO / GATED**        | Every Phase 8 entry condition must become true; it does not block 1.0.                                                                             |
| Stable Vue/Nuxt release                                      | **NO-GO**                | P0/P1 applicable API issues, exact package matrix, fresh security review, protected staging and docs truth.                                        |
| Stable MCP/overall 1.0 claim                                 | **NO-GO**                | Final standards interoperability, neutral+Ginko consumers, deletion complete, no open High/Medium, governance and exact-artifact proof.            |

### Non-negotiable release gates

1. **Identity gate:** no call dispatch or completion crosses identity generation; protected state clears synchronously on rejection/change.
2. **SSR gate:** Convex values and errors are byte/semantic-equivalent between server and client; payloads are generation-partitioned.
3. **Key gate:** anonymous discovery is read-only; key bootstrap/rotation is atomic and deployment-owned/authenticated.
4. **MCP boundary gate:** callbacks cannot access credentials/raw request; every advertised capability is implemented within bounds.
5. **Authorization gate:** every Ginko effect reads current canonical authority at its terminal transaction; every ingress shares the canonical admission policy.
6. **Topology gate:** exactly one shipping MCP topology and one Ginko endpoint remain.
7. **Artifact gate:** every public package has an exact immutable artifact tied to final source, installed-byte equality, production consumers, SBOM/SRI/content/fingerprint and no source/workspace substitution.
8. **Standards gate:** claims name exact final/experimental versions truthfully; official final conformance and real clients support stable MCP claims.
9. **Governance gate:** protected environment, security ownership, notification and publication authority are satisfied without bypass.
10. **Deletion gate:** old engines, parser/stream paths, topology, test globals, source aliases and stale release paths are removed—not hidden behind flags.

## 16. Final confidence statement

### Confidence by area

| Area                                    | Confidence                                 |  Score | Basis and limitation                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------ | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product/package architecture            | High                                       | 8.5/10 | Boundaries are coherent, one lifecycle source exists, and rejected products are correctly excluded. Stable public MCP/Apps interaction shape still depends on final evidence. |
| Shared Vue lifecycle                    | High for findings                          |   7/10 | Production and tests directly prove F-001/F-002/F-017; broad isolation machinery is thoughtful. Corrected interleavings have not run.                                         |
| Nuxt SSR/auth integration               | High static                                | 7.5/10 | Request scoping and cache headers are strong; F-003/F-004/F-005 are direct. No fresh live SSR/auth deployment was used.                                                       |
| OAuth/JWT security                      | High                                       | 8.5/10 | Exact dependency bytes and construction/claim controls were re-read; major substitution/admin candidates fail. Live final-flow/concurrency evidence remains prior/static.     |
| MCP core/transport                      | High for defects, medium for certification | 6.5/10 | Header, lifetime and stream probes are decisive; official beta SDK is used. Final SDK, deployment and real-host matrix are outstanding.                                       |
| Application authorization/Ginko backend | High static                                |   8/10 | Canonical guards and transaction patterns are strong; two action races and ingress split are concrete. Live repair evidence is absent.                                        |
| MCP Apps/interaction                    | Medium                                     | 5.5/10 | Useful direction and official extension, but current proof is source-linked/non-normative and SDK cleanup/logging limits are unresolved.                                      |
| Release/supply chain                    | High local                                 |   8/10 | Artifact identity model is strong and historical hashes verified. Protected workflow is incomplete and no beta.6 exact artifact exists.                                       |
| Maintainability                         | High                                       |   8/10 | Net production growth is modest for the scope; deletion targets and second sources are clear. Actual hard cut has not occurred.                                               |
| Overall readiness                       | Medium-high confidence in **no-go**        | 7.5/10 | One High and fifteen Medium findings/blockers make the current decision unambiguous despite runtime/external gaps.                                                            |

### Final verdict

The audited vNext is **a strong architecture with a fixable implementation, not a release candidate**. The review confirmed **0 Critical, 1 High, 15 Medium, and 4 Low findings**. The High issue is a real cross-identity mutation/action dispatch flaw and must be corrected before any new artifact. The Medium set clusters around four roots: identity/auth settlement, SSR/key lifecycle, MCP capability/boundary truthfulness, and incomplete Ginko/release hard cuts.

The recommended strategy is therefore not another platform redesign. Stop feature expansion long enough to:

```text
fix the one shared lifecycle
→ narrow MCP to safe truthful unary primitives
→ hard-cut Ginko to one authorized endpoint
→ certify the exact coordinated package graph
→ resume private Apps/interaction proofs
```

If those gates pass, Better Convex has a credible differentiated product: the best identity-safe Convex lifecycle for Vue/Nuxt, plus a provider-neutral MCP integration that embraces official standards without taking ownership of application authorization or workflow. If the final MCP SDK cannot support the selected Convex-native topology without a protocol fork, the correct response is to stop the public MCP package and revisit the recorded topology evidence—not to ship both implementations.

No absolute “secure” claim is made. This conclusion is bounded by the exact commits, dependencies and local evidence in section 1. No live production deployment, protected workflow, registry publication, real authenticated host, or final `2026-07-28` specification existed in the audit execution window. Every such limitation has a concrete experiment or gate above.

## 17. Post-audit owner-review triage

Two additional maintainability reviews were supplied after the audit snapshot was committed. They were
treated as candidate reports, not conclusions. The named production paths were re-read at BCN
`81f6c807` and Ginko `7babc915`; accepted items are executable stabilization tasks in
`internal/VNEXT-TASKS.md`.

| ID     | Disposition                        | Re-verified conclusion                                                                                                                                                                                                           | Consequence                                                                       |
| ------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| PA-001 | **Accepted, impact narrowed**      | Generated auth reference and `onDelete` metadata are not enforced by create/update/delete mutations. Orphan creation is certain; stale OAuth authority resurrection remains unproved without supported logical-identifier reuse. | `S3-001`–`S3-003`; release-blocking adapter parity/correctness work.              |
| PA-002 | **Accepted**                       | `pending-operations` is a counter, the serial queue is unused, refresh initiates overlapping confirmation paths, and two Better Auth session observers parse the same provider state.                                            | `S1-002`–`S1-003`; one coordinator and one provider subscription.                 |
| PA-003 | **Accepted**                       | Query, pagination, and Nuxt SSR do not have equivalent gate/status semantics; disabled state can mask errors and SSR can report readiness after a non-execute decision.                                                          | `S1-004`, `S2-001`–`S2-002`; behavior parity without a public core API.           |
| PA-004 | **Accepted**                       | Same-subscription auth-epoch handling and public `clear()` can expose pending when no operation remains capable of settling it.                                                                                                  | `S1-004`; pending becomes a derived live-work invariant.                          |
| PA-005 | **Accepted**                       | Required query args are optional at the Vue surface, pagination accepts an overly broad reference, and the auth adapter discards its generated component type.                                                                   | `S1-005`; beta hard cut with type fixtures.                                       |
| PA-006 | **Narrowed**                       | The OAuth compatibility firewall is necessary for the exact pinned upstream profile, but its ownership language and apparent configurability are broader than reality. No new authorization bypass was proved.                   | P1 narrowing and differential tests; do not delete the hardening.                 |
| PA-007 | **Accepted as evidence taxonomy**  | Several source/prose checks and tests-of-checkers are lint or migration evidence, not runtime security proof. Other behavioral, concurrency, artifact, and OAuth tests remain substantive.                                       | Relabel/prune in P2; retain executable gates.                                     |
| PA-008 | **Narrowed**                       | Historical absence scanners and line budgets carry refactor history, while AST dependency, artifact, provenance, and security-governance checks remain durable controls.                                                         | Delete historical theater after hard cuts; preserve semantic gates.               |
| PA-009 | **Accepted**                       | Projection `rebuild` is an upsert/repair batch without a sweep, caller-selected user provenance is presentation-only, and the mock-model agent starter is not a deployed provider recipe.                                        | Rename/narrow before stable; add no projection or agent framework.                |
| PA-010 | **Accepted for later deletion**    | The shared-query key, unused logger event families, inaccurate DevTools states, duplicated upload mechanics, and unproved `runMcpTool` export add surface without current behavior.                                              | P2 admission/deletion work after protected-effect fixes.                          |
| PA-011 | **Accepted**                       | Ginko story-title mapping is traceability, not acceptance evidence.                                                                                                                                                              | Demote it to a non-blocking index before release.                                 |
| PA-012 | **Accepted**                       | Ginko readiness declares many non-produced actions and dispatches broad targets instead of exact executable kinds.                                                                                                               | Prune or rename to suggestions; discriminate only real actions.                   |
| PA-013 | **Accepted**                       | Asset folder/breadcrumb/back state is never produced by the backend item builder.                                                                                                                                                | Delete the phantom UI after P0.                                                   |
| PA-014 | **Accepted**                       | Publishing state has multiple owners and can retain an old preview while a new assessment is pending. Backend confirmation limits security impact, but the UI claim is untrustworthy.                                            | Immediate stale-preview fix in `S5-006`; later one-session simplification.        |
| PA-015 | **Accepted**                       | Operation issue/effect wrappers erase meaningful types and add no runtime behavior.                                                                                                                                              | Keep the executor; replace identity wrappers with typed values after P0.          |
| PA-016 | **Accepted**                       | Ginko maintains wrapper chains and two independent installed-contract projections without a policy boundary between them.                                                                                                        | Collapse to direct converters and one projection after P0.                        |
| PA-017 | **Accepted**                       | The performance proof requires `listPaging` samples but never records one; source-string presence can still appear green.                                                                                                        | Instrument the interaction or remove the metric and claim.                        |
| PA-018 | **Accepted**                       | Asset deletion asks the human before fetching the authoritative preview, then discards preview meaning; bulk trash can partially apply.                                                                                          | `S5-005`: backend preview first, remove bulk trash, no generic command framework. |
| PA-019 | **Accepted**                       | Legacy Ginko MCP error messages bypass the existing string redactor.                                                                                                                                                             | Redact while the route exists, then delete it in `S5-004`.                        |
| PA-020 | **Accepted**                       | Entry creation and staged-asset attachment are separate mutations, so attachment failure leaves a created entry while the UI reports failure.                                                                                    | `S5-005`: claim staged assets inside entry creation.                              |
| PA-021 | **Accepted, terminology narrowed** | Browser evidence is commit/artifact-bound self-attestation, not independently captured UI certification.                                                                                                                         | Rename the evidence; preserve its hash binding.                                   |

Rejected remediation remains unchanged: do not delete all governance, weaken the OAuth firewall, add a
relational background worker, create another lifecycle engine, or introduce a generic
workflow/authorization product. Each accepted item is complete only after its stabilization task has an
executed regression proof.

## 18. Post-candidate thermo-review triage

The beta.11/beta.2 candidate set was subjected to a separate multi-agent maintainability review before
Ginko exact installation completed. Findings were reproduced against BCN `769d5b72`; implementation
evidence is recorded in
`internal/evidence/vnext-thermo-review-corrections-2026-07-23.md`.

| ID     | Disposition                    | Re-verified conclusion                                                                                                 | Consequence                                                                |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| TR-001 | **Accepted — Medium**          | Nuxt SSR pagination can report `ready` after skip/auth failure because status ignores the canonical execution gate.    | One reducer now binds gate, error, pending work, page and terminal state.  |
| TR-002 | **Accepted — Medium**          | MCP accepts consumer-created SDK servers and uses `instanceof`; a second physical SDK copy breaks handler composition. | MCP now owns construction and exposes only `configureServer(..., server)`. |
| TR-003 | **Accepted — Low**             | Query first-value control still uses `null`, although `null` is valid application data.                                | First-value settlement is now `Promise<void>`.                             |
| TR-004 | **Accepted — maintainability** | Public JWKS projection duplicates signing-key constraints inside the 1,112-line auth plugin.                           | Projection moved beside canonical JWKS validation/rotation.                |
| TR-005 | **Accepted — maintainability** | Relationship traversal is embedded in adapter mutations and repeatedly scans metadata.                                 | One construction-time relationship engine precomputes inbound references.  |
| TR-006 | **Accepted — product truth**   | Ginko `mcp:false` removes the endpoint but Studio still constructs credential reads.                                   | Disabled Studio skips reads and rejects credential changes.                |
| TR-007 | **Rejected**                   | A normal query returning `null` was claimed to become `idle`.                                                          | The settled query reducer reports success independently of result value.   |
| TR-008 | **Accepted — evidence state**  | The ledger still treated beta.11/beta.2 exact integration as current after the new defects were found.                 | Those immutable coordinates are superseded; fresh candidates are required. |

No Critical or High protected effect was introduced by these candidates. TR-001 and TR-002 prevent
R0 re-entry until fresh exact artifacts and Ginko integration repeat the corrected proofs.

## 19. R0 stabilization closure

The focused re-review at
`internal/evidence/vnext-r0-security-rereview-2026-07-23.md` traces every accepted
High/Medium finding through its enforcing correction, regression proof, exact
Vue/Nuxt/MCP artifacts, and exact Ginko consumer. It also covers the accepted
security-relevant post-audit and thermo-review findings.

The fresh candidate identities are Vue/Nuxt `0.8.0-beta.15` from
`db5127cdfeb294d003c9ec3d4b712b89d4589319` and MCP `0.1.0-beta.5` from
`f4fd5d02b814ce8ee46bbaec8c38c40ec1a80d12`. Ginko installed those exact bytes
at `5c589ff64e179f0e6fd0ba74d1f442ea7aebd4d5` and passed isolated pnpm and npm
production consumers.

No accepted High or Medium protected-effect issue remains open in the local R0
scope. R0 therefore passes for resuming local experimental vNext work. This
does not authorize publication or a stable support claim: protected staging,
final MCP reconciliation, real-host evidence, registry equality, and human
release governance remain explicit external gates.
