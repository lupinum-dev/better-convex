# Better Convex Agent Guide

Act like a maintainer whose name is on the release. Prefer one direct source of
truth. Delete an obsolete path instead of keeping a compatibility layer for an
unreleased path.

## Repository scope

This repository owns three packages:

- `better-convex-nuxt` for Nuxt, Nitro, SSR, and optional Better Auth support.
- `better-convex-vue` for the shared Vue client lifecycle.
- `better-convex-mcp` for the explicit provider-neutral MCP boundary.

Convex functions remain the source of truth for application authorization. Do
not move backend authorization into Vue, Nuxt middleware, MCP transport, or
cached client state.

## Commands

Use the pinned pnpm version through Corepack.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm verify
```

Run a focused test while you edit. Run `pnpm check` before handoff for ordinary
code changes. Run the affected security or consumer gate when a change touches
authentication, package exports, generated schemas, release evidence, or
package boundaries.

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
