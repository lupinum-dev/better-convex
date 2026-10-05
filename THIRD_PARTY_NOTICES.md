# Third-party notices

Better Convex Nuxt is distributed under the repository's MIT license. Selected
Convex/Better Auth integration source is derived from the Apache-2.0 work below;
those portions remain subject to Apache License 2.0. The complete Apache license
is included at `LICENSES/Apache-2.0.txt`.

## get-convex/better-auth

- Source: https://github.com/get-convex/better-auth
- Baseline commit: `c628916b451a6b4cff0f5464f134475464b1a6da`
- Baseline tag: `v0.12.5`
- Import date: 2026-07-16
- Original license: Apache-2.0
- Upstream NOTICE status: the inspected baseline commit contains no `NOTICE`
  file.

The incorporated surface is limited to the component client/adapter/schema,
Convex JWT integration, auth-provider configuration, component codegen, narrow
context types, and compiled test helper.

Derived targets are restricted to `src/runtime/convex-auth/**`, the internal
`src/runtime/auth-client/convex-client-plugin.ts` integration leaf, and the
build-only `internal/convex-auth/schema-options.ts` schema profile.

The following upstream areas are intentionally omitted: Next.js, React, React
Start, TanStack and other framework examples, cross-domain integration, upstream
documentation and release tooling, compatibility aliases, production test
profiles, deprecated OIDC-provider composition, JWT cookie caching, destructive
key rotation, forwarded-origin restoration, and unrelated generic utilities.

Better Convex Nuxt modifies the retained integration for a Nuxt-and-Convex-only
public API, logical Better Auth IDs, atomic Convex storage operations, explicit
origin and token-class validation, additive signing-key rotation, and one shared
packaged/local adapter implementation. Adapted files carry a prominent
modification notice.

The OAuth renewal helpers `oauth-refresh.ts` and `oauth-refresh-transport.ts`
under `src/runtime/convex-auth/` are original Better Convex extensions, not
copies of upstream code. They bind renewal to live sessions and immutable
consent, constrain rotation, and pass request-local evidence to Convex-owned
writes. The Apache notices for incorporated portions remain unchanged.

## get-convex/convex-backend

- Source: https://github.com/get-convex/convex-backend/tree/main/npm-packages/convex
- Baseline package: `convex@1.42.2`
- Import date: 2026-10-05
- Original license: Apache-2.0
- Upstream NOTICE status: the installed package contains no `NOTICE` file.

The incorporated surface is limited to `insertAtTop` and
`optimisticallyUpdateValueInPaginatedQuery` from `src/react/use_paginated_query.ts`.
The derived target is `src/optimistic-pagination.ts` in the Vue package.

Better Convex removes the React dependency and uses its existing pagination
types. Both helpers keep the upstream signatures and matching rules. The adapted
file carries an attribution comment.
