# Better Convex agent guide

Work like a maintainer whose name is on the release. Keep one source of truth
for each behavior. Delete an obsolete path instead of keeping a compatibility
layer for it. The repository follows the
[Lupinum OSS standard](https://oss.lupinum.com); procedures (releasing,
dependencies, security incidents) live there, not here.

## Before you start

- Run `git fetch origin` and branch from `origin/main`. A local `main` can be
  behind, and work based on it can repeat a change that is already merged.
- Search open pull requests and issues for the topic first
  (`gh pr list --search`, `gh issue list --search`).
- Check claims about Convex client or server behavior in the installed
  `node_modules/convex` source, not from memory.

## Repository scope

This repository contains four packages:

- `@lupinum/better-convex-nuxt` (repository root): the Nuxt module, Nitro
  helpers, server rendering, and optional Better Auth support.
- `@lupinum/better-convex-vue` (`packages/vue`): the Vue composables and the
  browser client lifecycle that the Nuxt package also uses.
- `@lupinum/better-convex-functions` (`packages/functions`): operations,
  policy, row rules and internal operations for Convex functions
  (`defineFunctions`). It imports only `convex`.
- `@lupinum/better-convex-agents` (`packages/agents`): tools derived from those
  operations (`defineTools`), approvals, agent limits and activity, and the
  MCP door (`./mcp`: `createMcpServer` and the `handleMcpRequest` transport)
  inside a Convex HTTP action. Only `./mcp` loads the MCP SDK.

Nuxt and Vue always share one version (a Changesets `fixed` group); Functions
and Agents version on their own. Functions and Agents are an opt-in layer, not part
of the toolkit below: Functions wraps every function of an app that installs
it, checks one policy and one rule per table, and fails a test for every other
path to the database (D31); Agents builds on it. The toolkit rules apply to the
Nuxt and Vue packages; inside `packages/functions` and `packages/agents`, keep
the layer small, and add an option only for a failing test or a real
application that needs it.

Convex functions decide what a user may read or change. Do not move that
decision into Vue, Nuxt middleware, MCP transport, or cached client state.

## A toolkit, not a framework

Better Convex is a set of composables and helpers that an application picks
from. Keep it that way:

- Do not add registries, manifests, required folders, or new file-name
  conventions. The one existing convention is the optional
  `<srcDir>/convex-auth.ts` auth-client definition.
- Do not add lifecycle phases that an application must follow.
- Do not generate code beyond Convex's own codegen and the Better Auth schema
  and adapter.
- Write a new server helper as a plain function that takes `ctx` (and its
  inputs) and works inside an ordinary Convex query, mutation, action, or MCP
  `configureServer` callback.
- Wait until a pattern appears in three real applications before you promote
  it to a library helper. Until then, document it as a recipe.
- Document the cost of every server helper: which tables or components it
  reads, what it writes, and which query subscriptions it invalidates.

## Commands

Use the pinned pnpm version through Corepack.

```bash
pnpm install
pnpm dev               # source playground on port 4578 (see "Local backend")
pnpm test              # unit, security, Convex, Nuxt, browser, auth-adapter and fuzz suites
pnpm format            # apply formatting
pnpm verify            # lint, typecheck, test, build, packed-package checks, pnpm audit
pnpm changeset         # describe a user-facing change for the next release
```

`pnpm verify` is the local definition of done. CI also runs three slower jobs
as parallel checks; run them locally when your change touches their area:

```bash
pnpm test:integration  # real-backend auth, OAuth, MCP suites and the beta-to-1.0 upgrade
pnpm test:e2e --full   # full-stack playground journeys, including test/e2e/extended
pnpm test:starters     # every starter and the packed Vue/Nuxt/Agents consumers, from local tarballs
```

`pnpm build` builds the four packages, the docs site, and each package's
`dist/agent/` (the rendered docs, exported as `<package>/agent-docs`).
`pnpm test:packed` packs the packages like a release, runs publint and
`@arethetypeswrong/cli`, imports every public entry from the tarballs, and
fails when a tarball contains env files, keys, or test credentials.

## Local backend

The integration and end-to-end suites start an anonymous local Convex backend.
The binary version and its SHA-256 are pinned in
`test/helpers/local-backend.json`; `test/helpers/local-backend.mjs` downloads
and verifies it.
Never give production credentials to these commands, and never select a cloud
deployment for them. `pnpm dev` also needs a local backend that you select on
purpose; the e2e helper `test/helpers/local-convex.ts` (`ensureLocalConvex`)
starts one with synthetic auth secrets. Remove `playground/.convex` and
`playground/.env.local` from a disposable worktree afterwards.

## Hard rules

- Never publish to npm, push to `main`, create tags or releases by hand.
  Releases happen when a maintainer merges the "Version packages" pull request
  and approves the protected `npm` environment (`.github/workflows/release.yml`).
- Never add `NPM_TOKEN` or any other long-lived publish credential.
- Add a changeset (`pnpm changeset`) to every pull request that changes what
  package users install: code, types, runtime behaviour or dependencies.
  Documentation, tests and CI changes need none. CI requires one when `src/` or `packages/*/src/` changes; use
  `pnpm changeset --empty` if users see nothing. When the `dependencies` or
  `peerDependencies` of a published package change, the changeset must bump
  that package (at least `patch`); an empty one does not count.
- Changeset style: one line in present tense that starts with Fix, Add, Remove
  or Change and says what changed for users. At most five short lines of
  detail may follow. A breaking change adds a line that starts with
  `Migration:` and says what users must do.
- The repository is in Changesets prerelease mode (`rc`) until 1.0.0; see
  DECISIONS.md before you run `changeset pre exit`.
- Do not bypass the 24-hour dependency quarantine (`minimumReleaseAge`). Do not
  add dependencies to `allowBuilds` without a reason.
- Pin GitHub Actions to full commit SHAs. Give each job only the permissions it needs.
- Keep tooling lean. Add a script, check or workflow only when it guards
  behavior users rely on or closes a real attack path. Process is not security.
- Record lasting choices in [DECISIONS.md](DECISIONS.md).
- Do not commit `dist/`, `.nuxt/`, `.output/`, credentials, or deployment URLs.
- Use a short descriptive branch name, such as `fix/auth-proxy-limit`, without
  a tool prefix such as `codex/` or `claude/`.

## Security

Read `SECURITY.md` before you change authentication, OAuth, MCP, the auth
proxy, sessions, tokens, keys, secrets, or authorization.

- Never weaken a security check or a negative security test to make an
  unsupported configuration pass. Fix the code.
- Keep one owner for each session, identity, token, key, route, and package
  contract.
- Keep server-only code out of browser bundles. `scripts/check-boundaries.mjs`
  (part of `pnpm lint`) enforces the import layering: framework-free errors,
  no Nuxt in the Vue package, only functions, Convex and (in `./mcp`) the MCP SDK in the agents package, no Node or
  Nuxt code in the Convex auth component, no server code in browser runtime.
- Never let a caller choose an origin, issuer, upstream URL, function, or
  principal.
- Check authorization in Convex, in the same transaction as the protected
  write.
- Do not add a generic function bridge, a compatibility adapter, or a second
  auth store.
- Add a negative test for every security or boundary failure you fix.

## Documentation

Follow `docs/WRITING.md`.

The documentation is also agent documentation. `pnpm build` copies the rendered
pages into every package as `dist/agent/`, and coding agents in user projects
read them and copy their examples. Keep every example complete and safe to
copy: authorization inside the Convex function, complete documents in
optimistic updates, and reads from the local store, not from component state.
`scripts/agent-docs.mjs` writes the entry page: a "Start here" task table and
the rules agents most often get wrong. Update both when a page moves or a rule
changes; the build fails when the table names a missing page or a page link
cannot be resolved.

The argument and data rules that the composables keep are D29 and D22 in
[DECISIONS.md](DECISIONS.md). Do not change them in passing. When a public contract changes, update the docs,
examples, types, tests, and package exports in the same change. Do not rewrite
legal text, code, API identifiers, quotations, or changelog history to match
the writing guide.
