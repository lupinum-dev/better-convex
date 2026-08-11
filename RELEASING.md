# Releasing Better Convex

Public packages are published only by
`.github/workflows/publish-prerelease.yml` through npm trusted publishing. A
workstation may run disposable checks, but it must never publish, promote, or
create authoritative release evidence.

## The one release path

The order is fixed:

1. Run the fast disposable lock/package smoke.
2. Require one successful clean-Linux source certification for the exact Git
   commit.
3. Perform a read-only staging readiness check.
4. Mint the Vue, Nuxt, and MCP artifacts once.
5. Verify only those artifact bytes and clean consumers.
6. Deploy the exact Nuxt artifact to the dedicated Vercel staging host.
7. Run the protected Convex/Vercel proof and prove complete cleanup.
8. Publish through npm trusted publishing under a run-specific candidate tag.
9. Download each package from npm and compare it with the certified SRI.
10. Stop before moving `latest`, `next`, or another shared dist-tag.

Source certification never runs after immutable minting. Artifact verification
never invokes the full source suite. A generic Vercel preview is a developer
convenience and is not release authority.

## Fast local smoke

From a clean checkout with the reviewed Node, npm, Corepack, and pnpm versions:

```bash
pnpm install --frozen-lockfile
pnpm release:smoke
```

`release:smoke` validates the workspace versions and standalone locks, builds
disposable release-equivalent Vue/Nuxt/MCP tarballs, verifies their exports and
dependency closure, installs representative clean consumers, and runs the
packaging and cloud-verifier regression tests. It creates no immutable artifact
directory and must leave the checkout clean.

Use the smoke loop while correcting pre-mint failures. Do not run the complete
release family locally as a second certification pass.

## Hosted source certification

The `release-gate` check is the sole full source certification. Independent
Linux jobs run the core, auth, end-to-end, and secret-scanning lanes in
parallel. `release-gate` is a small fail-closed aggregator: it succeeds only
when every lane succeeds.

The protected tag workflow reads GitHub's check-run API and requires a
successful `release-gate` produced by GitHub Actions for the exact tagged
commit. It does not rerun those source suites.

The source lanes are defined by `scripts/release-source-certification.mjs`:

- `core`: formatting, lint, types, boundaries, the broad test matrix, ASVS,
  SBOM, and package contracts;
- `auth`: the complete auth/OAuth/MCP verification matrix;
- `e2e`: the full application E2E, proxy DAST, and advisory gates.

## Read-only staging readiness

Before any artifact is minted, the protected `bcn-auth-staging` environment
runs:

```bash
pnpm test:auth-cloud-staging --readiness-only
```

This mode performs no deployment, mutation, cleanup, account creation, or
report write. It verifies the authenticated machine-readable Convex deployment
authority, exact team/project/deployment, configured origins, closed public
ingress, the leased host fingerprint endpoint, and zero rows in every currently
mounted staging proof table.

The environment is dedicated release infrastructure. Its concurrency group is
exclusive; operators must not use it during a release.

Required GitHub environment variables:

- `BCN_AUTH_STAGING_CONVEX_URL`
- `BCN_AUTH_STAGING_CONVEX_SITE_URL`
- `BCN_AUTH_STAGING_ORIGIN`
- `BCN_AUTH_STAGING_TEAM`
- `BCN_AUTH_STAGING_VERCEL_ORG_ID`
- `BCN_AUTH_STAGING_VERCEL_PROJECT_ID`

Required secrets:

- `BCN_AUTH_STAGING_CONVEX_DEPLOY_KEY`
- `BCN_AUTH_STAGING_INGRESS_LEASE`
- `BCN_AUTH_STAGING_VERCEL_TOKEN`
- `BCN_AUTH_STAGING_EMAIL`
- `BCN_AUTH_STAGING_PASSWORD`

The Convex key must be deployment-scoped. The Vercel project and organization
IDs bind the deploy to the dedicated staging project. The staging origin must
reject unleased fingerprint and auth requests at the edge.
`CONVEX_SITE_URL` is a Convex built-in deployment value: the workflow verifies
it but never sets or overrides it.

## Immutable artifacts and artifact-only verification

The protected workflow creates exactly one final tarball for each package and
stores immutable evidence under:

```text
.release-artifacts/vue/<version>/
.release-artifacts/nuxt/<version>/
.release-artifacts/mcp/<version>/
.release-artifacts/set/<nuxt-version>/
```

Each package evidence set contains the tarball, content manifest, CycloneDX
SBOM, source commit, package identity, SHA-256, and SRI. Nuxt also records its
deterministic payload-derived runtime fingerprint.

`scripts/verify-release.mjs` is intentionally artifact-only. It recomputes the
evidence, checks exports and dependency closure, and frozen-installs clean
consumers against the selected tarballs. It cannot invoke `check`,
`verify:auth`, E2E, DAST, or another source certification suite.

Immutable artifact directories cannot be overwritten or repacked. A transferred
artifact can be checked without rebuilding it:

```bash
node scripts/release.mjs verify \
  .release-artifacts/nuxt/X.Y.Z-beta.N/artifact.json \
  --package nuxt
```

## Protected staging proof

After artifact-only verification, the workflow copies the maintained staging
host fixture and binds all three Better Convex dependencies to the exact
downloaded tarballs. The pinned Vercel CLI deploys that fixture only to the
configured staging project. The workflow waits until the protected origin
serves the exact Nuxt runtime fingerprint.

The cloud proof then:

- verifies the same artifact family again;
- deploys the exact fixture contract to the dedicated Convex deployment;
- proves zero pre-write state;
- exercises auth, session JWT, MCP authorization, rate limiting, JWKS rotation,
  and bounded concurrency races;
- deletes all fixture rows; and
- proves zero post-cleanup state before writing the non-secret report.

Any non-empty readiness or cleanup proof blocks publication. Staging is not
`continue-on-error` and publication jobs depend on its success.

## Publication and registry equality

Only the three npm jobs receive `id-token: write`, and only through the
protected `npm-release` environment. They publish the retained tarballs under a
run-specific `candidate-<run-id>` tag, download the registry packages, and
compare exact bytes/SRI.

No shared user-facing dist-tag is moved by this workflow. After all three
registry comparisons pass, a maintainer may separately move the intended
shared tag. Never move a shared tag before exact registry equality is proven.

## Failure, retry, and version rules

Before immutable minting:

- fix source, test, timeout, lock, readiness, or infrastructure failures on the
  same reserved coordinates;
- rerun the exact failing test in isolation before changing a timeout;
- raise a timeout only when measured bounded work legitimately needs it; and
- never retire a coordinate for an ordinary pre-mint failure.

After immutable minting:

- a deterministic failure that requires a source or package change retires the
  coordinates;
- an infrastructure interruption gets one retry against the same downloaded
  artifact hashes;
- a second identical failure pauses publication for investigation; and
- do not create a second successor in the same release attempt. Diagnose the
  pipeline instead.

Never delete, replace, rebuild, repack, or publish a retired immutable
coordinate. The internal decisions ledger and retained evidence directories
record private rehearsal failures. `CHANGELOG.md` contains only versions that
were actually published to npm.

## Package previews

`.github/workflows/package-preview.yml` builds a disposable Vue/Nuxt set and
uploads the exact Nuxt tarball to pkg.pr.new for same-repository pull requests.
It does not run source certification, create release authority, publish to npm,
or gate a release. Vercel's generic PR previews are likewise non-authoritative.

## Public history

The release pull request is squash-merged after the hosted source certification
is green. Public launch notes name only the final published coordinates.
Unpublished rehearsal numbers remain private release evidence, not changelog or
launch material.
