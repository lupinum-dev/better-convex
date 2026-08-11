# vNext R0 focused security re-review

Date: 2026-07-23

## Authority and scope

This review closes stabilization task `S6-009`. It re-traces the accepted
High/Medium findings in `Audit.md` from the audited baselines:

- Better Convex `81f6c807`
- Ginko CMS `7babc915`

through the corrected exact candidates:

- Better Convex Vue/Nuxt source
  `db5127cdfeb294d003c9ec3d4b712b89d4589319`
- Better Convex MCP source
  `f4fd5d02b814ce8ee46bbaec8c38c40ec1a80d12`
- Ginko exact-tuple source
  `5c589ff64e179f0e6fd0ba74d1f442ea7aebd4d5`

The later evidence-only Ginko commit is `dc9a2ec5`. No package was published,
no tag moved, and no external deployment was changed.

The review inspected the enforcing source and the task-specific evidence rather
than accepting the earlier review prose as proof. It also reran the concentrated
identity, auth, query, SSR-state, error, relationship, JWKS, MCP verifier,
credential-boundary, and transport matrix: 12 files and 130 tests passed.

## Accepted finding crosswalk

| Finding      | Corrected invariant                                                                                   | Closure                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `F-001` High | Mutation/action dispatch is bound to invocation-entry identity generation.                            | `S1-001`; exact Vue/Nuxt/Ginko lifecycle evidence passed.                                 |
| `F-002`      | SDK auth rejection performs one idempotent fail-closed identity transition.                           | `S1-002`–`S1-003`; coordinator and repeated-rejection matrices passed.                    |
| `F-003`      | Nuxt SSR uses request-scoped official `ConvexHttpClient` value/error encoding.                        | `S2-001`; value, error, timeout, abort, and size matrices passed.                         |
| `F-004`      | Protected payload/error state is generation-bound, including same-subject replacement.                | `S2-002`; SSR/hydration and exact production lifecycle evidence passed.                   |
| `F-005`      | Anonymous JWKS and discovery paths perform zero writes.                                               | `S3-004`; empty, concurrent, issuance, setup, and rotation tests passed.                  |
| `F-006`      | MCP callbacks receive a synthetic allowlisted request without credentials.                            | `S4-001`; source and packed credential sentinels passed.                                  |
| `F-007`      | MCP advertises only supported finite unary capabilities.                                              | `S4-002`; subscriptions, list-changed, SSE, and streaming paths were deleted.             |
| `F-008`      | Every supported MCP response is bounded by request, response, deadline, abort, and concurrency rules. | `S4-002`; malformed, oversized, timeout, abort, and official-client tests passed.         |
| `F-009`      | Better Auth MCP verification requires a provider-private live validation callback.                    | `S4-003`; session, user, client, consent, resource, and external-verifier tests passed.   |
| `F-010`      | Ginko backend operation guards, not a blanket Studio preflight, own contract policy.                  | `S5-001`; recovery and ordinary-write policy tests passed.                                |
| `F-011`      | One transaction owns Ginko invalid admission and credential resolution at the sole ingress.           | `S5-003`; synchronized budget and exact MCP consumer tests passed.                        |
| `F-012`      | Ginko has one optional Convex-native MCP endpoint and one inventory.                                  | `S5-004`; disabled-mode, route-absence, inventory, and legacy-path deletion tests passed. |
| `F-013`      | Asset-recovery terminal mutations re-read current canonical actor authority.                          | `S5-002`; demotion, removal, rollback, and success interleavings passed.                  |
| `F-014`      | A closed candidate-set lane certifies Vue before Nuxt and MCP independently.                          | `S6-001`; workflow, tag-order, registry-byte, and candidate-set tests passed.             |
| `F-015`      | Ginko records and installs exact Vue, Nuxt, MCP, CMS, component, contract, and content bytes.         | `S6-002`, `S6-008`; isolated pnpm and npm production consumers passed.                    |
| `F-016`      | Ginko CI pins actions/tooling, disables persisted credentials, and separates untrusted code.          | `S6-002`; workflow authority and candidate-source tests passed.                           |

The accepted Low findings were also corrected:

- `F-017`: lifecycle control no longer uses application `null`;
- `F-018`: raw causes are server-private and absent from structured clone and
  serialization;
- `F-019`: Ginko facets execute with required arguments;
- `F-020`: MCP Apps exposes only BCN-owned lifecycle operations and no raw
  mutable SDK app or unsupported auto-resize promise.

Post-audit `PA-001`–`PA-005`, `PA-014`, and `PA-018`–`PA-020` are covered by
the same relationship, coordinator, query-state, preview, redaction, and
atomicity proofs. Thermo-review Medium findings `TR-001` and `TR-002` are
closed by the canonical SSR pagination reducer and package-owned official MCP
server construction. The exact beta.15/beta.5 candidate pipeline reran those
corrections from installed package bytes.

## Exact-artifact evidence

`internal/evidence/vnext-beta15-mcp-beta5-candidate-certification-2026-07-23.md`
records:

- 163 repository test files and 1,881 tests;
- 253 ASVS controls and 33 auth invariants;
- 11 isolated production E2E suites and auth-proxy DAST;
- source/packed auth provenance, credential sentinels, concurrency, OAuth code
  consumption, MFA, PKCE, live
  authorization, revocation, and locked-RC conformance;
- three exact Vue consumers, six exact pnpm Nuxt consumers, one isolated npm
  consumer, and the packed production lifecycle runner;
- npm production/full advisory checks and exact GitHub advisory queries with
  zero active exceptions.

Ginko's tracked
`docs/maintenance/better-convex-vnext-candidate.md` records:

- focused stabilization proof: 11 files and 85 tests;
- full check: 182 files and 1,202 tests;
- reproducible Ginko package archives;
- isolated pnpm and npm exact-tuple production builds, MCP read/write behavior,
  imports, content safety, and portability;
- npm's audit of 734 installed packages with zero vulnerabilities.

## Residual scope and decision

No accepted High or Medium protected-effect issue remains open in the local R0
scope. The review found and corrected two evidence cross-reference errors:
the SSR evidence now points to `F-003`/`F-004`, and the structured-clone error
evidence points to `F-018`.

The following remain external or later-phase gates, not local R0 failures:

- protected Convex/live-host staging and Ginko `package:e2e:live` need a
  separately authorized disposable deployment;
- final MCP specification reconciliation and real-host evidence remain gated;
- publication, registry equality, tags, and protected-environment approval
  remain external;
- accepted maintainability/traceability cleanup in the post-R0 ledger remains
  required before a stable release.

**R0 decision: PASS for resuming local experimental vNext work.** This is not a
publication or stable-release approval.
