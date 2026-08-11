# Closed release lanes stabilization evidence — 2026-07-23

## Outcome

The protected prerelease workflow now builds the reviewed Vue/Nuxt candidate set once and the reviewed
MCP package once, verifies those immutable bytes, and preserves dependency order through registry
publication:

```text
Vue/Nuxt set + MCP candidate
  → exact verification + protected Nuxt cloud staging
  → Vue published as next-staging + registry byte comparison
  → unchanged Nuxt installed against that exact registry Vue
  → Nuxt published as next-staging + registry byte comparison
  → MCP separate static lane + registry byte comparison
  → stop before shared user-facing tag promotion
```

No workflow input selects a package directory, artifact path, release profile, package name, or version.
The coordinate CLIs resolve only the static package-certification descriptors.

## Authority decision

The npm trusted-publishing documentation checked on 2026-07-23 states that:

- trusted publishing requires npm 11.5.1+ and Node 22.14.0+;
- OIDC authentication applies to `npm publish` and `npm stage publish`;
- other stage operations and ordinary npm commands require interactive or traditional authentication;
- provenance is automatic for eligible public GitHub trusted publishes.

Sources:

- <https://docs.npmjs.com/trusted-publishers/>
- <https://docs.npmjs.com/staged-publishing/>
- <https://docs.npmjs.com/cli/publish/>
- <https://docs.npmjs.com/cli/dist-tag/>

Staged publishing is not the dependency-order proof used here: it requires npm 11.15.0+, and registry
consumer/byte evidence is available only after an interactive approval makes a staged package public.
The workflow instead publishes every candidate under the non-default `next-staging` tag after protected
approval. It deliberately performs no shared dist-tag mutation. Promotion remains a distinct interactive
maintainer action after the whole set is reviewed. No long-lived npm token was added.

## Invariants proved

- Vue and Nuxt come from one source commit, version, package manager, and candidate-set manifest.
- MCP has a separate statically reviewed artifact coordinate and publication lane.
- Each artifact is built once and downloaded by its closed coordinate.
- The multi-path Vue/Nuxt artifact is restored at `.release-artifacts`, its actual common upload root.
- Vue registry bytes equal the approved candidate before Nuxt publication can begin.
- A tracked production npm consumer installs the unchanged Nuxt tarball while resolving the exact Vue
  version from `https://registry.npmjs.org/`; lock provenance and both installed package byte trees are
  checked before typecheck and build.
- Nuxt and MCP registry tarballs are independently byte-compared after publication.
- Only the three protected publication jobs receive `id-token: write`.
- No `NODE_AUTH_TOKEN`, `NPM_TOKEN`, caller-selected artifact path, `latest`, or shared `next` tag exists
  in the workflow.

## Executed evidence

```text
pnpm exec vitest run --project=unit \
  test/unit/release-workflow.test.ts \
  test/unit/package-candidate-set.test.ts \
  test/unit/package-certification-manifest.test.ts
→ 3 files, 58 tests passed

pnpm exec eslint \
  scripts/print-candidate-set-coordinates.mjs \
  scripts/check-nuxt-registry-vue-consumer.mjs \
  scripts/compare-registry-package.mjs \
  test/unit/release-workflow.test.ts \
  test/unit/package-candidate-set.test.ts
→ passed

pnpm typecheck
→ module, server, and auth fixture programs passed

pnpm check
→ formatting, lint, all typechecks, 13 package-boundary rules, 162 files, and 1,848 tests passed

git diff --check
→ passed
```

The full matrix also identified four stale relationship-test fixtures that attempted to create sessions,
accounts, members, or team members without their now-required parent rows. The fixtures now construct
their user/organization/team parents first; production reference enforcement was not weakened.

Actual publication, protected-environment approval, registry comparison, and shared tag promotion remain
external release-authority actions. This evidence changes no npm package or Git tag.
