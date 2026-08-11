# Vue package certification profile — 2026-07-22

## Outcome

`better-convex-vue` is now a closed, reviewed package owner in the generalized package certifier. Its
profile is deliberately smaller than Nuxt's: three public entries, ESM-only output, one `dist` payload,
no CLI, no runtime fingerprint, and exactly the production dependencies required by the browser
runtime.

The maintained consumer gate packs Vue once and supplies that same immutable tarball to:

- the anonymous production Vite consumer;
- the provider-neutral authenticated production Vite/browser consumer;
- two separately installed Vue roots proving the opaque embedded-runtime attachment.

Every install is compared to the extracted candidate by path, size, and SHA-256. Package-manager peer
links under the installed package's injected `node_modules` are excluded because they are not tarball
content. The package itself remains byte-exact.

## Closed profiles

| Boundary             | Reviewed Vue profile                                 |
| -------------------- | ---------------------------------------------------- |
| Build                | `vue-unbuild`                                        |
| Public exports       | `vue-public-entries` (`.`, `./errors`, `./embedded`) |
| Packed files         | `vue-runtime-artifact`                               |
| Production/SBOM      | `vue-production-dependencies`                        |
| Provenance identity  | `vue-repository-origin`                              |
| Maintained consumers | `vue-maintained-consumers`                           |
| Runtime fingerprint  | `vue-no-runtime-fingerprint` (`forbidden`)           |

The packed package contains `LICENSE`, `package.json`, and the reviewed `dist` graph only. It cannot
gain Nuxt, Nitro, H3, Better Auth server, MCP, lifecycle-install, legacy root export, or package-local
package-manager fields without changing a closed profile and its adversarial tests.

## Executed evidence

```text
pnpm run check:vue-package-exports
  PASS — 23 source files scanned; 3 entries deep-checked

pnpm run check:vue-sbom
  PASS — exactly convex@1.42.2, ohash, and vue@3.5.39

pnpm run check:vue-candidate
  PASS — 3 maintained production consumers, one exact tarball
  PASS — anonymous dependency/bundle purity
  PASS — authenticated identity and operation lifecycle
  PASS — separate-Vue-copy embedded attachment and disposal

pnpm exec vitest run <10 package-certification suites>
  PASS — 164 tests

pnpm run lint
  PASS
```

The full suite before commit passed 1,765 of 1,777 tests. Two stale tests still treated `vue` as an
unknown selector and were corrected to use the genuinely unreviewed `mcp` selector. The remaining ten
failures were the release verifier correctly rejecting dirty `package.json` bytes against Git HEAD; the
exact-HEAD suite is rerun after this coherent certification commit.

## Deletion and simplification

- No second Vue certifier was added.
- The existing package descriptor, entry checker, packed-artifact checker, production-manifest
  contract, SBOM generator, runtime-fingerprint policy, and candidate-app runner now select the Vue
  profile.
- The three prior standalone consumer scripts retain focused local use, but the release gate owns the
  single pack and passes one tarball to all of them.
- `better-convex-vue` has no copied release pipeline and no workspace-link-only certification path.
