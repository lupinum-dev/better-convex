# Public Starter

Small Nuxt + Convex starter for public apps.

## Includes

- one public `todos` table;
- realtime list query;
- create, toggle, and remove mutations;
- invariant tests for validation and list ordering.

## Non-goals

- no auth or auth dependencies;
- no organizations;
- no MCP;
- no agents;
- no shared access package.

## Commands

Install once, then start Convex in the first terminal:

```bash
pnpm install
pnpm convex:configure
```

As soon as Convex reports that the functions are ready, use a second terminal:

```bash
pnpm convex:codegen
pnpm dev
```

The Convex CLI writes `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL`. The Nuxt configuration reads
those generated values directly, while `NUXT_PUBLIC_CONVEX_URL` and
`NUXT_PUBLIC_CONVEX_SITE_URL` remain explicit deployment overrides.

Run the local verification gate at any time:

```bash
pnpm test
pnpm typecheck
```

`pnpm convex:configure` creates `.env.local` for the selected deployment. Codegen creates the
authoritative `convex/_generated/api` used by both the app and tests. On later runs, replace
`pnpm convex:configure` with `pnpm convex:dev`; it selects only the deployment recorded in that
file and refreshes generated types whenever the backend changes.
