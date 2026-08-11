# Nuxt package structural baseline — 2026-07-21

## Result

Phase 2 structural work starts from the immutable, certified
`better-convex-nuxt@0.7.0-beta.1` artifact rather than a new pack of the current vNext tree. The exact
artifact still passes the packed export probes, provenance contract, and maintained consumer matrix.
The current vNext HEAD has the same production manifest and public package contract as that artifact;
its only `package.json` changes are five development-only dependencies used by the private MCP
laboratory.

This closes `P2-001`. It does not publish, retag, rebuild, or otherwise mutate the beta release.

## Immutable authority

| Field                                 | Value                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Package                               | `better-convex-nuxt@0.7.0-beta.1`                                                                 |
| Tag                                   | `v0.7.0-beta.1`                                                                                   |
| Source commit                         | `a6e76f1f61a483de5dbd3a19003ab35abcf75fad`                                                        |
| Tarball                               | `better-convex-nuxt-0.7.0-beta.1.tgz`                                                             |
| Tarball SHA-256                       | `1226e690b9f04562bd3ab44478976400b80a578aef596b60df60da8eb3ee6a84`                                |
| Tarball SRI                           | `sha512-A3KnvcXj3jNDPAqyH6lb+AquOg0Q7VzZIUjTs+aYNkoR5aXhpIsbtY46km2gDlSyu/e38ZbxmuP7iZnsljzJPA==` |
| Runtime fingerprint                   | `bcn-release-v1-30066ca7e2a3ba9e666c3b65cd672f0e48bc886f413c2ab48455aec91cd50ad4`                 |
| Content-manifest SHA-256              | `79b6639e9b74973953053f16410127c0709594f0012fa6406f5a37034d5bbc9d`                                |
| SBOM SHA-256                          | `5d4f19c1d4ce068cc24469fca9a2d5d4c69cdf7a1f3b0b00f1acf4500bb1737e`                                |
| Packed inventory                      | 298 files; 1,181,216 uncompressed bytes                                                           |
| Path/mode/size-shape digest           | `d1a4dc60d3dc6a60b0c5c173fc542d7d9ea241ea8892403f1c1a0c38b9dc0a36`                                |
| Production-manifest contract digest   | `3e3fcf73161e133c998c71c094c7cd831d0c7d375e3e71f15a958e07ebbebcec`                                |
| Public export/install-contract digest | `8dce40c9980f2760ecd0469ebf1e26b8a2bf7141947743e8cd89c7f725b13ce5`                                |
| Package-entry manifest source SHA-256 | `c0820fe83323bcac0415fcafb68a158709d596aa6620d997d8542dbd005388be`                                |

The public export/install-contract digest is computed over the ordered `exports`, `typesVersions`,
`bin`, `files`, `main`, and `type` fields. The production-manifest digest is computed by the existing
strict production manifest contract helper. Neither digest uses a permissive normalization step.

The local `.release-artifacts` directory is intentionally ignored and workstation-local. The tracked
authority is therefore the source coordinates and hashes above, not continued existence of that local
path.

## Public package contract

The canonical package-entry manifest has nine entries: eight runtime entries and one types-only entry.

| Subpath                                 | Kind       |
| --------------------------------------- | ---------- |
| `.`                                     | runtime    |
| `./auth-client`                         | runtime    |
| `./convex-auth`                         | runtime    |
| `./convex-auth/convex.config`           | runtime    |
| `./convex-auth/_generated/component.js` | types-only |
| `./convex-auth/test`                    | runtime    |
| `./errors`                              | runtime    |
| `./server`                              | runtime    |
| `./server/createUserSyncTriggers`       | runtime    |

The package exposes exactly two binaries:

- `better-convex-nuxt-auth-schema`
- `better-convex-nuxt-convex`

Its package file allowlist is exactly:

- `dist`
- `LICENSES`
- `THIRD_PARTY_NOTICES.md`
- `security/upstream-convex-better-auth.json`

The existing package-entry verifier probes every declared runtime entry in a clean consumer and checks
the types-only entry, declared values and types, forbidden names, bins, file allowlist, runtime
fingerprint, notices, SBOM, and content manifest.

## vNext comparison

The comparison was made from vNext commit
`93d1ba82a6adc781a267f7f54673a40ab65b55c7` to the immutable tag. There are no changes since the tag to
`src/**`, `build.config.ts`, `scripts/package-entry-manifest.mjs`, `scripts/package-check/**`, or the
release implementation. The current source and packed beta match on:

- package name and version;
- public exports and `typesVersions`;
- binaries and package file allowlist;
- `main` and module type;
- production dependency and peer-dependency contract;
- canonical package-entry definitions.

The only `package.json` delta is five exact development-only dependencies for the private MCP lab:

- `@modelcontextprotocol/client`;
- `@modelcontextprotocol/ext-apps`;
- `@modelcontextprotocol/sdk`;
- `@modelcontextprotocol/server`;
- `vite`.

These packages do not enter the beta production manifest or its browser/server artifacts.

## Executed proof

All commands used the transferred immutable tarball explicitly. No command packed the current tree.

```sh
node scripts/check-package-exports.mjs \
  --tarball .release-artifacts/better-convex-nuxt-0.7.0-beta.1.tgz \
  --manifest /tmp/bcn-vnext-p2-baseline-contents.json
```

Result: passed. The generated content manifest is byte-identical to the certified sidecar and hashes to
`79b6639e9b74973953053f16410127c0709594f0012fa6406f5a37034d5bbc9d`.

```sh
node scripts/check-auth-provenance.mjs \
  --tarball .release-artifacts/better-convex-nuxt-0.7.0-beta.1.tgz
```

Result: passed for the source and packed artifact with 27 provenance-ledger records.

```sh
pnpm run check:candidate-apps --tarball \
  .release-artifacts/better-convex-nuxt-0.7.0-beta.1.tgz
```

Result: passed seven pnpm maintained applications (`demo`, `agency`, `agentic-saas`, `mcp-agent`,
`mcp-oauth-agent`, `public`, and `team`) plus the npm consumer. Each disposable consumer referenced the
exact tarball in its isolated lock, installed those bytes, and passed its configured production build or
typecheck checks.

```sh
pnpm exec vitest run --project=unit \
  test/unit/package-entry-manifest.test.ts \
  test/unit/release-artifact-evidence.test.ts
```

Result: 2 files and 16 tests passed.

The authoritative full beta verification was already run from the exact detached source commit during
`P0-001`. It passed source, authentication, OAuth, MCP, DAST, concurrency, packed-export, seven-pnpm
consumer, and npm-consumer gates. Running that source-binding verifier from vNext would correctly reject
the beta artifact because vNext has a different source commit; that rejection must not be weakened.

## Structural comparison rule

`P2-013` must not require raw equality between this tarball and a future package version. A future
candidate necessarily has a different manifest version and runtime fingerprint, and the release
fingerprint is generated for that candidate. Instead:

1. verify each artifact against its own commit-bound manifest, SHA-256, SRI, content manifest, SBOM, and
   runtime fingerprint;
2. compare the exact public export/install contract and production-manifest contract;
3. review every packed-content delta explicitly;
4. run the same maintained pnpm and npm consumers against the exact future tarball; and
5. reject any unaccounted export, dependency, binary, file, or consumer-behavior drift.

This keeps the comparison strict without inventing a generalized artifact normalizer or creating a
second source of package truth.
