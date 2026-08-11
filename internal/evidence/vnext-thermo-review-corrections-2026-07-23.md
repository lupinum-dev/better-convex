# vNext thermo-review corrections

Date: 2026-07-23

## Scope and outcome

The post-candidate maintainability review was reproduced against BCN `769d5b72` and the Ginko
stabilization branch. Two release-blocking Medium defects survived validation:

1. Nuxt SSR pagination derived `ready` from `useAsyncData` alone, even when the canonical query gate
   was idle or had produced an authentication error.
2. `@better-convex/mcp` accepted consumer-created SDK server instances and selected their shape with
   `instanceof`. A source-linked Ginko installation with another physical SDK copy failed before tool
   registration.

The review also found three real cleanup issues: the query controller still used `null` as a
first-value control signal, public JWKS projection remained embedded in the auth plugin, and the
relationship graph was rebuilt inside the generated adapter function file. Ginko's disabled MCP
Studio still constructed a credential query even though the route was absent.

One proposed consequence was rejected: a legitimate query result of `null` does not become `idle`.
The settled query reducer already distinguishes data presence from the returned value.

## Corrections

- SSR pagination now derives `idle | loading-first-page | ready | exhausted | error` from one pure
  reducer that consumes the canonical gate, error, pending-work, page, initial-data, and terminal
  state.
- Query first-value settlement is `Promise<void>`; application `null` is no longer a lifecycle
  control value.
- The MCP package constructs the official `McpServer` itself. Consumers receive that request-local
  server only through `configureServer`; there is no accepted consumer-created instance,
  `instanceof` dispatch, compatibility branch, or public factory abstraction.
- Public JWKS response projection moved beside the canonical signing-key validation and rotation
  rules.
- Better Auth relationship traversal moved into one construction-time engine with a precomputed
  inbound-reference map.
- Ginko skips credential reads and rejects credential create/revoke handlers while `mcp:false`; its
  Convex package no longer imports the official server SDK directly.

## Executed evidence

- `pnpm typecheck`
- `pnpm lint`
- `pnpm check:boundaries`
- `pnpm test`: 163 files, 1,870 tests
- focused MCP package build/typecheck and official-handler tests
- focused JWKS security matrix: 22 tests
- focused relationship matrix: 10 tests across rotation and relationship suites
- focused Nuxt pagination lifecycle matrix: 7 tests
- Ginko Convex source-linked type and type-contract checks
- Ginko Studio source-linked Vue typecheck
- Ginko MCP/credential/application operation matrix: 4 files, 17 tests
- Ginko disabled-MCP behavior: credential query skipped; create and revoke rejected locally

These are corrected-source proofs, not exact-candidate certification. The immutable
Vue/Nuxt `0.8.0-beta.11` and MCP `0.1.0-beta.2` artifacts remain valid evidence for their original
bytes but are superseded for release. Fresh coordinates and exact Ginko installation are required
before re-entry.
