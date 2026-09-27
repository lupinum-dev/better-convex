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
pnpm add @lupinum/better-convex-vue@1.0.0-rc.0 convex@^1.42.2 vue@^3.5.0
```

This installs the exact `1.0.0-rc.0` release candidate.

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

| Import                                | Exports                                                                                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lupinum/better-convex-vue`          | `createBetterConvex`, `useConvexQuery`, `useConvexPaginatedQuery`, `useConvexMutation`, `useConvexAction`, `useConvexForm`, `useConvexFileUpload`, `useConvexConnectionState`, `useConvex`, `ConvexCallError`, `ConvexFormError` |
| `@lupinum/better-convex-vue/errors`   | `ConvexCallError`, `ConvexFormError`, `isConvexCallError`, `normalizeConvexError`, `isSerializedConvexCallError`                                                                                                                 |
| `@lupinum/better-convex-vue/embedded` | `createBetterConvexAttachment`, for a Vue application that runs inside another application and shares its Convex connection                                                                                                      |

`createBetterConvex` accepts `convexUrl`, an optional `auth` adapter, optional `clientOptions` for the Convex client, and `defaultQueryAuth`. The [plain Vue guide](https://better-convex.lupinum.com/docs/get-started/plain-vue) shows each option.

`@lupinum/better-convex-vue/internal` exists only for `@lupinum/better-convex-nuxt`. It is not public API, and it can change in any release.

<!-- BEGIN:consumer-onboarding -->

## Use a coding agent

A coding agent is a development tool that can inspect and change your project.
After installation, copy this prompt into your coding agent:

```text
Add Better Convex to this application using the smallest suitable Nuxt, Vue,
or MCP package. Read the project's existing instructions first. Resolve the
installed @lupinum/better-convex-*/agent-docs export from this application's
directory and read its starting pages. Use the installed version's examples
and public types. Preserve existing authorization, routes, conventions, and
AGENTS.md instructions. Convex functions remain the source of truth for
authorization; do not move that rule into client state, Nuxt middleware, or MCP
transport. Add or update one short Better Convex pointer in AGENTS.md if the
project allows it; do not duplicate the documentation. If the file is absent,
create only that pointer. Report missing guidance. Verify the affected type,
build, runtime, authentication, and disposal boundaries.
```

If the installed package has no `agent-docs` export, read its packaged README
and types. Use documentation from the matching source tag when more detail is
needed. Installing or updating the package does not edit project instructions.
The pointer resolves the installed package, so upgrades and rollbacks select
the matching documentation without copying it into your application.

<!-- END:consumer-onboarding -->

## Documentation

Read the [plain Vue guide](https://better-convex.lupinum.com/docs/get-started/plain-vue) and the [composables reference](https://better-convex.lupinum.com/docs/reference/composables).

## Support and security

Open a [GitHub issue](https://github.com/lupinum-dev/better-convex/issues) for support. Report a vulnerability privately through the [security policy](https://github.com/lupinum-dev/better-convex/security/policy).

## License

This package uses the [MIT License](https://github.com/lupinum-dev/better-convex/blob/main/LICENSE).
