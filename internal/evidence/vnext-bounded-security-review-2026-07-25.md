# Better Convex vNext bounded security review

Date: 2026-07-25

Reviewed baseline: `8f37cfa3` plus dependency remediation `95b930c0`

## Review status

This is the fresh, evidence-driven security review used to continue local vNext stabilization. It is
not represented as a completed Codex Security deep scan or as an independent third-party assessment.

The attempted deep scan `f16be681-1cae-4dde-820d-a085312f93b9` was canceled during discovery after the
owner determined that continuing it was too expensive. At cancellation it had produced no reportable
candidate, no validated finding, and no completed coverage ledger. Those partial results are not used
as clean-scan evidence.

The replacement review directly traced the protected-effect boundaries named by the RFC, inspected the
exact installed dependency bytes, and ran the existing adversarial regression matrices. This narrower
method is sufficient to continue local cleanup and candidate preparation. Protected staging, final MCP
publication reconciliation, and any separately authorized external review remain distinct gates.

## Source and dependency conclusions

| Boundary                                  | Enforcing result                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity crossing                         | Shared Vue callables capture identity generation before settlement and check the exact generation/client again immediately before wire dispatch. Completion is fenced after dispatch.                                                      |
| Stale protected state                     | Identity retirement clears protected query, pagination, callable, hydration, and embedded state through the shared lifecycle.                                                                                                              |
| OAuth administration                      | The pinned upstream provider still treats privilege callbacks as optional. Better Convex's private compatibility firewall requires, wraps, and re-verifies both callbacks fail closed.                                                     |
| Token-class substitution                  | The OAuth resource verifier validates the signed compact token and independently requires `typ=at+jwt`, exact issuer/resource audience, `token_use=oauth-access`, and `client_id=azp`.                                                     |
| Authorization code and interaction replay | Code consumption and application-owned interaction execution remain single-mutation/OCC operations with current authority, current impact, expiry, replay, and receipt checks.                                                             |
| Current provider/application authority    | The Better Auth MCP adapter rechecks session, user, client, resource, link, and consent. Ginko additionally intersects current delegation, membership, role, token scopes, and target ownership at the effect.                             |
| MCP credential boundary                   | The original bearer is consumed before application callbacks. The official SDK receives a synthetic allowlisted request; application access, arguments, results, and diagnostics contain no bearer or provider-private session identifier. |
| MCP transport truthfulness                | The supported surface remains finite unary JSON tools/resources with 64 KiB request, 1 MiB response, 30-second deadline, abort, concurrency, and diagnostic-sink containment.                                                              |
| SSR isolation                             | Request-scoped official `ConvexHttpClient` instances retain timeout, abort, response-size, no-store, identity-generation, and concurrent-request isolation.                                                                                |
| MCP Apps                                  | The Vue bridge remains experimental, narrow, credential-free, and does not expose a raw SDK App or Convex client. Stable admission is still externally gated.                                                                              |
| Better Auth relationships/JWKS            | Reference existence, cascade/restrict/set-null planning, trigger ordering, atomic deletion, encrypted key ownership, read-only anonymous JWKS, and issuance/operator-only initialization remain covered.                                   |
| Error disclosure                          | Raw causes remain server-private. Public serialization, diagnostics, SSR, and HTTP boundaries expose only allowlisted normalized metadata.                                                                                                 |
| Artifact substitution                     | Package-qualified manifest, source-commit, tarball, content, SBOM, SRI, fingerprint, installed-byte, and registry-equality gates remain fail closed.                                                                                       |
| Phase 6 RC vocabulary                     | Locked-RC interaction types remain private to the internal laboratory and do not appear in Vue, Nuxt, or MCP packed public exports.                                                                                                        |

No protected-effect bypass survived this review.

## Executed adversarial evidence

The following focused matrices passed before the dependency-only remediation:

- identity/callable lifecycle: 5 files, 88 tests;
- OAuth/provider/token binding: 5 files, 187 tests;
- MCP package runtime: 3 files, 20 tests;
- MCP common/unit boundary: 8 files, 50 tests;
- MCP security: 2 files, 14 tests;
- Better Auth relationships and JWKS: 3 files, 13 tests;
- SSR and error disclosure: 4 files, 76 tests;
- Nuxt identity/hydration: 3 files, 13 tests;
- release/artifact boundaries: 4 files, 76 tests;
- Ginko OAuth and high-impact interaction: 8 files, 53 tests;
- architecture boundary scan: 13 rules, 4 packages, 265 files;
- MCP packed-entry verification.

After remediation commit `95b930c0`:

- `pnpm run check:auth-advisories` passed;
- `pnpm audit --prod --audit-level low` reported no known vulnerabilities;
- the full audit contained only the two time-bounded development-tool exceptions below;
- the advisory-policy unit suite passed 6 tests;
- `pnpm run check` passed formatting, lint, module/server/fixture typechecks, all 13 architecture
  boundary rules, and 164 files/1,889 tests.

## Newly published advisories

The review found three advisories published on 2026-07-24:

| Advisory                                  | Resolution                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GHSA-mh99-v99m-4gvg` (`brace-expansion`) | Patched the compatible 5.x graph to `5.0.8`. Versions `1.1.16` and `2.1.2` remain only beneath local Inspector/build/test dependencies. Upstream published no compatible backport; forcing 5.x would break their minimatch callers. Two exact, 30-day exceptions expire 2026-08-24 and document the absence of an application-controlled glob surface. |
| `GHSA-r28c-9q8g-f849` (`postcss`)         | Overrode vulnerable `<=8.5.17` to patched `8.5.18`.                                                                                                                                                                                                                                                                                                    |
| `GHSA-r292-9mhp-454m` (`tar`)             | Updated the direct and transitive resolved version to patched `7.5.22`.                                                                                                                                                                                                                                                                                |

The production dependency audit is clean. The two remaining exception records are development-tool
debt, not accepted shipped-runtime vulnerabilities, and must be removed or renewed with new evidence
before their expiry.

## Candidate consequence

Vue/Nuxt `0.8.0-beta.18` and MCP `0.1.0-beta.6` remain immutable historical evidence for the previous
source commit. They must not be rebuilt or published after this lock/source change. `P9-014` will assign
fresh versions and create a new candidate set only after cleanup and documentation are complete.

## Residual gates

- Reconcile the final MCP `2026-07-28` specification, SDK, changelog, and conformance behavior after
  publication.
- Obtain protected staging and real-host evidence using authorized environments.
- Remove or re-evaluate the two development-tool exceptions no later than 2026-08-24.
- Continue deletion/cleanup before producing fresh immutable candidates.
