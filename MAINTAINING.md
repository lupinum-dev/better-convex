# Maintaining Better Convex

The repository publishes `@lupinum/better-convex-nuxt`, `@lupinum/better-convex-vue`, and
`@lupinum/better-convex-mcp`. Each package manifest owns its package contract. Keep the
coupled Vue and Nuxt versions aligned. Change the MCP version only when its own
public contract changes.

## Daily work

Create a focused branch from `main`. Use Conventional Commits. Run the narrowest
useful check while you edit, then run:

```bash
pnpm check
pnpm verify
```

Use `pnpm docs:build` for documentation changes. Use `pnpm audit:all` after a
dependency update. Use `pnpm release:verify` only for an exact release candidate.

## Local development

Use a fresh isolated worktree for this disposable auth playground. Install with
`pnpm install --frozen-lockfile`, then run `pnpm check:auth-backend --install`.
Prepare package entries with `pnpm --dir packages/vue build && pnpm dev:prepare`
before starting the backend, which imports those entries. The first prepare can
warn that the backend URL is missing; the helper below supplies it.
Do not copy `.env.local`, `.convex`, or production credentials into that worktree.
The existing local helper selects an anonymous loopback backend, checks its
reviewed binary, configures synthetic auth secrets, and rejects cloud selection.

From the repository root on macOS or Linux, start the existing helper and dev
command together:

```bash
CONVEX_E2E_AUTO_START=true BCN_E2E_REQUIRE_LOCAL=true node --input-type=module <<'NODE'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createJiti } from 'jiti'
const { ensureLocalConvex } = await createJiti(import.meta.url).import('./test/helpers/local-convex.ts')
const local = await ensureLocalConvex({ authOrigin: 'http://localhost:4578' })
try {
  const app = spawn('pnpm', ['dev'], {
    detached: true,
    stdio: 'inherit',
    env: { ...process.env, ...local.env, SITE_URL: 'http://localhost:4578' },
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => process.kill(-app.pid, 'SIGTERM'))
  }
  const [code] = await once(app, 'exit')
  process.exitCode = code ?? 1
} finally {
  await local.release()
}
NODE
```

Wait for Nuxt readiness at `http://localhost:4578`. Create a synthetic account
through `/auth/signup`, then sign in normally. This local flow needs no cloud
account or real email delivery. Keep the same session while editing. Test a
failure and recovery, then reload to check session continuity. `Ctrl-C` stops
the owned dev process and releases the backend. Remove the disposable worktree's
`playground/.convex` and `playground/.env.local` after shutdown. Preserve those
paths in an existing developer checkout; use the isolated worktree instead.

`pnpm test:e2e` separately runs built-source journeys and restores playground
state. It does not replace the dev-server check. A local pass does not certify
Linux candidate bytes or hosted provider behavior.

The 6 September 2026 maintenance trial passed on macOS with Node 24 and pinned
pnpm 11.21.0: ordinary local signup/sign-in, rejected password and recovery,
authenticated query, task persistence, keyboard interaction, HMR/reload session
continuity, sign-out, and the explicit route guard. Owned browser/backend/dev
processes and synthetic state were removed. `pnpm verify` passed, including
2,753 tests, packed export probes, and docs build. Linux candidate, compatibility
matrix, and nightly auth-load certification remain required separately.

## Quick fixes

Keep one cause and one verification path in the pull request. Add a regression
test when the defect can return. Run `pnpm verify` before handoff.

## Large changes

Open an issue first. Split the work by public behavior and package ownership.
Keep application authorization in Convex and server-only code outside browser
bundles.

## Dependencies

Renovate opens weekly dependency pull requests. It must not merge them
automatically. Review the resolved lockfile, upstream security notes, generated
schemas, consumer fixtures, and exact package boundaries before merge.

Use `security/upstream-convex-better-auth.json` as the only upstream auth review
ledger. Do not add another handwritten advisory list.

Run `pnpm check:dependencies` to validate maintained install configuration
and expiry failures. The same gate runs on every pull request and the existing
nightly schedule. `scripts/check-dependency-policy.mjs` is the repository-owned
copy of the Lupinum OSS checker; update it from the canonical shared file.

Generated consumers call `prepareConsumerDependencyPolicy` before every install.
It copies the maintained quarantine fields and inline exception metadata, then
checks the actual generated file. Consumer companion overrides remain explicit;
root workspace overrides and package extensions are omitted so the probe tests
the published dependency graph and selected framework version. npm receives the
same age cutoff. Local file tarballs need no registry-age exclusion; the isolated
candidate registry supplies controlled publication metadata instead.

## Releases

Follow [RELEASING.md](./RELEASING.md). The protected workflow is the only normal
publication path. It must publish only retained artifacts that passed source,
consumer, security, and registry checks.

The reviewed Linux workflow is the byte authority for release artifacts.
`npm pack` can produce the same uncompressed tar archive
with different gzip bytes on macOS because the host zlib implementation is
different. Do not record workstation hashes or run artifact creation or
`release:smoke` outside the Linux builder. Verification of
an already retained artifact remains platform-independent.

Use `pnpm changelog` to draft the public notes from Conventional Commits. Review
the result and remove internal rehearsal details. `CHANGELOG.md` records only
versions that npm contains. Do not use Changelogen to publish, push, tag, or
change package versions.

Normal maintenance has four steps:

1. Merge one reviewed changelog intent (`## v<version>` for Vue/Nuxt or
   `## mcp-v<version>` for MCP).
2. Wait for exact-current-`main` CI to retain the candidate.
3. Review the release card and approve the protected `npm` environment only
   when it requests approval.
4. Verify npm, provenance, tag, GitHub Release, and assets from the completed
   card.

Do not type a version, target, or workflow run ID. Use the input-free manual
dispatch only when the automatic event was missed or an existing retained
candidate needs reconciliation. If more than one intent appears incomplete,
finish the earlier release before merging another intent.

Do not publish from a workstation. Do not add an `NPM_TOKEN`. Do not create a
tag before publication succeeds. If a publication step fails, preserve the
evidence and follow the failure rules in `RELEASING.md`; never rebuild different
bytes for the same version.

## Roll back a defective release

Restore the last known-good dist-tag and publish a forward fix. Do not
unpublish unless npm policy and a confirmed security incident require it.

## Respond to a credential incident

Revoke the credential before you investigate the release. Remove it from
repository and environment scope, rotate every equivalent credential, and
record the affected release artifacts. Restore publishing only after the source
and retained artifacts are verified.

## Documentation

Use [docs/WRITING.md](./docs/WRITING.md). Keep quickstarts executable and keep
security constraints next to the affected action. The generated API and ASVS
documents must remain reproducible from their owning scripts. Update public
documentation in the same pull request as the changed contract. Run
`pnpm docs:build` and `pnpm verify` before merge.

## Audit external settings

Review these settings in January and July, and after an ownership or release
workflow change.

GitHub must have:

- a protected `main` branch with pull requests, linear history, resolved review
  threads, and the repository's required CI, CodeQL, starter, and preview checks;
- squash merge as the only merge method, auto-merge enabled, and merged branches
  deleted automatically;
- GitHub Actions restricted to full commit-SHA references, with default
  workflow permissions read-only;
- Issues enabled for public reports, with Wikis and Discussions disabled so
  versioned repository documentation remains authoritative;
- a protected `npm` environment with the restrictions in
  [RELEASING.md](./RELEASING.md);
- private vulnerability reporting, secret scanning, push protection, automated
  security fixes, and the committed advanced CodeQL workflow;
- Renovate for routine dependency updates and CodeRabbit as an advisory reviewer.

npm must bind each of the three `@lupinum/better-convex-*` packages to
`publish-prerelease.yml` and the `npm` environment through trusted publishing.
The protected environment allows release deployments only from `main`,
requires a human reviewer, and contains no package token.

The repository and GitHub environments must not contain `CONVEX_DEPLOY_KEY`.
The repository does not deploy the example application. Run its Convex backend
only in a maintainer-owned development deployment. This keeps deployment
credentials outside repository workflows and avoids executing dependencies with
a production-capable key.

Vercel must deploy the `docs/` app from `main` to
`better-convex.lupinum.com`. Keep automatic library branch previews disabled;
request previews on demand. Use Basic build machines unless measured total cost
per successful build and failure evidence justify another choice. Keep on-demand
concurrency off and builds queued. Set the Vercel
Root Directory to `docs`. Do not set an Output Directory override; Nuxt emits
the Vercel Build Output API files. The docs app owns its lockfile and does not
need source files outside the Root Directory. Do not set an Install Command
override. Vercel detects pnpm from the documentation lockfile and installs it
before it runs the committed build command.
