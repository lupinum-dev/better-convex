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

The authorized intake surface is limited to the component client/adapter/schema,
Convex JWT integration, auth-provider configuration, component codegen, narrow
context types, and compiled test helper recorded in
`security/upstream-convex-better-auth.json`. Each incorporated target and its
modifications must be recorded there before release.

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
modification notice when required by the provenance ledger.
