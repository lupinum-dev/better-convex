# Nuxt generalized-certifier evidence — 2026-07-22

## Outcome

`P2-012` proves that the descriptor-driven release system certifies the existing root Nuxt package
without weakening the `0.7.0-beta.1` baseline. The vNext development line is now
`better-convex-nuxt@0.8.0-beta.0`; it does not reuse or move the immutable beta tag. One clean source
commit produced one package-qualified artifact, and every source, security, packed-entry, provenance,
and maintained-consumer gate passed against that candidate.

No package was published, no tag was created or moved, and no protected environment was invoked.

## Candidate authority

| Field                    | Value                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Package descriptor       | `nuxt`                                                                                            |
| Package                  | `better-convex-nuxt@0.8.0-beta.0`                                                                 |
| Source commit            | `ebae90b7f0cf70fa0fafa6762412ab50d77871dd`                                                        |
| Artifact manifest schema | `3`                                                                                               |
| Tarball                  | `better-convex-nuxt-0.8.0-beta.0.tgz`                                                             |
| Tarball bytes            | `266480`                                                                                          |
| Tarball SHA-256          | `ff8d0320b6f56474343e565dec024434404f9795632e92172a3481ea4c71d2fe`                                |
| Tarball SRI              | `sha512-nlJCaQvVI8wuSaEUSrjvNSfGI9OrLqUZFlikAIbvsBTBu5Jo4wwNxQ6gtfnoYlzZHoNTaRobMFdKrgUF1r9KNQ==` |
| Runtime fingerprint      | `bcn-release-v1-fca561ee9ce565f275123f4e5d08f2c5cf8dfe23e06acbcf6e709647efa21b37`                 |
| Content-manifest SHA-256 | `8bef6a40c34f17cf192c75773904ddd363a547f182753c6dacf9933f836e4f9b`                                |
| SBOM SHA-256             | `efc4a532846f9809d709fd2e66af73d063f13cbe3f1c04edf279be350e0c906e`                                |
| Packed inventory         | 295 files                                                                                         |
| SBOM inventory           | 243 production components                                                                         |

The manifest selects the reviewed `nuxt-module-build`, `nuxt-public-entries`,
`nuxt-runtime-artifact`, `nuxt-production-dependencies`, `nuxt-auth-upstream`,
`nuxt-maintained-consumers`, and `nuxt-runtime-binding` profiles. The source tree was clean when the
artifact was created.

## Version decision

`0.8.0-beta.0` is the smallest honest next development version. Phase 2 changes the release structure
and opens the path to a second public package, while preserving the current Nuxt API. Reusing
`0.7.0-beta.1` would violate immutable artifact identity; calling the structural vNext work a patch
would understate its intended release line. The package remains beta because the RFC explicitly keeps
public Vue and MCP contracts gated on later proof.

The root manifest, maintained distributed-app manifests and locks, changelog, and starter installation
documentation now agree on `0.8.0-beta.0`. No compatibility alias or second version authority was
added.

## Immutable-beta rejection

Before changing the version, `pnpm release:artifact` was run from a clean vNext commit while the root
manifest still declared `0.7.0-beta.1`. It failed before prepack because tag `v0.7.0-beta.1` resolves to
`a6e76f1f61a483de5dbd3a19003ab35abcf75fad`, not the vNext commit. It created no replacement artifact
and changed no tracked file. This is the required negative proof that generalization did not make the
old release rebuildable.

## Executed certification

From clean commit `ebae90b7`:

```sh
pnpm release:prepare
```

The release graph passed:

- build, formatting, lint, typecheck, package boundaries, and the complete unit/security/Convex/Nuxt/
  browser suite;
- ASVS evidence generation and its authentication invariants;
- CycloneDX production SBOM generation and verification;
- the full production E2E matrix and DAST;
- the clean dependency-advisory gate;
- authentication, OAuth, authorization-code and transport-quota concurrency, MFA, MCP authorization,
  and MCP conformance suites;
- exact packed-entry and package-export probes;
- packed authentication provenance; and
- the maintained candidate matrix.

The long release process completed its exact candidate matrix. Because the terminal relay did not
retain the final process line, the artifact-specific gates were then repeated directly and their exit
status captured:

```sh
pnpm check:candidate-apps --tarball \
  .release-artifacts/nuxt/0.8.0-beta.0/better-convex-nuxt-0.8.0-beta.0.tgz
```

Result: exit `0`; seven pnpm consumers (`demo`, `agency`, `agentic-saas`, `mcp-agent`,
`mcp-oauth-agent`, `public`, and `team`) plus one pinned npm consumer passed against the same exact
tarball. The runner verified isolated lock references and installed-byte equality before each configured
typecheck, test, or production build.

```sh
node scripts/release.mjs verify \
  .release-artifacts/nuxt/0.8.0-beta.0/artifact.json

pnpm check:package-exports --tarball \
  .release-artifacts/nuxt/0.8.0-beta.0/better-convex-nuxt-0.8.0-beta.0.tgz

pnpm check:auth-provenance --tarball \
  .release-artifacts/nuxt/0.8.0-beta.0/better-convex-nuxt-0.8.0-beta.0.tgz
```

Result: all exit `0`. Artifact hashes, SRI, sidecars, source commit, selected profiles, toolchain,
runtime fingerprint, 155 scanned source files, nine deep-checked public entries, and 27 provenance
records were independently revalidated.

## Failures fixed rather than suppressed

The first complete rehearsals found real release-line defects and were discarded before rebuilding:

- stale consumers of the removed root-only candidate-app export;
- stale generated security evidence pointing at a retired client-IP test;
- actionable advisories in release tooling (`tar`, Hono, `fast-uri`, `shell-quote`, and `svgo`);
- a parallel test race around shared `dist/` retirement; and
- an ignored Claude-owned nested worktree contaminating the current-checkout old-runtime scan.

Each issue received a focused invariant test or existing gate proof. The advisory graph is now clean.
The source absence scan still checks the authoritative checkout and installed dependency graph, but no
longer treats `.claude/worktrees` as package source. No user worktree was deleted and no security gate
was disabled.

## Boundary preserved

This task adds no public API, package, runtime option, compatibility shim, or publication path. The
artifact remains a workstation-local ignored evidence object bound to its source commit. `P2-013` must
now compare its public manifest, entries, packed inventory, and consumer outcomes with the immutable
`0.7.0-beta.1` baseline and account for every delta; successful certification alone is not evidence of
zero behavioral drift.
