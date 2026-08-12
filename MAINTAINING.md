# Maintaining Better Convex

The repository publishes `better-convex-nuxt`, `better-convex-vue`, and
`better-convex-mcp`. Each package manifest owns its package contract. Keep the
coupled Vue and Nuxt versions aligned. Change the MCP version only when its own
public contract changes.

## Daily work

Create a focused branch from `main`. Use Conventional Commits. Run the narrowest
useful check while you edit, then run:

```bash
pnpm check
pnpm verify
```

## Dependencies

Renovate opens weekly dependency pull requests. It must not merge them
automatically. Review the resolved lockfile, upstream security notes, generated
schemas, consumer fixtures, and exact package boundaries before merge.

Use `security/upstream-convex-better-auth.json` as the only upstream auth review
ledger. Do not add another handwritten advisory list.

## Releases

Follow [RELEASING.md](./RELEASING.md). The protected workflow is the only normal
publication path. It must publish only retained artifacts that passed source,
consumer, security, staging, and registry checks.

Use `pnpm changelog` to draft the public notes from Conventional Commits. Review
the result and remove internal rehearsal details. `CHANGELOG.md` records only
versions that npm contains. Do not use Changelogen to publish, push, tag, or
change package versions.

Do not publish from a workstation. Do not add an `NPM_TOKEN`. Do not create a
tag before publication succeeds. If a publication step fails, preserve the
evidence and follow the failure rules in `RELEASING.md`; never rebuild different
bytes for the same version.

## Documentation

Use [docs/WRITING.md](./docs/WRITING.md). Keep quickstarts executable and keep
security constraints next to the affected action. The generated API and ASVS
documents must remain reproducible from their owning scripts.
