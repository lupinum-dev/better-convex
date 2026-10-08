<p align="center"><img src="https://raw.githubusercontent.com/lupinum-dev/better-convex/main/docs/public/web-app-manifest-512x512.png" width="128" alt="Better Convex icon"></p>

<h1 align="center">@lupinum/better-convex-functions</h1>

<p align="center">Say once who may do what, to which rows, and let every Convex function check it.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lupinum/better-convex-functions"><img src="https://img.shields.io/npm/v/@lupinum/better-convex-functions?label=npm" alt="npm version"></a>
  <a href="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml"><img src="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/lupinum-dev/better-convex/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

> [!WARNING]
> This package is experimental (`0.x`). Its API can change in any release until `1.0.0`.

## Purpose

This package is an optional layer for the Convex functions of an application. You write one
policy (actions, roles, agent scopes) and one row rule per table. Every `query`, `mutation` and
internal operation that you build with `defineFunctions` then:

- finds the caller (a person, a signed-out visitor, an agent, or a system job);
- checks the action against the caller's role in the tenant that the input names;
- checks every row that the handler reads or writes through `ctx.db`, so a forgotten filter
  fails instead of returning another tenant's rows;
- hands the same caller to internal operations that it calls or schedules.

A test helper finds every function that skips this layer. A plain Convex function stays
possible behind `trusted(reason, fn)`.

The package imports only `convex`. It works with any frontend.

## Requirements

- Node.js `^22.19.0 || ^24.11.0`
- Convex `>=1.42.2 <2`
- A users table called `users`

## Installation

```bash
pnpm add @lupinum/better-convex-functions@next
```

## Quick start

Write the policy in its own file. It is plain data, and the browser can import it too, so take
`definePolicy` from the `/policy` entry, which has no server code.

```ts [convex/policy.ts]
import { definePolicy } from '@lupinum/better-convex-functions/policy'

export const policy = definePolicy({
  actions: ['projects.list', 'projects.archive'],
  roles: {
    owner: ['*'],
    member: ['projects.list'],
  },
  // What a person grants an AI host on the consent page.
  scopes: {
    'projects:read': { label: 'See your projects.', actions: ['projects.list'] },
    'projects:write': {
      label: 'Archive projects after you approve it.',
      actions: ['projects.archive'],
    },
  },
  // An agent may ask to archive, but a person decides.
  agents: { 'projects.archive': 'approve' },
})
```

Then give `defineFunctions` the policy, how to find the user and their role, and one row rule
per table:

```ts [convex/functions.ts]
import { custom, defineFunctions, owner, tenant } from '@lupinum/better-convex-functions'

import type { Doc } from './_generated/dataModel'
import { auth } from './auth'
import { policy } from './policy'

export const fns = defineFunctions({
  auth,
  policy,
  user: (ctx, authId) =>
    ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .unique(),
  roleOf: async (ctx, user, tenant) => {
    if (tenant.table !== 'organizations') return null
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_org_user', (q) => q.eq('organizationId', tenant.id).eq('userId', user._id))
      .unique()
    return membership?.role ?? null
  },
  rules: {
    users: owner('_id'),
    organizations: tenant('_id'),
    // Every membership of an organization where your role allows the action. Not owner('userId'):
    // that would let a member change their own role or add themselves to another organization.
    memberships: custom<Doc<'memberships'>>((ctx, membership) =>
      ctx.allows({ table: 'organizations', id: membership.organizationId }),
    ),
    projects: tenant('organizationId'),
  },
})

export const { query, mutation, internalQuery, internalMutation, internalAction, job } = fns
```

Spread `libraryTables` into your schema. A table without a rule is a type error.

<!-- BEGIN:consumer-onboarding -->

## Agent setup

`@lupinum/better-convex-functions` ships its documentation inside the package for coding
agents such as Claude Code, Codex and Cursor. The pages match the installed
version, so an agent does not follow the website for a different version.

To set it up, give your coding agent this task:

```text
Set up @lupinum/better-convex-functions for coding agents as described under "Agent setup" in its README.
```

### Steps for the agent

1. Find `node_modules/@lupinum/better-convex-functions/dist/agent/AGENTS.md`. Look in the
   directory of the project that depends on `@lupinum/better-convex-functions` first, then
   in its parent directories up to the repository root (workspaces can hoist
   packages). Read it; it lists the documentation pages.
2. Add the section below to the project's agent instructions: `AGENTS.md`, or
   `CLAUDE.md` if the project has only that file. If it has neither, create
   `AGENTS.md`. Write the path relative to the repository root, through
   `node_modules/@lupinum/better-convex-functions` (for example
   `apps/web/node_modules/@lupinum/better-convex-functions/...` in a workspace). Never write
   a resolved path such as `node_modules/.pnpm/...`: it contains the version and
   breaks after an upgrade. If a section for `@lupinum/better-convex-functions` already
   exists, leave it as it is.

   Use the path you found in place of the sample path:

   ```md
   ## @lupinum/better-convex-functions

   Before you change code that uses @lupinum/better-convex-functions, read
   `node_modules/@lupinum/better-convex-functions/dist/agent/AGENTS.md` and the pages it
   lists. They document the installed version. Prefer them over what you
   remember about this package and over the website.
   ```

3. Do not copy the documentation into the project and do not install a skill.
   The section points into the installed package, so it stays correct after
   every upgrade or downgrade.

If the file does not exist, the installed version has no packaged
documentation. Read the package README and its TypeScript types instead.

<!-- END:consumer-onboarding -->

## Entry points

| Import                                        | Contents                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@lupinum/better-convex-functions`            | `defineFunctions`, `definePolicy`, the row rules, `libraryTables`, `trusted`, `fail` and helpers  |
| `@lupinum/better-convex-functions/policy`     | `definePolicy`, `can`, `consentScopes` and the policy types, without server code, for the browser |
| `@lupinum/better-convex-functions/test`       | `unguardedFunctions` and `countDocuments`, for tests                                              |
| `@lupinum/better-convex-functions/agent-docs` | Markdown file for coding agents; not a JavaScript module                                          |

`@lupinum/better-convex-functions/internal` exists only for `@lupinum/better-convex-agents` and
the in-app agent runtime. It is not public API, is not covered by semver, and can change in any
release.

## Testing your application

`@lupinum/better-convex-functions/test` has helpers for `convex-test`:

- `await unguardedFunctions(modules)` lists every function that bypasses the layer. Pass the
  `import.meta.glob` map you give `convexTest` and assert that the list is empty. It throws when
  the map has no `defineFunctions` operation.
- `countDocuments(call)` counts the documents one call reads and writes, for budget tests.

Test sign-in and MCP grants with the real Better Auth component
(`signInAs` and `grantMcp` from `@lupinum/better-convex-nuxt/better-auth/test`). Call tools as a
host does with `callTool` from `@lupinum/better-convex-agents/test`.

## Documentation

[Start here](https://better-convex.lupinum.com/docs/build/functions/start-here) builds one
operation, one rule and one tool. Then read
[policy and roles](https://better-convex.lupinum.com/docs/build/functions/policy-and-roles),
[row rules](https://better-convex.lupinum.com/docs/build/functions/row-rules),
[internal operations](https://better-convex.lupinum.com/docs/build/functions/internal-operations),
[test your app](https://better-convex.lupinum.com/docs/build/functions/testing),
the [threat model](https://better-convex.lupinum.com/docs/build/functions/threat-model) and the
[error codes](https://better-convex.lupinum.com/docs/reference/operation-error-codes).
The package exports the same pages for coding agents as `@lupinum/better-convex-functions/agent-docs`.

## License

[MIT](https://github.com/lupinum-dev/better-convex/blob/main/LICENSE)
