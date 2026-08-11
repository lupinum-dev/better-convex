# Local package companion certification

- Date: 2026-07-22
- Task: `P2-016`

## Problem closed

After the Vue hard cut, `better-convex-nuxt` depends on the exact planned
`better-convex-vue@0.8.0-beta.0`. The repository-owned `pnpm check:package-exports` command built Nuxt
and then packed its current tree, but its isolated consumers tried to resolve the unpublished Vue
dependency from npm. The command therefore failed before exercising BCN unless a maintainer manually
provided `--vue-tarball`.

The release verifier already supplied explicit immutable Nuxt and Vue tarballs. The defect was only in
the current-tree developer gate; creating another certifier or weakening the isolated install was not
necessary.

## Direct fix

The existing package-export checker now has two closed modes:

- **Current tree:** the root command first builds the reviewed workspace Vue package. The checker packs
  that package into a temporary directory, verifies its canonical name/version and Nuxt's exact
  dependency, passes the tarball into every existing isolated consumer, and removes it in `finally`.
- **Supplied immutable Nuxt artifact:** `--vue-tarball` is mandatory. The checker never discovers,
  rebuilds, or substitutes a companion release artifact.

No package descriptor, artifact coordinate, consumer profile, release workflow, or registry fallback
was added. The same packed probes and production consumers remain authoritative.

## Executed evidence

```text
pnpm exec vitest run --project=unit test/unit/package-export-cli.test.ts
  PASS — 1 file, 13 tests

pnpm check:package-exports
  PASS — Vue and Nuxt production builds
  PASS — temporary reviewed Vue companion
  PASS — 150 Nuxt source files scanned, 9 entries deep-checked
  PASS — root runtime, generated auth schema, errors, auth-client typing,
         production Nitro server caller, and user-sync trigger consumers

pnpm check
  PASS — formatting, lint, module/server/fixture typechecks
  PASS — 12 architecture rules across 3 packages and 259 files
  PASS — 156 test files, 1,797 tests
```

The CLI tests also prove that a supplied Nuxt candidate without a supplied Vue candidate fails before
artifact work. Existing tests continue to reject companion use for another package, duplicate options,
dist-only conflicts, path-like package selectors, and unknown package profiles.

The full gate was run after the implementation commit so immutable release-evidence tests compared the
new `package.json` bytes with the same `HEAD`. All release artifact tamper and source-binding tests pass.
