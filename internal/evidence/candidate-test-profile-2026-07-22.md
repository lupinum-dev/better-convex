# Candidate-test profile evidence — 2026-07-22

## Outcome

`P2-010` replaces the global maintained-app list and implicit `better-convex-nuxt` assumptions with one
closed candidate-test profile selected through the package-certification descriptor. The reviewed Nuxt
profile still contains exactly:

- seven tracked pnpm applications (`demo`, `agency`, `agentic-saas`, `mcp-agent`, `mcp-oauth-agent`,
  `public`, and `team`); and
- one tracked npm production consumer (`test/fixtures/consumer-smoke`).

The runner derives the package name from the descriptor and the local tarball filename from the selected
profile. The same values drive manifest rewriting, lock inspection, installed-package lookup, repository
override rejection, version checks, and byte-for-byte installed-tree comparison. The release verifier
passes its closed package ID directly instead of relying on a package-script default.

Profile validation rejects empty matrices, invalid or traversal-capable fixture paths, duplicate names
or paths, and unsafe tarball filenames. The CLI rejects unknown, duplicate, or missing arguments. A
caller cannot select a profile name or arbitrary fixture path.

## Executed proof

```sh
pnpm exec vitest run \
  test/unit/maintained-candidate-apps.test.ts \
  test/unit/release-workflow.test.ts \
  --reporter=dot
```

Result: two files and 17 tests passed. The exact seven-plus-one profile, immutability, unknown-package
rejection, closed release invocation, tarball lock proof, installed-byte comparison, and production npm
build wiring are covered.

After the implementation commit, the full runner is executed from a clean HEAD:

```sh
pnpm run check:candidate-apps
```

The final ledger verification row records the exact-commit result for all eight consumers.

Focused ESLint and formatting passed for the profile, runner, release verifier, manifest script, and
tests. `git diff --check` passed before commit.

## Preserved boundary

No consumer, public package, public API, dependency, or compatibility path was added. Profile-specific
MCP and Agency checks remain inside the Nuxt candidate profile; they were not generalized into imagined
future package capabilities.
