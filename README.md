<p align="center">
  <img src="docs/public/web-app-manifest-512x512.png" width="128" alt="Better Convex icon">
</p>

<h1 align="center">Better Convex</h1>

<p align="center">Use Convex in Nuxt or Vue with one identity-safe query lifecycle from SSR to realtime.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lupinum/better-convex-nuxt"><img src="https://img.shields.io/npm/v/@lupinum/better-convex-nuxt?label=npm" alt="npm version"></a>
  <a href="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml"><img src="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

> [!WARNING]
> These packages are beta software. The auth architecture is a hard cutover and is not compatible with an existing Better Auth component database. Read the changelog before every upgrade.

## Why use Better Convex?

Better Convex removes the integration code between Nuxt, Vue, Convex, and optional Better Auth. A query can render during SSR, reuse the server result during hydration, and continue as a browser subscription.

Identity changes cannot reuse query state from another user. Server calls are request scoped. Mutations, actions, uploads, connection state, and structured errors use the same runtime model.

## When to use it

Use the Nuxt package for SSR, Nitro calls, generated aliases, uploads, DevTools, and optional Better Auth. Use the Vue package for a Vite or embedded Vue application that does not need Nuxt or Nitro. Use the MCP package when a Convex HTTP Action must expose a bounded MCP server.

Do not use Better Convex as an authorization layer. Every Convex function must still validate identity, ownership, membership, and roles on the backend.

## Requirements

- Node.js `^22.19 || ^24.11`.
- Nuxt `>=4.5.2 <5`, tested at the floor and latest Nuxt 4.
- Convex `>=1.42.2 <2`, tested at the floor and latest 1.x.
- Vue `>=3.5 <4`.

Better Auth is optional. Auth-enabled applications must install the exact peer versions in the package manifest.

## Installation

Install the Nuxt package and its exact peers:

```bash
pnpm add @lupinum/better-convex-nuxt convex@1.42.2 nuxt@4.5.2
```

```ts
export default defineNuxtConfig({
  modules: ['@lupinum/better-convex-nuxt'],
})
```

```dotenv
NUXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

Store this value in `.env.local`. Run the checked configuration helper if you need to create that file:

```bash
pnpm exec better-convex convex configure
```

## Quick start

Call a generated Convex query from a page:

```vue
<script setup lang="ts">
import { api } from '#convex/api'

const { data: tasks, status, error } = await useConvexQuery(api.tasks.list, {})
</script>

<template>
  <p v-if="status === 'pending'">Loading tasks…</p>
  <p v-else-if="error">Could not load tasks.</p>
  <ul v-else>
    <li v-for="task in tasks" :key="task._id">{{ task.text }}</li>
  </ul>
</template>
```

Queries use SSR and realtime updates by default. Queries with empty validators may omit the arguments object. Use the literal `'skip'` to pause a query.

## Server calls and mutations

Create a mutation composable inside component setup:

```ts
const createTask = useConvexMutation(api.tasks.create)
await createTask({ text: 'Review the release' })
```

Create a server caller inside each Nitro request:

```ts
import { api } from '#convex/api'
import { serverConvex } from '#convex/server'

export default defineEventHandler(async (event) => {
  const convex = await serverConvex(event)
  return convex.query(api.tasks.list)
})
```

Do not share an authenticated server caller across requests.

## Authentication

Authentication is off when `convex.auth` is omitted. An auth-enabled application installs the exact Better Auth peers and supplies its public origin.

The module transports identity through a bounded same-origin proxy. Convex functions remain the source of truth for authorization. Route middleware is navigation behavior, not backend access control.

Read the [authentication setup guide](https://better-convex.lupinum.com/docs/get-started/add-authentication) before you enable auth.

For a development setup, run `pnpm exec better-convex init`. It shows the exact
file diff before writing and asks separately before creating development secrets
or the first signing key. It refuses production provisioning.

## Packages

| Package                       | Use it for                                                       |
| ----------------------------- | ---------------------------------------------------------------- |
| `@lupinum/better-convex-nuxt` | Nuxt SSR, Nitro, uploads, DevTools, and optional Better Auth.    |
| `@lupinum/better-convex-vue`  | Identity-safe Convex queries and calls in plain or embedded Vue. |
| `@lupinum/better-convex-mcp`  | Provider-neutral MCP request handling in Convex HTTP Actions.    |

MCP remains opt in. Installing the Vue or Nuxt package does not start an MCP server or grant application authority.

## Documentation

Read the [Better Convex documentation](https://better-convex.lupinum.com). Start with [choose your path](https://better-convex.lupinum.com/docs/get-started/choose-your-path), the [mental model](https://better-convex.lupinum.com/docs/understand/mental-model), and [limitations](https://better-convex.lupinum.com/docs/overview/limitations).

The generated [API surface](https://better-convex.lupinum.com/docs/reference/api-surface) is the source of truth for public exports.

## Contributing and development

Read [CONTRIBUTING.md](CONTRIBUTING.md) before you open a pull request. Run the normal handoff gate before you submit a change:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

Maintainers use the protected workflow in [MAINTAINING.md](MAINTAINING.md) and [RELEASING.md](RELEASING.md) for releases.

## Support and security

Open a [GitHub issue](https://github.com/lupinum-dev/better-convex/issues) for bugs and focused proposals. Join the [Lupinum OSS Discord](https://discord.gg/RPH6SeA36N) for project discussion.

Use the private process in [SECURITY.md](SECURITY.md) to report a vulnerability. Do not report a vulnerability in a public issue.

## License

Better Convex is available under the [MIT License](LICENSE). Copyright belongs to [Lupinum OG](https://lupinum.com).
