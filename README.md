<p align="center">
  <img src="docs/public/web-app-manifest-512x512.png" width="128" alt="Better Convex icon">
</p>

<h1 align="center">Better Convex</h1>

<p align="center">Use Convex in Nuxt and Vue. Pages render on the server and then update live in the browser.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lupinum/better-convex-nuxt"><img src="https://img.shields.io/npm/v/@lupinum/better-convex-nuxt?label=npm" alt="npm version"></a>
  <a href="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml"><img src="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <a href="https://discord.lupinum.com"><img src="https://img.shields.io/badge/Discord-join%20the%20chat-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
</p>

> [!WARNING]
> These packages are prerelease software. Read the [changelog](CHANGELOG.md) before every upgrade. The authentication component cannot reuse the database of another Better Auth integration. Start it with a fresh component.

## Why use Better Convex?

[Convex](https://convex.dev) is a backend with a realtime database. Its queries push new results to the browser when data changes. Better Convex connects Convex to Nuxt and Vue:

- `useConvexQuery` loads a query during server rendering, sends the result with the page, and keeps it live in the browser.
- `useConvexMutation`, `useConvexAction`, `useConvexForm`, and `useConvexFileUpload` return reactive `pending`, `error`, and `data` state.
- Writes, uploads, and `useConvexOperation` belong to the user who started them. When that user changes, no later request is sent, and the error tells whether the last one was sent.
- A failed call rejects with a `ConvexCallError` that has a `message`, a `code`, and the `functionName` that failed. `useConvexForm` reports validation and submission failures as `ConvexFormError`.
- `serverConvex(event)` calls Convex from a Nitro route as the signed-in user.
- Optional [Better Auth](https://www.better-auth.com) support keeps sessions in a Convex component and signs users in to Convex.
- An optional MCP package lets AI hosts, such as ChatGPT and Claude, call your Convex functions as tools.

Better Convex is a set of composables and helpers, not a framework. It does not require a registry or a fixed folder layout. The only generated code is Convex's own API and, when you use Better Auth, the auth component that `better-convex init` writes to `convex/betterAuth/` with its generated schema.

## When to use it

Use `@lupinum/better-convex-nuxt` in a Nuxt 4 application. Use `@lupinum/better-convex-vue` in a Vue application without Nuxt, for example a Vite single-page application. Use `@lupinum/better-convex-agents` to let MCP hosts and agents call your Convex functions.

Better Convex does not decide who may read or change data. Check the user, ownership, membership, and roles in every Convex function. Route middleware and hidden buttons do not protect data.

## Requirements

- Node.js `^22.19.0 || ^24.11.0`
- Nuxt `>=4.5.2 <5`
- Convex `>=1.42.2 <2`
- Vue `>=3.5 <4`
- For authentication: `better-auth`, `@better-auth/core`, and `@better-auth/oauth-provider`, each at exactly `1.7.6`

## Installation

Install the module in a Nuxt application:

```bash
pnpm add @lupinum/better-convex-nuxt@next convex@^1.42.2
```

The `next` dist-tag is the 1.0 release candidate. Upgrading from a beta?
See [MIGRATING.md](MIGRATING.md).

Add the module to your Nuxt configuration:

```ts [nuxt.config.ts]
export default defineNuxtConfig({
  modules: ['@lupinum/better-convex-nuxt'],
})
```

Connect a Convex deployment. This command signs you in to Convex, creates or selects a deployment, writes its URLs to `.env.local`, and creates the `convex/` folder:

```bash
pnpm exec better-convex convex configure
```

Keep it running while you work on Convex functions. It pushes each change to your development deployment.

The default Nuxt template shows a welcome screen instead of your pages. Replace `app/app.vue`:

```vue [app/app.vue]
<template>
  <NuxtPage />
</template>
```

## Quick start

Add a Convex query:

```ts [convex/tasks.ts]
import { query } from './_generated/server'

export const list = query({
  args: {},
  handler: async (ctx) => await ctx.db.query('tasks').order('desc').take(50),
})
```

Show it on a page:

```vue [app/pages/index.vue]
<script setup lang="ts">
import { api } from '#convex/api'

const { data: tasks, status, error } = await useConvexQuery(api.tasks.list)
</script>

<template>
  <p v-if="status === 'pending'">Loading tasks…</p>
  <p v-else-if="error">Could not load tasks: {{ error.message }}</p>
  <ul v-else>
    <li v-for="task in tasks" :key="task._id">{{ task.text }}</li>
  </ul>
</template>
```

Start Nuxt in a second terminal:

```bash
pnpm exec nuxt dev --dotenv .env.local
```

The server renders the list. After the page loads, the list stays live: add a row to the `tasks` table in the Convex dashboard, and the page updates without a reload.

A query without arguments may omit the arguments object. Pass `'skip'` instead of arguments to pause a query. Follow the [first realtime page](https://better-convex.lupinum.com/docs/get-started/first-realtime-page) guide for the full walkthrough.

<!-- BEGIN:consumer-onboarding -->

## Agent setup

`@lupinum/better-convex-nuxt` ships its documentation inside the package for coding
agents such as Claude Code, Codex and Cursor. The pages match the installed
version, so an agent does not follow the website for a different version.

To set it up, give your coding agent this task:

```text
Set up @lupinum/better-convex-nuxt for coding agents as described under "Agent setup" in its README.
```

### Steps for the agent

1. Find `node_modules/@lupinum/better-convex-nuxt/dist/agent/AGENTS.md`. Look in the
   directory of the project that depends on `@lupinum/better-convex-nuxt` first, then
   in its parent directories up to the repository root (workspaces can hoist
   packages). Read it; it lists the documentation pages.
2. Add the section below to the project's agent instructions: `AGENTS.md`, or
   `CLAUDE.md` if the project has only that file. If it has neither, create
   `AGENTS.md`. Write the path relative to the repository root, through
   `node_modules/@lupinum/better-convex-nuxt` (for example
   `apps/web/node_modules/@lupinum/better-convex-nuxt/...` in a workspace). Never write
   a resolved path such as `node_modules/.pnpm/...`: it contains the version and
   breaks after an upgrade. If a section for `@lupinum/better-convex-nuxt` already
   exists, leave it as it is.

   Use the path you found in place of the sample path:

   ```md
   ## @lupinum/better-convex-nuxt

   Before you change code that uses @lupinum/better-convex-nuxt, read
   `node_modules/@lupinum/better-convex-nuxt/dist/agent/AGENTS.md` and the pages it
   lists. They document the installed version. Prefer them over what you
   remember about this package and over the website.
   ```

3. Do not copy the documentation into the project and do not install a skill.
   The section points into the installed package, so it stays correct after
   every upgrade or downgrade.

If the file does not exist, the installed version has no packaged
documentation. Read the package README and its TypeScript types instead.

### Add Better Convex to an application

Give your coding agent this task:

```text
Add Better Convex to this application. Install @lupinum/better-convex-nuxt@next
(or @lupinum/better-convex-vue@next for Vue without Nuxt). Set it up for coding
agents as described under "Agent setup" in the package README. Then read
node_modules/<package>/dist/agent/AGENTS.md and follow its "Start here" table.
Finish with the "Check your setup" steps of the Installation page.
```

<!-- END:consumer-onboarding -->

## Server calls and mutations

Call a mutation from a component. Destructure the function and its state:

```ts
const { mutate: createTask, pending, error } = useConvexMutation(api.tasks.create)

await createTask({ text: 'Review the release' })
```

`createTask` rejects with a `ConvexCallError`. When your Convex function throws `new ConvexError({ code: 'TASK_LOCKED', message: 'This task is locked' })`, the error has `message` `'This task is locked'`, `code` `'TASK_LOCKED'`, and `functionName` `'tasks:create'`.

Call Convex from a Nitro route with `serverConvex`. Create one caller in each request:

```ts [server/api/tasks.get.ts]
import { api } from '#convex/api'

export default defineEventHandler(async (event) => {
  const convex = serverConvex(event)
  return await convex.query(api.tasks.list)
})
```

Do not keep a caller between requests. `requireConvexUser(event)` returns the signed-in user or throws a 401 error. `toConvexH3Error(error)` turns any error into an H3 error with a matching HTTP status.

## Authentication

Authentication is off until you add a `convex.auth` object to the Nuxt configuration. To turn it on, install the exact Better Auth versions and run the setup command:

```bash
pnpm add better-auth@1.7.6 @better-auth/core@1.7.6 @better-auth/oauth-provider@1.7.6
pnpm exec better-convex init --typed-client
```

The command shows every file it will write and asks before it writes. It asks again before it sets development secrets or creates the first signing key. It writes the proxy secret to `.env.local` and sets the same value in Convex. `--typed-client` also writes `app/convex-auth.ts`, the file for Better Auth client plugins. The command does not configure production.

The browser talks to Better Auth through `/api/auth` on your own origin. Nuxt forwards these requests to Convex. `useConvexAuth()` returns the auth `status`, the `user`, and the Better Auth `client`. In Convex functions, `auth.requireUser(ctx)` returns the signed-in user or throws.

Follow the [add authentication](https://better-convex.lupinum.com/docs/get-started/add-authentication) guide before you enable auth.

## Packages

| Package                            | Use it for                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `@lupinum/better-convex-nuxt`      | Nuxt: server rendering, Nitro calls, file uploads, DevTools, and Better Auth. |
| `@lupinum/better-convex-vue`       | Vue without Nuxt: queries, mutations, actions, forms, uploads, and errors.    |
| `@lupinum/better-convex-functions` | Optional: one policy and one row rule per table for every Convex function.    |
| `@lupinum/better-convex-agents`    | Tools, approvals and an MCP endpoint for hosts such as ChatGPT and Claude.    |

The agents package is separate. Installing the Nuxt or Vue package does not start an MCP server.

## Documentation

Read the [Better Convex documentation](https://better-convex.lupinum.com). Start with [choose your path](https://better-convex.lupinum.com/docs/get-started/choose-your-path). Read the [mental model](https://better-convex.lupinum.com/docs/concepts/mental-model) and the [limitations](https://better-convex.lupinum.com/docs/overview/limitations) before you plan a larger application.

The [API reference](https://better-convex.lupinum.com/docs/reference/api-surface) page lists every public export.

## Contributing and development

Read [CONTRIBUTING.md](.github/CONTRIBUTING.md) before you open a pull request. Run the full check before you submit a change:

```bash
corepack enable
pnpm install
pnpm verify
```

[AGENTS.md](AGENTS.md) lists every command. Releases use [Changesets](https://github.com/changesets/changesets): a maintainer merges the "Version packages" pull request and approves the publish, which uses npm trusted publishing with provenance.

## Support and security

Open a [GitHub issue](https://github.com/lupinum-dev/better-convex/issues) for bugs and focused proposals. Join the [Lupinum OSS Discord](https://discord.lupinum.com) for project discussion.

Report a vulnerability privately as described in [SECURITY.md](.github/SECURITY.md). Do not report a vulnerability in a public issue.

## License

Better Convex is available under the [MIT License](LICENSE). Copyright belongs to [Lupinum OG](https://lupinum.com).
