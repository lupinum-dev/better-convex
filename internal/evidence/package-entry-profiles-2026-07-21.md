# Descriptor-bound package entry evidence — started 2026-07-21, finalized 2026-07-22

## Result

`P2-007` replaces the root-global package-entry checker with one closed, descriptor-selected Nuxt
profile. The current vNext build preserves the nine public package entries and passes the stronger
source, dist, whole-artifact, and packed-consumer gates. Unknown package IDs, undeclared entries or
commands, manifest redirects, unreviewed dependencies, malformed emitted code, unresolved graphs,
non-portable archives, dependency shadows, and resource-exhaustion archives fail closed.

The immutable `0.7.0-beta.1` artifact was not changed or rebuilt. Its nine public entries and packed
consumer probes passed the release gate that certified it. The final vNext whole-artifact gate also
examines unexported declarations and therefore correctly rejects that historical tarball: mkdist had
emitted three unreachable generated declarations containing `.js.js` imports. The current build deletes
those non-public declarations and retains the sole public generated declaration, `component.d.ts`.

This work changes release tooling and packed output cleanup only. It adds no public package, runtime
export, compatibility path, or product configuration.

## One owner per concern

- `scripts/package-entry-manifest.mjs` owns package identity, public subpaths, emitted entry paths,
  reviewed value/type names, exact-declaration policy, forbidden names, and the exact public CLI
  command-to-target map. Selection begins with the static package-certification descriptor.
- `scripts/package-check/entry-rules.mjs` owns checker execution policy: source roots, virtual/host
  imports, exact runtime/declaration dependency sets, and packed consumer probes. It joins those rules
  to the public-entry contract by exact subpath bijection without renaming contract fields.
- `scripts/package-check/manifest-consistency.mjs` binds `exports`, `main`, the sole
  `typesVersions["*"]` selector, `files`, package ESM mode, and the exact CLI map to the selected
  contract. Existing-target aliases cannot silently create another public command.
- `scripts/package-check/purity.mjs` walks exact transitive packed JavaScript and declaration graphs.
  Public runtime entries resolve the JavaScript bytes Node will load rather than adjacent declarations.
  Import types, type references, reference paths, and compiler-lib references are validated without
  message-text classification.
- `scripts/package-check/declarations.mjs` uses TypeScript programs and the type checker for public
  runtime/value/type spaces and for every packed JavaScript and declaration module. It catches malformed
  syntax, duplicate or ambiguous exports, missing transitive exports, and declaration/runtime
  substitution.
- `scripts/package-check/tarball.mjs` uses the pinned `tar@7.5.16` parser for header inspection and
  extraction. It enforces one canonical file-only `package/` tree, portable paths, no dependency-shadow
  or nested-package boundaries, bounded file count and declared uncompressed size, whole-artifact
  dependency/syntax checks, and allowlisted virtual/host imports before consumer probes run.
- The default checker now uses the same `npm pack --json --ignore-scripts --pack-destination` semantics
  as the release builder. The former `pnpm pack` path was deleted because pnpm stripped the required
  `packageManager` field and made the checker disagree with the artifact actually released.
- `build.config.ts` removes the three unexported Convex generated declarations after mkdist completes.
  Their standard generated TypeScript sources remain untouched, so running Convex codegen cannot undo
  the cleanup policy.

The old global entry table, directory-regex purity approximation, optional purity fallback,
warning-only star handling, permissive Node-prefix shortcut, pnpm-only pack path, root-only tarball
constants, and dead generated declarations were removed in the hard cut.

## Adversarial findings closed

Independent hostile reviews reproduced and the implementation closes:

1. `main`, `type`, `exports`, condition ordering, `typesVersions`, `files`, or exact bin-map drift;
2. named-default, namespace, enum, destructuring, duplicate, ambiguous, and missing-export cases;
3. adjacent `.d.ts` files falsely certifying broken runtime JavaScript;
4. broken unlinked JavaScript or declarations outside the nine public entry graphs;
5. computed/indirect loaders, CommonJS, unreviewed virtual modules, and fake `node:*` built-ins;
6. unresolved import, import-type, type-reference, reference-path, and compiler-lib edges;
7. archive traversal, links, special entries, case collisions, trailing-dot/space names, colons,
   Windows device names, nested package boundaries, and dependency-shadow directories;
8. excessive archive entry count, per-file declared size, or total declared uncompressed size; and
9. a default-pack/release-pack mismatch that removed required production manifest metadata.

Each class has an executed positive or negative regression. The checker does not classify emitted
failures by searching English error messages.

## Executed proof

```sh
pnpm exec vitest run \
  test/unit/package-entry-manifest.test.ts \
  test/unit/package-entry-declarations.test.ts \
  test/unit/package-entry-purity.test.ts \
  test/unit/package-export-cli.test.ts \
  test/unit/package-artifact-paths.test.ts \
  test/unit/package-manifest-consistency.test.ts
```

Result: six files and 88 tests passed.

```sh
pnpm exec vitest run \
  test/unit/package-artifact-coordinates.test.ts \
  test/unit/package-artifact-paths.test.ts \
  test/unit/package-certification-manifest.test.ts \
  test/unit/package-entry-declarations.test.ts \
  test/unit/package-entry-manifest.test.ts \
  test/unit/package-entry-purity.test.ts \
  test/unit/package-export-cli.test.ts \
  test/unit/package-manifest-consistency.test.ts \
  test/unit/package-preview-workflow.test.ts \
  test/unit/auth-provenance.test.ts
```

Result: ten files and 175 tests passed.

```sh
node scripts/check-package-exports.mjs --package nuxt --dist-only
```

Result: 155 source files scanned and all nine built entries deep-checked.

```sh
env npm_config_cache=/tmp/bcn-vnext-npm-cache \
  node scripts/check-package-exports.mjs --package nuxt
```

Result: the current tree was packed with release-equivalent npm semantics, extracted, scanned, and
passed the root runtime, errors, auth-client, production Nitro server, and user-sync-trigger consumers.

```sh
pnpm exec vitest run test/unit/release-artifact-evidence.test.ts --reporter=verbose
```

Result: all 32 immutable-artifact evidence tests passed from committed `98144b8d` plus the portable
fixture diff. The fixture uses the pinned certification tar implementation and a file-only archive
inventory; macOS system-tar AppleDouble and directory metadata can no longer mask the intended evidence.

```sh
node scripts/check-package-exports.mjs \
  --package nuxt \
  --tarball .release-artifacts/better-convex-nuxt-0.7.0-beta.1.tgz
```

Expected result: the exact immutable beta fails the new whole-artifact gate with nine diagnostics that
all identify the same three legacy root causes: each unreachable generated declaration is forbidden,
fails TypeScript linking, and contains one unresolved `.js.js` edge. No public entry or historical
artifact was modified to make this evidence green.

Also passed after the final fixes:

- focused ESLint and formatting for every changed checker, build hook, evidence file, and test;
- `pnpm exec vue-tsc --noEmit -p tsconfig.json`;
- `pnpm run check:boundaries` (11 rules, 154 files);
- `node scripts/generate-api-surface.mjs --check`;
- `git diff --check`.

## Preserved baseline and next boundary

The package name, version, public `exports`, `typesVersions`, `main`, command names/targets, file
allowlist, and runtime fingerprint remain unchanged. Historical baseline evidence remains immutable and
records the release gate available when `0.7.0-beta.1` was built.

`P2-008` may enforce workspace dependency direction next. It must consume the reviewed package
identities and cannot create another package-entry, CLI, or dependency-surface registry.
