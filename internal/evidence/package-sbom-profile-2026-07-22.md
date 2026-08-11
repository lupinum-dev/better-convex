# Package SBOM profile evidence — 2026-07-22

## Outcome

`P2-009` removes the SBOM generator's implicit Nuxt package ID and unfiltered root-project graph. Every
invocation now selects a closed package-certification descriptor with `--package`; that descriptor
selects the reviewed SBOM policy and frozen workspace project. An extracted candidate manifest may
still be supplied, but its package name must match the descriptor.

The candidate manifest is the SBOM root and declares its direct runtime dependencies and consumer
peers. The selected frozen workspace project supplies resolved runtime versions and transitives. A
candidate-only direct dependency that the frozen graph cannot resolve fails closed. All declared peers
remain explicit CycloneDX components even though their consumer-owned transitive closure is correctly
outside the library SBOM.

The Nuxt profile retains the existing component namespace, generator identity, exact Better Auth/Convex
physical tuple, manifest-contract digest, and required component set. No caller may supply a profile
name or filesystem package directory.

## Executed proof

```sh
pnpm exec vitest run test/unit/package-sbom.test.ts --reporter=verbose
```

Result: five tests passed. They prove the Nuxt root identity and required peer visibility, reject an
unknown package selector, reject a mismatched candidate identity, reject a candidate dependency absent
from the selected frozen graph, and reject ambiguous or caller-supplied profile arguments.

```sh
pnpm run check:sbom
```

Result: the descriptor-selected Nuxt profile generated and validated 243 production components.

The exact-HEAD release-artifact evidence suite is run after the implementation commit because its
source-commit binding intentionally rejects a dirty `package.json`. The final ledger verification row
records that result.

Focused ESLint and formatting passed for the generator, release integration, manifest script, and
tests. `git diff --check` passed before commit.

## Preserved boundary

No package, public API, runtime dependency, or artifact format was added. The root package's peer
closure is not claimed as bundled: peer components are labeled `required-peer`, and downstream
applications remain responsible for their own resolved SBOM.
