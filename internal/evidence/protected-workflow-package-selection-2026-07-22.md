# Protected workflow package selection — 2026-07-22

## Outcome

The prerelease and package-preview workflows now resolve artifact coordinates through the reviewed
package-certification descriptor. Both workflows select the literal `nuxt` package ID; neither accepts a
package name, directory, artifact path, or profile from workflow input.

The prerelease workflow transfers only the descriptor-derived immutable package directory between jobs.
The source-only secret and CodeQL job no longer downloads release artifacts it does not inspect. The
separate non-secret cloud-staging report remains its own artifact.

Publication still occurs only in the existing `npm-release` protected environment. The package name,
version, tarball path, and registry comparison filename are descriptor-derived. Existing job permissions,
protected environments, pinned actions, OIDC scope, and cloud-staging dependency remain unchanged.

## Admission and deletion decision

One small internal CLI was admitted because GitHub jobs cannot share an imported JavaScript object and
repeating inline coordinate serialization had already produced three copies. The CLI accepts exactly
`--package <reviewed-id>`, delegates all selection and validation to the closed descriptor, emits only
line-safe allowlisted fields, and is not a package export.

Deleted instead of generalized:

- the unused artifact download in the source-only security job;
- three inline artifact-coordinate serializers in the protected workflow;
- repository-wide `.release-artifacts/` uploads for candidate and preview artifacts.

No generic release package input, arbitrary path input, publication matrix, or additional authority was
added.

## Executed proof

```text
pnpm exec vitest run \
  test/unit/package-artifact-coordinate-cli.test.ts \
  test/unit/package-artifact-coordinates.test.ts \
  test/unit/package-certification-manifest.test.ts \
  test/unit/release-workflow.test.ts \
  test/unit/package-preview-workflow.test.ts \
  test/unit/auth-cloud-staging.test.ts \
  test/unit/security-governance.test.ts --reporter=dot
```

Result: 7 files and 122 tests passed.

```text
pnpm exec eslint \
  scripts/print-package-artifact-coordinates.mjs \
  test/unit/package-artifact-coordinate-cli.test.ts \
  test/unit/release-workflow.test.ts \
  test/unit/package-preview-workflow.test.ts
pnpm format:check
git diff --check
```

Result: all passed.

The CLI adversarial matrix rejects a missing selector/value, unknown ID, path-like selector, duplicate
selector, and extra option. Workflow tests prove one build, one descriptor-scoped upload, three
descriptor-scoped downloads, no artifact transfer to the source-only security job, descriptor-derived
registry comparison, unchanged protected environments and OIDC confinement, and commit-pinned actions.
