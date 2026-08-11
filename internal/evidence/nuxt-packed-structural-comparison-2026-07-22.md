# Nuxt packed structural comparison — 2026-07-22

## Outcome

`P2-013` finds no unaccounted public or runtime behavior drift between the immutable
`better-convex-nuxt@0.7.0-beta.1` artifact and the generalized
`better-convex-nuxt@0.8.0-beta.0` candidate. The public install contract and production dependency
contract are identical after excluding the necessarily changed version. All non-generated runtime
files are byte-identical except the release fingerprint, module metadata version, and regenerated
Nuxt DevTools assets. Three unreachable generated declaration files were intentionally removed as
build debris; the sole public generated declaration remains.

Both artifacts independently pass their commit-bound verification and the same seven-pnpm plus
one-npm maintained-consumer matrix.

## Compared authorities

| Field               | Immutable baseline                                                                | Generalized candidate                                                                    |
| ------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Version             | `0.7.0-beta.1`                                                                    | `0.8.0-beta.0`                                                                           |
| Source commit       | `a6e76f1f61a483de5dbd3a19003ab35abcf75fad`                                        | `ebae90b7f0cf70fa0fafa6762412ab50d77871dd`                                               |
| Tarball SHA-256     | `1226e690b9f04562bd3ab44478976400b80a578aef596b60df60da8eb3ee6a84`                | `ff8d0320b6f56474343e565dec024434404f9795632e92172a3481ea4c71d2fe`                       |
| Runtime fingerprint | `bcn-release-v1-30066ca7e2a3ba9e666c3b65cd672f0e48bc886f413c2ab48455aec91cd50ad4` | `bcn-release-v1-fca561ee9ce565f275123f4e5d08f2c5cf8dfe23e06acbcf6e709647efa21b37`        |
| Evidence            | [`nuxt-package-baseline-2026-07-21.md`](./nuxt-package-baseline-2026-07-21.md)    | [`nuxt-generalized-certifier-2026-07-22.md`](./nuxt-generalized-certifier-2026-07-22.md) |

The local artifacts are ignored evidence copies. The source coordinates and cryptographic hashes are
the durable authority.

## Public and production contracts

The ordered public install contract over `exports`, `typesVersions`, `bin`, `files`, `main`, and `type`
has the same SHA-256 for both artifacts:

```text
8dce40c9980f2760ecd0469ebf1e26b8a2bf7141947743e8cd89c7f725b13ce5
```

Therefore both artifacts expose the same nine package entries, the same two binaries, and the same
package-file allowlist. The candidate's descriptor-owned entry verifier deep-checked all nine entries
from the packed bytes.

The selected production fields—name, module type, main entry, type mappings, exports, bins, files,
dependencies, peers, Node engine, and package manager—are also byte-equivalent as canonical JSON once
the version field is excluded. Their shared comparison digest is:

```text
2d0809e34e1aa0df0ecca5e690f0e0faeadc0042dc9e4f378a7bc4340aef8bcd
```

The raw descriptor-selected production-contract digests differ because version is intentionally part
of each artifact's identity. Removing only that field from the selected contract yields deep equality;
no dependency, peer, engine, lifecycle, export, binary, or installation field changed.

Changes to packaged development scripts, dev-only MCP laboratory dependencies, and root `pnpm`
overrides do not enter the selected production dependency contract. They were still reviewed: the
scripts merely supply the now-required closed `nuxt` descriptor, the MCP dependencies are private lab
inputs, and the overrides remove release-tooling advisories.

## Packed inventory review

| Comparison                         | Count |
| ---------------------------------- | ----: |
| Baseline files                     |   298 |
| Candidate files                    |   295 |
| Paths common to both               |   289 |
| Common files byte-identical        |   283 |
| Common files with reviewed changes |     6 |
| Baseline-only paths                |     9 |
| Candidate-only paths               |     6 |

The six changed common paths are fully accounted for:

- `package.json`: version plus development-only certification/lab/toolchain changes;
- `dist/module.json`: version only;
- `dist/runtime/shared/release-fingerprint.js`: exact artifact fingerprint only; and
- three DevTools HTML files: content is identical after substituting the regenerated hashed chunk
  names.

Six baseline-only and six candidate-only paths are corresponding regenerated DevTools JavaScript/CSS
chunk names. The entry stylesheet is byte-identical. The two error chunks and styles are identical
after normalizing their generated filenames and Vue scope identifiers. The large framework chunk was
regenerated with different minifier symbol allocation while retaining the same size; the authoritative
DevTools Vue source shipped in the artifact is byte-identical, and both source and packed production
build/browser checks pass. No DevTools API or source behavior changed.

The other three baseline-only paths are:

```text
dist/runtime/convex-auth/component/_generated/api.d.ts
dist/runtime/convex-auth/component/_generated/dataModel.d.ts
dist/runtime/convex-auth/component/_generated/server.d.ts
```

They are unreachable declaration debris: none is a package export or a referenced public declaration,
and mkdist's extension processing corrupts their already-suffixed internal imports. The build now keeps
only `component.d.ts`, which is the one declared types-only package entry. The corresponding JavaScript
files remain unchanged. Exact entry/type probes demonstrate that removing this debris does not reduce
the public type surface.

Outside those reviewed paths, the package module, all server/auth/OAuth/MCP/client/composable runtime
JavaScript and declarations, notices, licenses, upstream-security record, DevTools source, and public
assets are byte-identical.

## Behavioral comparison

The baseline evidence records the full detached-source verification and the exact seven-pnpm plus
one-npm consumer matrix. The candidate ran the same maintained applications and npm consumer against
its exact tarball, with isolated locks and installed-byte comparison, and passed all configured tests,
typechecks, and production builds. The candidate additionally passed the current full source,
security, E2E, DAST, OAuth concurrency, MCP conformance, SBOM, packed-entry, and provenance gates.

No test was reclassified, skipped, or weakened to make the comparison pass. Live cloud staging remains
an explicitly protected external action and is not claimed by this local structural proof.

## Reproduction

The comparison extracted both tarballs into a new temporary directory and used exact relative-path and
byte comparisons. Contract digests were computed from the extracted `package.json` files, not the
workspace manifest. The candidate was then independently checked with:

```sh
node scripts/release.mjs verify \
  .release-artifacts/nuxt/0.8.0-beta.0/artifact.json

pnpm check:package-exports --tarball \
  .release-artifacts/nuxt/0.8.0-beta.0/better-convex-nuxt-0.8.0-beta.0.tgz

pnpm check:auth-provenance --tarball \
  .release-artifacts/nuxt/0.8.0-beta.0/better-convex-nuxt-0.8.0-beta.0.tgz

pnpm check:candidate-apps --tarball \
  .release-artifacts/nuxt/0.8.0-beta.0/better-convex-nuxt-0.8.0-beta.0.tgz
```

All commands exited `0`.

## Decision

The generalized certifier preserves the Nuxt package's public and production contract. The reviewed
artifact differences are either identity-bound output, regenerated DevTools output from unchanged
source, or deletion of inaccessible broken declaration debris. `P2-014` may proceed; no compatibility
shim, retained debris, or second certifier is justified.
