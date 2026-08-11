# Paired auth-schema artifact certification — 2026-07-22

## Outcome

The auth-schema release gate now installs the exact Nuxt candidate together with
its exact Vue companion instead of resolving the unpublished exact Vue version
from the public npm registry.

This closes a certifier defect found while verifying the immutable
`0.8.0-beta.3` pair. The package runtime was not at fault: all source, Vue
consumer, Nuxt E2E, OAuth, DAST, and advisory gates had passed before the schema
fixture's package install returned an npm `404` for
`better-convex-vue@0.8.0-beta.3`.

## Invariant

- Release verification supplies both immutable candidate tarballs.
- The packaged auth-schema fixture installs the Nuxt tarball and overrides its
  exact Vue dependency with the supplied Vue tarball.
- The fixture never falls through to an unpublished registry package.
- Standalone source checks create one temporary reviewed Vue companion from the
  same isolated checkout; they do not create another publication path.
- Neither candidate is rebuilt during immutable-artifact verification.

## Executed proof

```text
pnpm exec vitest run test/unit/release-workflow.test.ts
15 tests passed

BCN_RELEASE_TARBALL=<absolute beta.3 Nuxt tarball> \
BCN_RELEASE_VUE_TARBALL=<absolute beta.3 Vue tarball> \
pnpm check:auth-schema
PASS: curated, Team, Agentic SaaS, local-fixture, and two-factor schema/metadata
are deterministic; a clean tarball consumer and local component both deploy,
perform database-backed first writes, and produce fresh codegen.
```

The beta.3 tarballs remain immutable historical evidence. Since the certifier
changed after their source commit, they must not be repacked or promoted; the
next release candidate is built from a fresh versioned clean commit.
