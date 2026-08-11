# Ginko CI and candidate authority stabilization

Date: 2026-07-23

BCN source: `4db5eac3f06483bf9c191bb58bec6fd2f548b037`

Ginko source: `80a326a4`

## Outcome

Ginko's untrusted pull-request workflow now operates with read-only repository permission, exact
SHA-pinned actions, a pinned Node/Corepack toolchain, disabled checkout credential persistence, and no
private upstream-read credential. Read-only repository inspection confirmed that the two formerly
checked-out upstream repositories are public, so the credential and private-source jobs had no valid
authority requirement.

The source-repacked candidate jobs were deleted. Ginko's candidate packer now accepts Ginko Content
only through its immutable release manifest and accepts the Better Convex Vue/Nuxt pair only through
the closed candidate-set manifest. It checks the compatibility-pinned source commit, package version,
SHA-256, runtime fingerprint where applicable, individual package evidence, contained artifact paths,
and the package metadata inside each tarball.

This is a hard cut: upstream Git worktrees, caller-selected tarball paths, workspace links, and source
checkout aliases no longer establish candidate authority.

## Executed proof

```text
./node_modules/.bin/vitest run test/module/candidate-release-contract.test.ts
  1 file, 7 tests passed

./node_modules/.bin/eslint \
  scripts/candidate-pack.mjs \
  test/module/candidate-release-contract.test.ts
  passed

git diff --check
  passed
```

The workflow contract additionally asserts:

- `contents: read`;
- `persist-credentials: false`;
- exact action SHAs;
- exact Node and Corepack versions;
- frozen installation;
- absence of secrets, repository substitutions, and source candidate packing.

## Deliberate remaining boundary

`@better-convex/mcp` is not retrofitted into the retired beta.0/beta.6 evidence. Ginko's existing MCP
Git override is removed only when the fresh beta.1 MCP artifact exists and can be added to the same
closed compatibility record. That is `S6-003`/`S6-004`, not a parallel compatibility path.

The interrupted local install also demonstrated why the exact successor tuple is required:
`better-convex-vue@0.8.0-beta.4` is intentionally unpublished, so a clean registry-only reinstall
cannot reconstruct the old development graph. No passing exact-store claim is made for that retired
tuple.
