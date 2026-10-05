<p align="center"><img src="https://raw.githubusercontent.com/lupinum-dev/better-convex/main/docs/public/web-app-manifest-512x512.png" width="128" alt="Better Convex icon"></p>

<h1 align="center">@lupinum/better-convex-vue</h1>

<p align="center">Live Convex queries, mutations, actions, forms, and uploads for Vue applications without Nuxt.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lupinum/better-convex-vue"><img src="https://img.shields.io/npm/v/@lupinum/better-convex-vue?label=npm" alt="npm version"></a>
  <a href="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml"><img src="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/lupinum-dev/better-convex/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

> [!WARNING]
> This package is prerelease software. Read the [changelog](https://github.com/lupinum-dev/better-convex/blob/main/CHANGELOG.md) before every upgrade.

## Purpose

Use this package in a Vue application that talks to [Convex](https://convex.dev) from the browser, for example a Vite single-page application. It gives you composables that return reactive `data`, `status`, `pending`, and `error` state. Query results stay live. When the signed-in user changes, the package drops data that belonged to the previous user.

Use [`@lupinum/better-convex-nuxt`](https://www.npmjs.com/package/@lupinum/better-convex-nuxt) instead when you use Nuxt. It adds server rendering, Nitro server calls, and Better Auth support on top of this package.

## Requirements

- Node.js `^22.19.0 || ^24.11.0`
- Vue `>=3.5 <4`
- Convex `>=1.42.2 <2`

## Installation

```bash
pnpm add @lupinum/better-convex-vue@next convex@^1.42.2 vue@^3.5.0
```

The `next` dist-tag is the 1.0 release candidate.

## Quick start

Install the plugin once, at the application root:

```ts [src/main.ts]
import { createBetterConvex } from '@lupinum/better-convex-vue'
import { createApp } from 'vue'

import App from './App.vue'

createApp(App)
  .use(createBetterConvex({ convexUrl: import.meta.env.VITE_CONVEX_URL }))
  .mount('#app')
```

Use the composables inside `<script setup>`. Import function references from the API that Convex generates:

```vue [src/components/NoteList.vue]
<script setup lang="ts">
import { useConvexMutation, useConvexQuery } from '@lupinum/better-convex-vue'

import { api } from '../../convex/_generated/api'

const { data: notes, status, error } = useConvexQuery(api.notes.list)
const { mutate: removeNote, pending: removing } = useConvexMutation(api.notes.remove)
</script>

<template>
  <p v-if="status === 'pending'">Loading notes…</p>
  <p v-else-if="error">Could not load notes: {{ error.message }}</p>
  <ul v-else>
    <li v-for="note in notes" :key="note._id">
      {{ note.title }}
      <button :disabled="removing" @click="removeNote({ id: note._id })">Delete</button>
    </li>
  </ul>
</template>
```

The list updates when the data changes in Convex. A query without arguments may omit the arguments object. Pass `'skip'` instead of arguments to pause a query. A `null` result from Convex is data, not a loading state. `removeNote()` rejects with a `ConvexCallError` that has a `message`, a `code`, and the `functionName`.

## Exports

| Import                                    | Exports                                                                                                                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lupinum/better-convex-vue`              | `createBetterConvex`, `useConvexQuery`, `useConvexPaginatedQuery`, `useConvexMutation`, `useConvexAction`, `useConvexForm`, `useConvexFileUpload`, `useConvexConnectionState`, `useConvex`, `ConvexCallError`, `ConvexFormError` |
| `@lupinum/better-convex-vue/experimental` | `useConvexOperation`, `UseConvexOperationReturn`, `ConvexOperationWork`                                                                                                                                                          |
| `@lupinum/better-convex-vue/errors`       | `ConvexCallError`, `ConvexFormError`, `isConvexCallError`, `normalizeConvexError`, `isSerializedConvexCallError`                                                                                                                 |
| `@lupinum/better-convex-vue/embedded`     | `createBetterConvexAttachment`, for a Vue application that runs inside another application and shares its Convex connection                                                                                                      |
| `@lupinum/better-convex-vue/test`         | `setupBetterConvexTest` and `invalidCursorError`, a component-test runtime that runs the real composables against an in-memory Convex connection                                                                                 |

`createBetterConvex` accepts `convexUrl`, an optional `auth` adapter, optional `clientOptions` for the Convex client, and `defaultQueryAuth`. The [plain Vue guide](https://better-convex.lupinum.com/docs/get-started/plain-vue) shows each option.

`@lupinum/better-convex-vue/internal` exists only for `@lupinum/better-convex-nuxt`. It is not public API, and it can change in any release.

<!-- BEGIN:consumer-onboarding -->

## Use a coding agent

A coding agent is a development tool that can inspect and change your project.
Every Better Convex package contains documentation for coding agents that
matches the installed version: `dist/agent/AGENTS.md`, also exported as
`<package>/agent-docs`. It starts with a task index and the rules that agents
most often get wrong.

Add this pointer to your project's `AGENTS.md` (or `CLAUDE.md`). Name the
package that you installed:

```md [AGENTS.md]
## Better Convex

Before you change Convex functions or Better Convex code, read
`node_modules/@lupinum/better-convex-nuxt/dist/agent/AGENTS.md` and follow its
"Start here" table. It matches the installed version. Prefer it over the
website and over knowledge of earlier versions.
```

To add Better Convex to an application, give your agent this prompt:

```text
Add Better Convex to this application. Install @lupinum/better-convex-nuxt@next
(or @lupinum/better-convex-vue@next for Vue without Nuxt). Then read
node_modules/<package>/dist/agent/AGENTS.md and follow its "Start here" table.
Add the Better Convex pointer from the package README to AGENTS.md. Finish
with the "Check your setup" steps of the Installation page.
```

The pointer names the installed package, so an upgrade or a rollback selects
the matching documentation. Installing a package never changes your project
instructions.

<!-- END:consumer-onboarding -->

## Documentation

Read the [plain Vue guide](https://better-convex.lupinum.com/docs/get-started/plain-vue) and the [composables reference](https://better-convex.lupinum.com/docs/reference/composables).

## Support and security

Open a [GitHub issue](https://github.com/lupinum-dev/better-convex/issues) for support. Report a vulnerability privately through the [security policy](https://github.com/lupinum-dev/better-convex/security/policy).

## License

This package uses the [MIT License](https://github.com/lupinum-dev/better-convex/blob/main/LICENSE).
