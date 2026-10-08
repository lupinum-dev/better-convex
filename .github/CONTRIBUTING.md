# Contributing

- Open an issue before a feature, breaking change, authentication change, or
  large refactor, so we can agree on the approach first. Lupinum OG can close
  or defer work that does not fit the product direction.
- Keep pull requests small and focused on one change. Add tests for the
  changed behavior and its failure case, and update the docs when behavior
  changes.
- Run `pnpm verify` before you ask for review. When you change authentication,
  OAuth, MCP, or the starters, also run the matching slower suite listed in
  [AGENTS.md](../AGENTS.md) (`pnpm test:integration`, `pnpm test:e2e --full`,
  `pnpm test:starters`).
- Add a changeset with `pnpm changeset` when users will notice the change.
  The style rules are in [AGENTS.md](../AGENTS.md).
- Follow [docs/WRITING.md](../docs/WRITING.md) for documentation.
- Do not include credentials, tokens, private deployment URLs, or production
  data.
- Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).
