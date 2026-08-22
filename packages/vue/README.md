<p align="center"><img src="https://raw.githubusercontent.com/lupinum-dev/better-convex/main/docs/public/web-app-manifest-512x512.png" width="128" alt="Better Convex icon"></p>

<h1 align="center">@lupinum/better-convex-vue</h1>

<p align="center">Use identity-safe Convex queries and calls in plain or embedded Vue applications.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lupinum/better-convex-vue"><img src="https://img.shields.io/npm/v/@lupinum/better-convex-vue?label=npm" alt="npm version"></a>
  <a href="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml"><img src="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/lupinum-dev/better-convex/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

> [!WARNING]
> This package is beta software. Read the changelog before every upgrade.

## Purpose

Use this package when Vue must own the Convex client lifecycle. Use `@lupinum/better-convex-nuxt` when Nuxt must own SSR, Nitro calls, generated aliases, or optional Better Auth.

## Requirements

The package requires Node.js 22.14 or newer, Vue 3.5, and Convex 1.42.2.

## Installation

```bash
pnpm add @lupinum/better-convex-vue@1.0.0-beta.1 convex@1.42.2 vue@^3.5.0
```

## Quick start

```ts
import { createApp } from 'vue'
import { createBetterConvex } from '@lupinum/better-convex-vue'
import App from './App.vue'

createApp(App)
  .use(createBetterConvex({ convexUrl: import.meta.env.VITE_CONVEX_URL }))
  .mount('#app')
```

Use generated Convex references inside `setup`:

```ts
import { useConvexMutation, useConvexQuery } from '@lupinum/better-convex-vue'
import { api } from '../convex/_generated/api'

const notes = useConvexQuery(api.notes.list, {})
const rename = useConvexMutation(api.notes.rename)
```

## Exports

Pass `'skip'` to pause a query. A Convex `null` result remains valid data.

Advanced hosts can use the `embedded` export. MCP App UIs use `@lupinum/better-convex-mcp/vue`, which owns the official Apps SDK boundary.

## Documentation

Read the [Vue documentation](https://better-convex.lupinum.com/docs/get-started/choose-your-path).

## Support and security

Open a [GitHub issue](https://github.com/lupinum-dev/better-convex/issues) for support. Report vulnerabilities through the [private security process](https://github.com/lupinum-dev/better-convex/security/policy).

## License

This package uses the [MIT License](https://github.com/lupinum-dev/better-convex/blob/main/LICENSE).
