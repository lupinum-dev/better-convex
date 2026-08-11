# Phase 2 certification closure — 2026-07-22

## Outcome

Phase 2 is complete. The root `better-convex-nuxt` package remains in place, but release policy,
coordinates, evidence, entry checks, SBOM generation, consumer selection, runtime fingerprinting, and
workflow transfer are selected through one reviewed package descriptor. There is no second root-only
certifier or permissive package/path input.

The final audit found no superseded executable certifier to delete. The remaining
`releasePackageId = 'nuxt'` constants in `release.mjs` and `verify-release.mjs` are intentional closed
entrypoints for the only currently publishable package. Replacing them with caller input or automatic
workspace discovery would weaken the reviewed selection invariant. Flat `0.7.0-beta.1` files under the
ignored local artifact directory are immutable baseline evidence and are not discovered by the vNext
release path.

## Clean exact-HEAD rehearsal

The prior `0.8.0-beta.0` candidate was moved intact to
`/tmp/bcn-p2-015-artifact.iJm67a/0.8.0-beta.0`. From clean commit
`72e89daae3e013668bc8bcae438cf31db6a52359`, `pnpm release:prepare` created and verified:

```text
Artifact: .release-artifacts/nuxt/0.8.0-beta.0/better-convex-nuxt-0.8.0-beta.0.tgz
Source commit: 72e89daae3e013668bc8bcae438cf31db6a52359
Bytes: 266482
SHA-256: 2f6d9a6a5bb057e07f76d4096908f8cffb45e7ac9a7fdeba5af785a0b0885f0a
SRI: sha512-jigBZjKYca5lkpQ9DJYzd009SWmdlZXLkGrQvlWPn7etcAwxgQTCjcgePpwnuaMs7XCp79AduclnMY2Kyeolow==
Runtime fingerprint: bcn-release-v1-a94938dcf732bca83ff76d6d9c52def037df65e9a0d8f1a324905dee14259497
Content-manifest SHA-256: 165a5efdcbb858d272c2f3493e9cf20e82becd8a39b46e8dfbf922b752b22290
SBOM SHA-256: 8b55b8f6b308e4c22e2ee57ce6494aed2f06d0837b9183a322cf345030aacf70
```

Before the release rehearsal, a standalone `pnpm check` passed format, lint, module/server/fixture
typechecks, the 11-rule two-package boundary scan, 157 test files, and 1,803 tests.

`pnpm release:prepare` then passed:

- exact artifact schema, source commit, package/profile identity, content manifest, SBOM, SRI, and runtime
  fingerprint verification;
- 253 unique ASVS controls and 33 authentication invariants;
- the full 11-file production E2E isolation matrix and proxy DAST;
- production dependency/advisory checks with zero active exceptions;
- auth schema, adapter, OAuth, fuzz, secret sentinel, mutation, concurrency, MFA, MCP auth, and official
  MCP conformance gates;
- one-winner authorization-code consumption, signed-IP quota/reset, 1,001-row adapter atomicity, and
  eight-way signing-key rotation;
- nine deep packed export entries and 27 source/packed provenance records;
- seven maintained pnpm applications and one pinned npm production consumer installed from the same
  tarball.

The final release verifier reported that source gates used the checkout, artifact gates consumed the one
manifest-selected tarball, and no gate repacked it. The tracked worktree remained clean.

## Phase boundary

Workspace and certification groundwork is now sufficient for a second package later, but it does not
authorize one. Phase 3 begins as a private ownership and lifecycle extraction proof. No Vue package,
public core package, renamed repository, or release matrix is admitted by this evidence.
