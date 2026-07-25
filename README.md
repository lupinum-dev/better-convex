# Better Convex Nuxt

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

Convex for Nuxt 4, without the integration glue: SSR-to-realtime queries, Better Auth, request-scoped server calls, optimistic updates, uploads, and one structured error model.

- [Documentation](https://better-convex-nuxt.vercel.app)
- [Choose your path](https://better-convex-nuxt.vercel.app/docs/get-started/choose-your-path)
- [Understand the model](https://better-convex-nuxt.vercel.app/docs/understand/mental-model)
- [Compare Nuxt integrations](https://better-convex-nuxt.vercel.app/docs/overview/comparison)

> [!NOTE]
> This package is pre-1.0. The current auth architecture is a greenfield hard cut: do not point it at an existing Better Auth component database. Minor releases may make deliberate hard cutovers; read the changelog before upgrading.

Better Convex Nuxt is ESM-only and supports Node `^22.12.0 || ^24.11.0 || >=26.0.0`.

## Better Convex packages

- `better-convex-nuxt` is the full-stack Nuxt integration: SSR/hydration,
  Nitro calls, Better Auth, the auth proxy, route middleware, uploads, and
  DevTools.
- `better-convex-vue` is the shared client lifecycle for plain Vue/Vite and
  embedded Vue applications. It has no Nuxt, Nitro, H3, or Better Auth
  dependency.
- `@better-convex/mcp` is the optional experimental, provider-neutral MCP
  resource boundary built on the official SDK.

Nuxt consumes the same Vue query, pagination, callable, identity, and disposal
engine after hydration. MCP and the experimental `better-convex-vue/mcp-app`
entry remain optional; installing ordinary Vue or Nuxt does not enable an MCP
server or grant application authority.

## Why use it

- **One query lifecycle:** render during SSR, reuse the payload during hydration, and continue as a browser subscription.
- **Identity isolation:** query state is partitioned across anonymous, signed-in, signed-out, and user-switch boundaries.
- **Better Auth integration:** session and Convex identity stay synchronized through a bounded same-origin auth proxy.
- **Agents and MCP:** the provider-neutral `@better-convex/mcp` boundary serves explicit Convex operations; the optional OAuth Provider profile adds delegated human access while authorization remains live in Convex.
- **Nuxt server support:** call queries, mutations, and actions through one request-scoped `serverConvex` API.
- **Application behavior:** optimistic state, pagination, uploads, connection state, DevTools, and structured errors use the same runtime model.
- **Explicit security ownership:** the library transports identity; Convex functions remain the source of truth for authorization.

See [limitations and trade-offs](https://better-convex-nuxt.vercel.app/docs/overview/limitations) before adopting the module.

## Install

```bash
pnpm add better-convex-nuxt convex@1.42.2 nuxt@4.4.8 better-auth@1.7.0-rc.1 kysely@0.28.17
```

```ts [nuxt.config.ts]
export default defineNuxtConfig({
  modules: ['better-convex-nuxt'],
})
```

```dotenv [.env.local]
NUXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

`pnpm exec better-convex-nuxt-convex configure` creates `.env.local`. Keep it as
the single ignored local configuration file, run supported Convex commands
through `better-convex-nuxt-convex`, and pass `--dotenv .env.local` to Nuxt
commands. Production values belong in the hosting environment.

The checked runner strips inherited `CONVEX_*` values, validates the one fixed
authority file, rejects deployment-selection overrides, and then invokes the
pinned Convex CLI.

The package supports the exact Nuxt, Convex, Better Auth, and Kysely peer versions declared in `package.json`. Kysely is pinned because the supported Better Auth Convex adapter loads it as a stateful query runtime. The exact OAuth Provider runtime is package-owned and installed transitively with Better Convex Nuxt, so applications do not select a second provider version. OAuth authorization-server applications follow the [delegated OAuth and MCP guide](https://better-convex-nuxt.vercel.app/docs/build/authentication/delegated-oauth-and-mcp).

## Query from a page

```vue
<script setup lang="ts">
import { api } from '#convex/api'

const { data: tasks, status, error } = await useConvexQuery(api.tasks.list, {})
</script>

<template>
  <p v-if="status === 'pending'">Loading tasks…</p>
  <p v-else-if="error">Could not load tasks.</p>
  <ul v-else>
    <li v-for="task in tasks" :key="task._id">
      {{ task.text }}
    </li>
  </ul>
</template>
```

Queries use SSR and subscriptions by default. Every call receives an explicit args object or the literal `'skip'`.

## Write data

```vue
<script setup lang="ts">
import { api } from '#convex/api'

const createTask = useConvexMutation(api.tasks.create)

async function create(text: string) {
  await createTask({ text })
}
</script>
```

The active query updates from Convex without a manual refetch. Add an optimistic update only when the interaction benefits from earlier local feedback.

## Call Convex from Nitro

```ts [server/api/tasks.get.ts]
import { api } from '#convex/api'
import { serverConvex } from '#convex/server'

export default defineEventHandler(async (event) => {
  const convex = await serverConvex(event)
  return convex.query(api.tasks.list, {})
})
```

Create the caller inside the request handler. Do not share authenticated callers across requests.

## Add authentication

Authentication is installed by default and uses Better Auth with the Convex adapter. It requires the server definition, Convex HTTP routes, public site URL, and secret described in the [authentication setup guide](https://better-convex-nuxt.vercel.app/docs/get-started/add-authentication).

Use `auth: false` when the application intentionally has no auth runtime:

```ts [nuxt.config.ts]
export default defineNuxtConfig({
  modules: ['better-convex-nuxt'],
  convex: { auth: false },
})
```

Route protection is navigation UX. Every protected Convex function must still validate identity, ownership, membership, and role requirements on the backend.

## Public API

The generated [API surface](https://better-convex-nuxt.vercel.app/docs/reference/api-surface) is the source of truth for composables, helpers, server aliases, components, and package exports. The main entry points are:

- `useConvexQuery` and `useConvexPaginatedQuery`
- `useConvexMutation` and `useConvexAction`
- `useConvexAuth` and `useConvexUser`
- `useConvexFileUpload`, `useConvexUploadQueue`, and `useConvexStorageUrl`
- `useConvexConnectionState` and the stable `useConvex` handle
- `serverConvex` from `better-convex-nuxt/server` or `#convex/server`
- `ConvexCallError` from `better-convex-nuxt/errors`

## Contributing

```bash
pnpm install
pnpm dev:prepare
pnpm dev
pnpm verify
```

Bug reports and focused pull requests are welcome through GitHub. Run `pnpm verify` before opening a pull request; security vulnerabilities must follow [SECURITY.md](./SECURITY.md) instead of a public issue.

## Acknowledgements

File upload composables were inspired by [nuxt-convex](https://github.com/onmax/nuxt-convex) by [@onmax](https://github.com/onmax).

## License

[MIT](./LICENSE)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/better-convex-nuxt/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/better-convex-nuxt
[npm-downloads-src]: https://img.shields.io/npm/dm/better-convex-nuxt.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npm.chart.dev/better-convex-nuxt
[license-src]: https://img.shields.io/npm/l/better-convex-nuxt.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/better-convex-nuxt
[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt
[nuxt-href]: https://nuxt.com
