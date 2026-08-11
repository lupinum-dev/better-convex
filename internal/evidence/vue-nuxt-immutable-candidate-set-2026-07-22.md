# Vue/Nuxt immutable candidate-set evidence — 2026-07-22

## Claim

One immutable `0.8.0-beta.0` package set was built from clean commit
`be64776e5ddbf626e5fefdba1d3d0cfce3ed5c99`. Vue was built first. Nuxt was then
built and certified only against that exact Vue tarball. No probe fetched the unpublished Vue
version from the registry, repacked either package, or substituted a workspace link.

The local immutable set manifest is:

```text
.release-artifacts/set/0.8.0-beta.0/artifact-set.json
```

It binds the source commit, version, package manager, evidence path, tarball path, SHA-256, and SRI
for both packages in the fixed order `vue`, then `nuxt`.

## Artifact identities

| Package                           | SHA-256                                                            | SRI                                                                                               |
| --------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `better-convex-vue@0.8.0-beta.0`  | `b9371c4b63444ecd1b146b72431d21865b7ff716fdd633336d85c243c5e2d4af` | `sha512-l8cLRY1lDRzu/ASp6AEsFf3FYgjulKzg+RGy0hYQHDFoNdcEmnq32B4N2fAi30lg/7ud95KBmLrkR9i4FaHTGg==` |
| `better-convex-nuxt@0.8.0-beta.0` | `172c36914ae7f2dbb78a11735caa421912af9fb1df3829aba3a8ad6a469b4334` | `sha512-jpaOs4AYuDM9/XXb5HVgUWSyaWz1bGfUVLm/YAT8dO2LAzHqpCWP9Ka9d6G7jwW4HXeaO3SUGh6OvFKAzbqXvA==` |

## Enforcing changes

- `scripts/prepare-candidate-set.mjs` builds Vue before Nuxt, writes one strict set manifest, and
  removes partial package output when either build fails.
- Nuxt artifact creation requires the descriptor-selected Vue artifact at its canonical path.
- `check-package-exports.mjs --vue-tarball` validates a regular non-symlink archive, canonical
  filename, packed package identity, and exact Nuxt production dependency version.
- Every isolated Nuxt export probe receives a scratch-only pnpm override to the reviewed Vue
  tarball. Committed fixture manifests and workspace files are restored byte-for-byte.
- Candidate consumers require lock references to both tarballs and compare each installed package
  tree with the extracted candidate bytes.
- Verification recomputes both package artifacts and then validates the fixed set manifest; it does
  not trust paths or identity supplied by artifact evidence.

## Executed proof

```text
pnpm exec vitest run test/unit/package-export-cli.test.ts \
  test/unit/package-candidate-set.test.ts \
  test/unit/release-workflow.test.ts
pnpm exec eslint scripts/check-package-exports.mjs scripts/package-check/probes.mjs \
  scripts/release.mjs scripts/verify-release.mjs test/unit/package-export-cli.test.ts
pnpm run release:artifact:set
node scripts/prepare-candidate-set.mjs verify \
  .release-artifacts/set/0.8.0-beta.0/artifact-set.json
node scripts/check-candidate-apps.mjs --package vue \
  --tarball .release-artifacts/vue/0.8.0-beta.0/better-convex-vue-0.8.0-beta.0.tgz
node scripts/check-candidate-apps.mjs --package nuxt \
  --tarball .release-artifacts/nuxt/0.8.0-beta.0/better-convex-nuxt-0.8.0-beta.0.tgz \
  --vue-tarball .release-artifacts/vue/0.8.0-beta.0/better-convex-vue-0.8.0-beta.0.tgz
```

Results:

- focused release/CLI suites: 3 discovered files, 30 tests passed;
- ESLint, syntax, and diff checks passed;
- both artifact manifests and recomputed SBOMs verified against the set manifest;
- Vue exact-tarball matrix passed anonymous, authenticated, and separate-Vue-copy embedded
  production Vite consumers;
- Nuxt exact-pair matrix passed seven pnpm applications (`demo`, `agency`, `agentic-saas`,
  `mcp-agent`, `mcp-oauth-agent`, `public`, and `team`) plus one pinned-npm production consumer;
- configured starter tests, typechecks, production builds/renders, MCP generated-API extension,
  auth-disabled public build, and server consumer query/mutation/action lifecycle passed;
- every generated lock referenced the exact local package set and every installed package matched
  its extracted candidate bytes;
- final results were `Candidate runner matrix passed (3 maintained consumers, one exact tarball)`
  and `Candidate app matrix passed (7 pnpm apps and one npm consumer, one exact package set)`.

The optional live Agency codegen freshness check remained explicitly skipped because
`AGENCY_CONVEX_DEPLOY_KEY` was not present. It is an external deployment check and does not weaken
the local artifact, lock, installed-byte, type, test, or production-build proof.

## Fail-closed defects caught during certification

The first set build stopped after the Vue artifact because Nuxt's isolated export probes attempted
to resolve unpublished `better-convex-vue` from the registry. Commit `2bfd4cef` made the exact Vue
candidate an explicit validated probe input and installed it in committed scratch fixtures.

The second set build proved those fixtures but stopped in the ephemeral root probe: pnpm does not
use a direct file dependency to override an exact transitive registry specifier. Commit `be64776e`
added the same scratch-workspace override to that probe. The pair coordinator removed all partial
Vue/Nuxt output after both failed attempts. Only the final clean-HEAD pair remains.

## Invariants closed

- One source commit and one package manager produced both candidates.
- Nuxt's exact Vue dependency is satisfied by the reviewed Vue bytes in every packed probe.
- Vue publication order cannot authorize a later Nuxt rebuild.
- A failed package build cannot leave a usable partial set manifest.
- Candidate consumers cannot pass through source, workspace, registry, or independently repacked
  substitution.
- Publication, registry mutation, and dist-tag movement remain blocked on explicit protected
  authority; this evidence performs none of those actions.
