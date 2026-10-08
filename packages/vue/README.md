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

<!-- BEGIN:consumer-onboarding -->

## Agent setup

`@lupinum/better-convex-vue` ships its documentation inside the package for coding
agents such as Claude Code, Codex and Cursor. The pages match the installed
version, so an agent does not follow the website for a different version.

To set it up, give your coding agent this task:

```text
Set up @lupinum/better-convex-vue for coding agents as described under "Agent setup" in its README.
```

### Steps for the agent

1. Find `node_modules/@lupinum/better-convex-vue/dist/agent/AGENTS.md`. Look in the
   directory of the project that depends on `@lupinum/better-convex-vue` first, then
   in its parent directories up to the repository root (workspaces can hoist
   packages). Read it; it lists the documentation pages.
2. Add the section below to the project's agent instructions: `AGENTS.md`, or
   `CLAUDE.md` if the project has only that file. If it has neither, create
   `AGENTS.md`. Write the path relative to the repository root, through
   `node_modules/@lupinum/better-convex-vue` (for example
   `apps/web/node_modules/@lupinum/better-convex-vue/...` in a workspace). Never write
   a resolved path such as `node_modules/.pnpm/...`: it contains the version and
   breaks after an upgrade. If a section for `@lupinum/better-convex-vue` already
   exists, leave it as it is.

   Use the path you found in place of the sample path:

   ```md
   ## @lupinum/better-convex-vue

   Before you change code that uses @lupinum/better-convex-vue, read
   `node_modules/@lupinum/better-convex-vue/dist/agent/AGENTS.md` and the pages it
   lists. They document the installed version. Prefer them over what you
   remember about this package and over the website.
   ```

3. Do not copy the documentation into the project and do not install a skill.
   The section points into the installed package, so it stays correct after
   every upgrade or downgrade.

If the file does not exist, the installed version has no packaged
documentation. Read the package README and its TypeScript types instead.

<!-- END:consumer-onboarding -->

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

## Documentation

Read the [plain Vue guide](https://better-convex.lupinum.com/docs/get-started/plain-vue) and the [composables reference](https://better-convex.lupinum.com/docs/reference/composables).

## Support and security

Open a [GitHub issue](https://github.com/lupinum-dev/better-convex/issues) for support. Report a vulnerability privately through the [security policy](https://github.com/lupinum-dev/better-convex/security/policy).

## License

This package uses the [MIT License](https://github.com/lupinum-dev/better-convex/blob/main/LICENSE).
