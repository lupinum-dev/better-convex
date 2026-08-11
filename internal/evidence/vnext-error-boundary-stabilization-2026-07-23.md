# vNext error-boundary stabilization evidence — 2026-07-23

## Scope and decision

This closes audit finding `F-018` and stabilization task `S2-003`.

`ConvexCallError` no longer constructs or exposes native `Error.cause`, and its public input no longer
accepts a raw cause. Raw upstream errors are classified while held in a local catch binding and then
discarded. This is stronger and simpler than retaining secret-bearing state in a shared browser/server
error object.

The audited source contains no public safe-inspector or `serverConvex()` diagnostic hook to retain.
Adding one during the stabilization export freeze would create a new public contract. The supported
diagnostic path therefore remains the already documented allowlist: operation, function name, normalized
kind, and application-owned correlation metadata. No raw-cause getter or replacement source of truth was
added.

## Executed proof

```text
pnpm exec vitest run \
  test/unit/convex-call-error.test.ts \
  test/unit/paginated-query-pages.test.ts \
  test/unit/server-convex-caller.test.ts \
  test/security/auth-secret-sentinels.test.ts \
  test/unit/vue-query-options-types.test.ts \
  test/nuxt/useConvexPaginatedQuery.nuxt.test.ts \
  --config vitest.config.ts
  7 files, 79 tests passed

pnpm exec vitest run test/e2e/ssr-errors-consumer.e2e.test.ts --config vitest.config.ts
  1 production SSR/browser test passed

pnpm typecheck
  module, server, and fixture typechecks passed

pnpm format:check
  passed
```

The regression uses a secret-bearing native upstream cause and proves absence from:

- the `ConvexCallError` instance and property descriptors;
- `toJSON()`, `JSON.stringify()`, object enumeration, and Node inspection;
- `structuredClone()` and `MessageChannel` transfer;
- Nuxt SSR HTML, payload bytes, browser assets, revived client errors, and HTTP output;
- the existing authentication secret-sentinel surface.

The first local SSR attempt failed because the workspace sandbox denied a temporary localhost listener
(`EPERM`). The identical test passed when explicitly authorized to bind its loopback mock servers.
