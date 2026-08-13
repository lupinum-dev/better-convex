# Better Convex Nuxt

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

Convex for Nuxt 4, without the integration glue: SSR-to-realtime queries, request-scoped server calls, mutation-scoped optimistic updates, uploads, one structured error model, and optional Better Auth.

- [Documentation](https://better-convex.lupinum.com)
- [Choose your path](https://better-convex.lupinum.com/docs/get-started/choose-your-path)
- [Understand the model](https://better-convex.lupinum.com/docs/understand/mental-model)
- [Compare Nuxt integrations](https://better-convex.lupinum.com/docs/overview/comparison)

> [!NOTE]
> This package is pre-1.0. The current auth architecture is a greenfield hard cut: do not point it at an existing Better Auth component database. Minor releases may make deliberate hard cutovers; read the changelog before upgrading.

Better Convex Nuxt is ESM-only and supports Node `^22.12.0 || ^24.11.0 || >=26.0.0`.

## Better Convex packages

- `@lupinum/better-convex-nuxt` is the full-stack Nuxt integration: SSR/hydration,
  Nitro calls, uploads, DevTools, and an opt-in Better Auth runtime with its
  auth proxy and route middleware.
- `@lupinum/better-convex-vue` is the shared client lifecycle for plain Vue/Vite and
  embedded Vue applications. It has no Nuxt, Nitro, H3, or Better Auth
  dependency.
- `@lupinum/better-convex-mcp` is the optional experimental, provider-neutral MCP
  resource boundary built on the official SDK.

Nuxt consumes the same Vue query, pagination, callable, identity, and disposal
engine after hydration. MCP and the experimental `@lupinum/better-convex-vue/mcp-app`
entry remain optional; installing ordinary Vue or Nuxt does not enable an MCP
server or grant application authority.

## Why use it

- **One query lifecycle:** render during SSR, reuse the payload during hydration, and continue as a browser subscription.
- **Identity isolation:** query state is partitioned across anonymous, signed-in, signed-out, and user-switch boundaries.
- **Opt-in Better Auth integration:** session and Convex identity stay synchronized through a bounded same-origin auth proxy when the app enables auth.
- **Agents and MCP:** the provider-neutral `@lupinum/better-convex-mcp` boundary serves explicit Convex operations; the optional OAuth Provider profile adds delegated human access while authorization remains live in Convex.
- **Nuxt server support:** call queries, mutations, and actions through one request-scoped `serverConvex` API.
- **Application behavior:** mutation-scoped optimistic updates, pagination, uploads, connection state, DevTools, and structured errors use the same runtime model.
- **Explicit security ownership:** the library transports identity; Convex functions remain the source of truth for authorization.

See [limitations and trade-offs](https://better-convex.lupinum.com/docs/overview/limitations) before adopting the module.

## Install

```bash
pnpm add @lupinum/better-convex-nuxt convex@1.42.2 nuxt@4.5.1
```

```ts [nuxt.config.ts]
export default defineNuxtConfig({
  modules: ['@lupinum/better-convex-nuxt'],
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

This is the complete no-auth install used by the public starter; it has no Better Auth or Kysely dependency. Better Convex Nuxt supports the exact Nuxt and Convex versions declared in `package.json`.

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

Queries use SSR and realtime updates by default. Pass an explicit args object (or omit it only for an exact no-argument query), and use the literal `'skip'` to pause execution.

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
  return convex.query(api.tasks.list)
})
```

Create the caller inside the request handler. Do not share authenticated callers across requests.

## Add authentication

Authentication is off when `convex.auth` is omitted. To opt in, install the exact Better Auth and OAuth Provider peers, then provide the application origin:

```bash
pnpm add better-auth@1.7.0-rc.2 @better-auth/oauth-provider@1.7.0-rc.2
```

```ts [nuxt.config.ts]
export default defineNuxtConfig({
  modules: ['@lupinum/better-convex-nuxt'],
  convex: {
    auth: {
      origin: process.env.SITE_URL ?? 'http://localhost:3000',
      trustedClientIpHeader: process.env.BCN_AUTH_TRUSTED_CLIENT_IP_HEADER,
    },
  },
})
```

`trustedClientIpHeader` may be omitted only for an exact loopback development origin. Better Auth and the OAuth Provider are optional exact peers owned by the auth-enabled application; Better Auth supplies its own Kysely runtime, so do not add a standalone Kysely peer for Better Convex. The server definition, Convex HTTP routes, secret, and optional typed client are covered in the [authentication setup guide](https://better-convex.lupinum.com/docs/get-started/add-authentication). OAuth authorization-server applications follow the [delegated OAuth and MCP guide](https://better-convex.lupinum.com/docs/build/authentication/delegated-oauth-and-mcp).

Render auth UI with ordinary Vue conditionals over `useConvexAuth().status`, `isPending`, and `error`; the module does not register auth UI components.

Route protection is navigation UX. Every protected Convex function must still validate identity, ownership, membership, and role requirements on the backend.

## Public API

The generated [API surface](https://better-convex.lupinum.com/docs/reference/api-surface) is the source of truth for composables, server aliases, and package exports. The main entry points are:

- `useConvexQuery` with `data`, `status`, `pending`, `error`, `isStale`, and `refresh()`
- `useConvexPaginatedQuery` with `data`, `status`, `isLoading`, `canLoadMore`, `error`, `isStale`, `loadMore()`, and `refresh()`
- `useConvexMutation` and `useConvexAction`
- `useConvexAuth` in auth-enabled builds
- `useConvexFileUpload`
- `useConvexConnectionState` and the stable `useConvex` handle
- `serverConvex` from `@lupinum/better-convex-nuxt/server` or `#convex/server`
- `ConvexCallError` from `@lupinum/better-convex-nuxt/errors`

## Contributing

```bash
pnpm install
pnpm dev:prepare
pnpm dev
pnpm verify
```

Bug reports and focused pull requests are welcome through GitHub. Run `pnpm verify` before opening a pull request. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you start a large change. Security vulnerabilities must follow [SECURITY.md](./SECURITY.md) instead of a public issue.

## Support

Open a [GitHub issue](https://github.com/lupinum-dev/better-convex/issues)
for a reproducible defect. Discuss usage with the community in the
[Lupinum OSS Discord](https://discord.gg/RPH6SeA36N).

## Acknowledgements

File upload composables were inspired by [nuxt-convex](https://github.com/onmax/nuxt-convex) by [@onmax](https://github.com/onmax).

## License

Better Convex is developed by [Lupinum OG](https://lupinum.com) and released
under the [MIT License](./LICENSE).

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/%40lupinum%2Fbetter-convex-nuxt/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/@lupinum/better-convex-nuxt
[npm-downloads-src]: https://img.shields.io/npm/dm/%40lupinum%2Fbetter-convex-nuxt.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npm.chart.dev/@lupinum/better-convex-nuxt
[license-src]: https://img.shields.io/npm/l/%40lupinum%2Fbetter-convex-nuxt.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/@lupinum/better-convex-nuxt
[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt
[nuxt-href]: https://nuxt.com
