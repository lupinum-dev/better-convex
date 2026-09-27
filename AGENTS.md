# Better Convex agent guide

Work like a maintainer whose name is on the release. Keep one source of truth
for each behavior. Delete an obsolete path instead of keeping a compatibility
layer for it.

## Repository scope

This repository contains three packages:

- `@lupinum/better-convex-nuxt`: the Nuxt module, Nitro helpers, server
  rendering, and optional Better Auth support.
- `@lupinum/better-convex-vue`: the Vue composables and the browser client
  lifecycle that the Nuxt package also uses.
- `@lupinum/better-convex-mcp`: MCP request handling inside a Convex HTTP
  action.

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
pnpm install --frozen-lockfile
pnpm check:dependencies
pnpm check
pnpm verify
```

Run a focused test while you edit. Run `pnpm check` before handoff for ordinary
code changes. Run the matching security or consumer check when a change touches
authentication, package exports, generated schemas, or package boundaries.

`pnpm dev` prepares and starts the source playground on port 4578. Its Convex
backend must be a local backend that you select on purpose; follow the local
development steps in `MAINTAINING.md`. `pnpm check:auth-backend --install`
installs the tested local backend binary. `pnpm test:e2e` starts an anonymous
local backend and restores the playground state afterwards. It tests built
source and does not replace a browser check against the development server.
Never give production credentials to either command.

Use these repository checks when the change needs them:

```bash
pnpm docs:build
pnpm audit:all
pnpm release:verify
```

Release artifacts, their lock files, and `pnpm release:smoke` are built only in
the Linux release workflow. Do not build or repair package tarballs on macOS.

## Security

Read `SECURITY.md` before you change authentication, OAuth, MCP, the auth
proxy, sessions, tokens, keys, secrets, or authorization.

- Never weaken a security check or a negative security test to make an
  unsupported configuration pass. Fix the code.
- Keep one owner for each session, identity, token, key, route, and package
  contract.
- Keep server-only code out of browser bundles.
- Never let a caller choose an origin, issuer, upstream URL, function, or
  principal.
- Check authorization in Convex, in the same transaction as the protected
  write.
- Do not add a generic function bridge, a compatibility adapter, or a second
  auth store.
- Add a negative test for every security or boundary failure you fix.

## Release safety

Never publish, promote, tag, or create a GitHub release from an agent session.
Follow `RELEASING.md`. Only the protected workflow publishes packages, through
npm trusted publishing.

Do not commit `dist/`, `.nuxt/`, `.output/`, generated archives, credentials,
deployment URLs, or release artifacts.

Use a short descriptive branch name, such as `fix/auth-proxy-limit`. Do not
add a tool prefix such as `codex/`, `claude/`, or `cursor/`.

## Documentation

Follow `docs/WRITING.md`. When a public contract changes, update the docs,
examples, types, tests, and package exports in the same change.

`docs/content/docs/7.reference/7.api-surface.md` is generated. Change
`scripts/generate-api-surface.mjs` or the source it reads, then run
`pnpm docs:api-surface`.

Do not rewrite legal text, code, API identifiers, quotations, changelog
history, or generated reports to match the writing guide.
