# Better Convex Agent Guide

Act like a maintainer whose name is on the release. Prefer one direct source of
truth. Delete an obsolete path instead of keeping a compatibility layer for an
unreleased path.

## Repository scope

This repository owns three packages:

- `@lupinum/better-convex-nuxt` for Nuxt, Nitro, SSR, and optional Better Auth support.
- `@lupinum/better-convex-vue` for the shared Vue client lifecycle.
- `@lupinum/better-convex-mcp` for the explicit provider-neutral MCP boundary.

Convex functions remain the source of truth for application authorization. Do
not move backend authorization into Vue, Nuxt middleware, MCP transport, or
cached client state.

## Working procedure

An assigned maintenance task includes setup, a focused change, diagnosis,
verification, review, routine pull requests, protected merge, post-merge checks,
and cleanup. Preserve unrelated work and use an isolated worktree. Delegate
bounded independent reviews when useful; keep one owner for each edited file.
External settings and npm publication need their separately approved scope;
the protected npm approval remains the final publication boundary.

Read `MAINTAINING.md` for operations and `RELEASING.md` for Linux artifact
ownership. Use existing tools. Bring Matthias product decisions or concrete
external blockers, not routine setup or terminal work. Explore affected behavior
in a real browser, diagnose a controlled reversible failure, and stop only the
processes and temporary resources you own. Report evidence and limits.

## Commands

Use the pinned pnpm version through Corepack.

```bash
pnpm install --frozen-lockfile
pnpm check:dependencies
pnpm check
pnpm verify
```

Run a focused test while you edit. Run `pnpm check` before handoff for ordinary
code changes. Run the affected security or consumer gate when a change touches
authentication, package exports, generated schemas, release evidence, or
package boundaries.

`pnpm dev` prepares and starts the source playground on port 4578. Its Convex
backend must be local and explicitly selected; follow the executable local
development steps in `MAINTAINING.md`. `pnpm check:auth-backend --install`
installs the reviewed local binary. `pnpm test:e2e` owns an anonymous local backend
and restores playground state; it exercises built source and does not replace a
development-server browser check. Never supply production credentials to either.

Use the canonical repository gates when the change needs them:

```bash
pnpm docs:build
pnpm audit:all
pnpm release:verify
```

Candidate artifact creation, candidate-lock generation, and `pnpm release:smoke`
run only in the reviewed Linux builder. Retain its source-bound artifact for
review; do not regenerate or repair package bytes on macOS.

Do not weaken a security check to make an unsupported configuration pass. Read
`SECURITY.md` before you change authentication, OAuth, MCP, proxy, session,
token, key, secret, or authorization behavior.

## Release safety

Never publish, promote, tag, or create a GitHub release from an agent session.
Follow `RELEASING.md`. The protected workflow must publish the retained and
certified tarballs through npm trusted publishing.

Do not commit `dist/`, `.nuxt/`, `.output/`, candidate applications, generated
archives, credentials, deployment URLs, or release artifacts.

Use a short descriptive branch name, such as `fix/auth-proxy-limit`. Do not
require a tool prefix such as `codex/`, `claude/`, or `cursor/`.

## Documentation

Follow `docs/WRITING.md`. Update public docs, examples, types, tests, and package
exports together when a public contract changes.

Do not rewrite legal text, code, API identifiers, quotations, changelog history,
generated reports, or security evidence to match the controlled-English
profile.

## Architecture rules

- Keep one owner for each session, identity, token, key, route, and package
  contract.
- Keep server-only code outside browser bundles.
- Reject caller-selected origins, issuers, upstreams, functions, and principals.
- Make a live Convex authorization check in the same transaction as a protected
  write.
- Do not add a generic function bridge, compatibility adapter, or second auth
  store.
- Add negative tests for security and boundary failures.
