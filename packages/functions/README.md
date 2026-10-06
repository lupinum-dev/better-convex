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

```ts [convex/functions.ts]
import { defineFunctions, definePolicy, owner, tenant } from '@lupinum/better-convex-functions'

import { auth } from './auth'

export const policy = definePolicy({
  actions: ['projects.list', 'projects.archive'],
  roles: { owner: ['*'], viewer: ['projects.list'] },
  scopes: { 'projects:read': { label: 'See your projects.', actions: ['projects.list'] } },
})

export const { query, mutation, internalQuery, internalMutation, internalAction, job } =
  defineFunctions({
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
      memberships: owner('userId'),
      projects: tenant('organizationId'),
    },
  })
```

Spread `libraryTables` into your schema. A table without a rule is a type error.

## Testing your application

`@lupinum/better-convex-functions/test` has helpers for `convex-test`:

- `unguardedFunctions(modules)` lists every function that bypasses the layer. Assert that the
  list is empty.
- `countDocuments(call)` counts the documents one call reads and writes, for budget tests.
- `testAuth()` fakes the auth component.

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
