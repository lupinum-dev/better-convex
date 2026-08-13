# Contributing

Better Convex accepts focused fixes and documentation corrections. Open an
issue before you start a feature, breaking change, authentication change, or
large refactor. Lupinum OG can close or defer work that does not fit the product
direction.

## Prepare the repository

Use the Node and pnpm versions declared by the repository.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

Run the affected security and consumer checks when you change authentication,
OAuth, MCP, package exports, generated schemas, or release behavior. Follow
`SECURITY.md` for security-sensitive work.

## Keep the change focused

- Put one concern in each pull request.
- Explain the result and why it is necessary.
- Add tests for the changed invariant and its failure boundary.
- Update public documentation when behavior changes.
- Include before-and-after images for visible interface changes.
- Use Conventional Commits.
- Follow [docs/WRITING.md](./docs/WRITING.md).

Do not include credentials, tokens, private deployment URLs, production data,
or generated release artifacts.
