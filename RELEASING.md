# Releasing Better Convex Nuxt

Public packages are published only by `.github/workflows/publish-prerelease.yml`
through npm trusted publishing. A workstation may build an artifact for review,
but it must never publish, promote, or repack a public release.

## Local artifact rehearsal

Start from a clean reviewed, non-shallow checkout with tags. Its package version
must have a matching `CHANGELOG.md` section and must not reuse a tag owned by a
different commit. Then run:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check:auth-backend --install
pnpm release:prepare
```

The preparation command first builds once and invokes
`npm pack --ignore-scripts` once. Source-integrity and source-runtime gates then
run from the reviewed checkout; artifact-dependent package, provenance, and
clean-consumer gates install or inspect the one immutable tarball. The auth gate
is hybrid and passes that tarball explicitly to its package-aware sub-gates.
Nothing repacks the candidate. The command writes one immutable,
package-qualified evidence set at
`.release-artifacts/nuxt/<package-version>/` containing:

- the npm tarball;
- a deterministic path/mode/size/SHA-256 content manifest;
- a CycloneDX SBOM;
- a strict schema-v3 artifact evidence manifest that binds the source commit,
  reviewed descriptor ID, npm name, canonical package directory, version, exact
  certification-profile tuple, workspace-root package-manager authority,
  tarball SHA-256 and SRI, content manifest, SBOM, and a random build-generated
  runtime fingerprint embedded in the packed module and endpoint handler.

Verification accepts only the exact version-derived artifact filenames and
re-extracts the tarball to recompute its complete path/mode/size/hash manifest.
The closed Nuxt SBOM profile requires the package identity, raw export/install
surface, dependencies, peers, Node engine, and package-manager declaration;
rejects unreviewed optional/bundled/platform/publish modes and consumer install
or publish lifecycle hooks; and compares the candidate contract exactly with
reviewed source. Export semantics and runtime/type purity remain independently
checked by the package-entry gates. Verification regenerates the canonical
production SBOM with the extracted package manifest as its root. The SBOM
embeds a profile- and schema-bound digest of that production manifest contract.
A sidecar whose own hash is valid but whose content does not match those
independent results is rejected.

vNext accepts no legacy evidence-schema fallback. Historical schema-v2 beta
evidence remains verifiable only from its immutable tagged source checkout.

The npm tarball contains neither `pnpm-lock.yaml` nor a resolved dependency
tree. After the exact candidate/source contract comparison, transitive package
components are therefore resolved from the release checkout's frozen lockfile;
the extracted candidate remains the SBOM root. Consumer-owned peer transitive
dependencies belong in each consuming application's resolved SBOM.

## Commit-addressed package previews

`.github/workflows/package-preview.yml` is a developer preview transport, not
a public npm release path. Each pull-request commit from an in-repository branch
runs the complete `release:prepare` graph, selects the version-derived
`.release-artifacts/nuxt/<package-version>/better-convex-nuxt-<package-version>.tgz`
bound to that exact commit, and passes the prebuilt tarball directly to the
lockfile-pinned `pkg-pr-new` CLI. The path comes from the repository's reviewed
`nuxt` package descriptor; the workflow does not search the artifact directory
or accept a caller-selected package path. pkg.pr.new uploads prebuilt tarballs
as-is; the workflow verifies the candidate again after upload and retains its
evidence set for 14 days. It has read-only repository permission and receives no
npm credential or OIDC publication authority.

Install the pkg.pr.new GitHub App on this repository before the first preview.
The workflow deliberately ignores pull requests from forks. A maintainer can
review a fork commit, move it to an in-repository branch, and open a pull request
there. Maintainers may also run the workflow manually against a selected
reviewed ref.

The pkg.pr.new comment and job summary report a commit-SHA URL. Install that
exact URL in an external clean consumer; do not record a floating PR or branch
URL as evidence. A later commit produces a new URL and cancels an obsolete
in-progress build for the same pull request. The preview URL proves only that
the commit-addressed candidate can be installed from pkg.pr.new. It does not
prove npm trusted publishing, protected cloud staging, registry byte equality,
or any other release blocker described below, and it must never be promoted or
republished as an official package.

Verify a transferred artifact set without rebuilding it:

```bash
node scripts/release.mjs verify .release-artifacts/nuxt/X.Y.Z-beta.N/artifact.json
```

That low-level command may verify an intact evidence set after it has been
transferred to another directory. The repository's `release:verify` orchestration
is intentionally stricter: it accepts only the current package version's
statically reviewed `nuxt` coordinate and cannot be pointed at another package
or release path.

Local artifacts are disposable rehearsal outputs. Do not upload one to npm.

For the vNext package family, build and certify the independent MCP lane before
the Vue/Nuxt candidate set:

```bash
pnpm release:prepare --package mcp
pnpm release:prepare:set
```

The Nuxt maintained-consumer matrix includes the MCP starter and therefore
requires the exact same-commit MCP companion artifact to exist first. This is
an ordering rule, not a reason to merge MCP into the closed Vue/Nuxt
candidate-set schema.

## Trusted prerelease workflow

The protected `v*-*` tag must point at the reviewed commit and exactly match the
prerelease version in the root `package.json`. The workflow then:

1. requires distinct named Security Owner/deputy repository variables and a
   notification-delivery test no older than 30 days;
2. uses Node `22.14.0`, npm `11.5.1`, a frozen pnpm lock, and commit-pinned
   GitHub Actions;
3. builds and packs the statically reviewed Vue/Nuxt candidate set once and the
   statically reviewed MCP candidate once, without accepting package paths or
   release profiles from workflow input;
4. passes those immutable artifacts to a separate job, installs the
   manifest-reviewed local backend there, runs source-integrity/runtime gates
   from the checkout, and runs artifact-dependent provenance, package-entry,
   and maintained clean-consumer gates against the exact tarballs;
5. enters the protected `bcn-auth-staging` environment, reverifies the
   downloaded Nuxt set, proves the staging ingress is closed to unleased
   traffic, requires its fingerprint from the already-deployed public Nuxt
   origin and the real auth/MCP responses, clean-installs and deploys its Convex
   fixture, proves zero persisted staging state, and runs the reduced critical
   races;
6. waits for approval in the protected `npm-release` environment;
7. grants `id-token: write` only to protected publication jobs, publishes Vue
   through npm OIDC under `next-staging`, and byte-compares the registry
   tarball;
8. installs the unchanged Nuxt candidate in a tracked production npm consumer
   against that exact registry Vue version, verifies lock provenance and both
   installed byte trees, then publishes and compares Nuxt;
9. publishes and compares MCP through its separate static lane;
10. stops before changing `latest`, `next`, or another shared user-facing
    dist-tag.

npm trusted-publishing OIDC authenticates `npm publish` and
`npm stage publish`, not `npm dist-tag`. Shared tag promotion is therefore a
separate interactive maintainer action after the complete staged-tag set has
matching registry bytes. Do not add a long-lived automation token to collapse
that authority boundary.

### Protected cloud-staging gate

`bcn-auth-staging` is a dedicated, pre-provisioned Convex production deployment;
the workflow neither creates nor destroys it. The repository can deploy Convex
functions with a deployment-scoped key, but deploying the Nuxt host is
provider-specific. Before approving this protected job, the host operator must
build and deploy the application from the exact downloaded candidate tarball.
The public origin must expose that candidate's package-owned
`/api/_better-convex-nuxt/release-fingerprint` response. A source build or a
different/stale tarball does not register or cannot match that route, so the job
fails before deploying Convex functions or writing application data. Environment
variables cannot assert or override the fingerprint.

This fixed deployment is safe to clean only while the workflow has exclusive
ingress and operator ownership. The host edge must reject requests without the
protected `__Host-bcn-staging-lease` cookie with an exact `403` before Nuxt for
the fingerprint, auth read/write, and MCP probes. The protected workflow proves
that behavior before deployment, then sends the lease only from in-memory HTTP
and browser contexts. The lease is a staging perimeter control, not an
application credential or supported runtime option. The deployment key must be
reserved for this workflow, the environment concurrency group must remain
exclusive, and operators must not invoke Convex functions or write staging data
during a run. If any of those conditions cannot be guaranteed, publication is
blocked; broad cleanup is not safe on a shared environment. Read-only public
protocol metadata and `/api/auth/jwks` remain reachable without the lease so
Convex and standards clients can resolve signing keys; the runner separately
requires the JWKS response to carry the candidate fingerprint and contain no
private key material.

The protected GitHub environment must provide the root HTTPS origins
`BCN_AUTH_STAGING_CONVEX_URL`, `BCN_AUTH_STAGING_CONVEX_SITE_URL`, and
`BCN_AUTH_STAGING_ORIGIN`, plus the exact Convex team slug as
`BCN_AUTH_STAGING_TEAM`, as variables. It must provide a production,
deployment-scoped `BCN_AUTH_STAGING_CONVEX_DEPLOY_KEY` plus the one-time OAuth
owner bootstrap identity's `BCN_AUTH_STAGING_EMAIL` and
`BCN_AUTH_STAGING_PASSWORD` as secrets. It must also provide a random base64url
`BCN_AUTH_STAGING_INGRESS_LEASE` secret containing 43–128 characters and
configure the host edge to require the matching cookie. This account must not
already exist: the job creates it only after the zero-state proof and removes it
during cleanup.
The deployment's persistent application-owned `SITE_URL` must match the
protected public-origin variable. Its deployment-owned built-in
`CONVEX_SITE_URL` must match the protected site URL variable; the workflow must
not try to persist or override that reserved value. Project keys, preview keys,
development keys, a team/project slug other than the protected identity, or
URL/key mismatches fail closed.

After the live host fingerprint matches, the job copies the maintained
`mcp-oauth-agent` starter into a clean temporary directory, replaces its package
dependency with the manifest-selected absolute `.tgz` path, installs with
lifecycle scripts disabled, and verifies the installed module and shared runtime
fingerprint helper carry the same fingerprint. It statically requires exactly
one current component mount named `betterAuth`, generates bounded internal
state-proof functions from every packaged auth model and every starter
application table, and runs `convex deploy` against the named deployment. Before
any account or race write, every mounted auth-model and app-table count must be
zero. A non-empty or malformed proof fails without deleting the unexpected
state.

Once the zero-state proof passes, the job owns the rehearsal data: it creates the
temporary OAuth administrator, runs the same-ID, increment, official JWKS
rotation, provider-owned authorization-code/PKCE races, and the real Better Auth
database-backed lockout/reset path. It exchanges a final persisted session for a
short-lived RS256 JWT, verifies its exact claims and published-key signature, and
requires the named Convex deployment to accept that token with the matching
subject and `convex-session` class. The real auth and MCP proxy responses must
carry the candidate fingerprint. It then deletes every row from all discovered
mounted auth models and application tables. It must re-prove zero state before
writing and uploading
`bcn-auth-staging-report`. The report contains artifact coordinates, public
topology, booleans, and counts—never credentials, codes, verifiers, tokens, or
key material.

Convex does not expose a repository-controlled inventory of data retained by
components that are no longer mounted. The single-mount and zero-row proof
therefore covers the deployed fixture's current `betterAuth` mount, not hidden
state from an earlier unmounted component. Evidence that this dedicated
deployment was provisioned clean and has never hosted another component remains
an external publication blocker, as does the provider-specific Nuxt deployment
record for the exact tarball. A passing report is not a substitute for either
record.

Before the first prerelease, an npm package owner must configure
`publish-prerelease.yml` as the package's only trusted publisher, allow
`npm publish`, protect the `bcn-auth-staging` and `npm-release` environments and
release-tag pattern,
set npm publishing access to **Require two-factor authentication and disallow
tokens**, revoke existing automation write tokens, and test Security
Owner/deputy notification delivery. Those are external release blockers, not
defaults the repository can silently provide.

The `npm-release` approver must withhold approval until the release record for
the downloaded artifact hash contains the empty production-like rehearsal,
separate `bcn-auth-staging` race report, synthetic-advisory notification and
expiry drill, forward-fix timeline, and independent audit with no unresolved
P0/P1 finding. Repository tests cannot manufacture cloud, delivery, or human
review evidence; a missing record blocks publication.

## Security release governance

Every release needs a matching `CHANGELOG.md` entry. When a change affects the
auth schema, adapter invariants, cookie/proxy contract, claims, issuer or
resource binding, OAuth metadata or grants, disabled routes, token lifetimes,
JWKS behavior, secret format, or revocation semantics, the entry must state:

- the exact affected and fixed versions;
- whether the change is a hard cut and whether local-component schema/codegen
  must be regenerated;
- the deployment order and any required session, client-secret, consent,
  provider-credential, or signing-key action;
- protocol or interoperability impact and the gates that verified it;
- any residual bearer/cache window or temporary mitigation.

Security-sensitive notes require the BCN Security Owner and independent
auth/security reviewer to approve the affected range, operator instructions,
and disclosure timing. Those are human approvals; a green workflow cannot
supply them. Follow the compromise and package-version runbooks in
`SECURITY.md`.

For an affected published range, fix forward on a new version first. An
authorized npm owner may then deprecate the exact vulnerable range with a
concise upgrade message and must save registry evidence in the private incident
record. Do not unpublish, reuse a version, move `latest` to untested bytes, or
publish from a workstation.

## Failure and forward fix

Do not unpublish or reuse a version. If any gate or candidate deployment fails,
leave `latest` unchanged, correct the source, obtain independent review, assign
a new prerelease version, and rerun the complete workflow to create new bytes.
Stable publication remains blocked until Better Auth 1.7 stable exists and the
stable gates and independent security review in `plan.md` pass.
