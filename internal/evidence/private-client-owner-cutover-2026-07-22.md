# Private client owner cutover — 2026-07-22

## Outcome

The replacement-safe Convex client owner and identity-change error now live only in
`src/runtime/client-core/**`. Every production, public-type, fixture, and test import was hard-cut to the
new private source. The old `src/runtime/client/**` implementations are deleted; no compatibility
re-export remains.

The public `ConvexClientHandle` contract is unchanged: it still exposes only `query`, `mutation`,
`action`, and `onUpdate`. The owner still controls primary replacement, anonymous-client laziness,
subscription rebinding, connection observation, generation-bound call rejection, candidate cleanup, and
idempotent disposal.

## Coupling removed

The old owner imported the Nuxt product logger, DevTools sink, and auth-port type. Moving those imports
would have violated the private island rather than extracting a reusable lifecycle.

The cutover instead makes ownership explicit:

- the private owner accepts one contained callback for a retired client's background close failure;
- it publishes a generic committed-identity-change event;
- the Nuxt plugin maps close failures to its existing logger;
- `ConvexRuntimeContext` owns the concrete logger and DevTools sink;
- the runtime context clears identity-owned diagnostics on the generic event and disposes attached sinks
  through the owner's existing teardown registry;
- the owner consumes only the minimum settlement/generation/client-initialization shape it needs and
  imports no Nuxt, Nitro, H3, Better Auth, server, MCP, logger, DevTools, or runtime-config module.

Diagnostic callback throws are contained and cannot prevent client retirement or identity publication.
Replacing, detaching, owner-disposing, and late-attaching a DevTools sink retain exactly-once disposal
behavior.

## Admission and deletion decision

No public API, package, option, compatibility shim, or second state source was added. The identity event
is a private owner method required to keep adapter diagnostics outside the source island. It replaces the
more coupled public-internal `logger`, `getDevtoolsSink`, and `attachDevtoolsSink` owner properties.

Deleted:

- `src/runtime/client/client-owner.ts`;
- `src/runtime/client/identity-changed-error.ts`;
- concrete logger and DevTools ownership inside the shared lifecycle;
- the old diagnostic tests that coupled the owner directly to the Nuxt sink.

The diagnostic lifecycle proof moved to `test/unit/runtime-context.test.ts`; client-owner tests now prove
the generic observer boundary and containment.

## Executed proof

Focused lifecycle matrix:

```text
unit:     client owner, owner/auth integration, runtime context, callable lifecycle, auth races
security: first confirmation, auth regressions, primary reacquisition, failure recovery, identity model
Nuxt:     connection state, sign-out lifecycle, query identity, two-app isolation
browser:  authenticated identity lifecycle
```

Result: 15 files and 103 tests passed.

The complete repository check then passed:

```text
pnpm check
```

Result:

- formatting and ESLint passed;
- module, server, local-component, two-factor, and auth-security-plugin typechecks passed;
- 12 architecture rules across two packages and 240 source files passed;
- 158 test files and 1,808 tests passed across unit, security, Convex, Nuxt, and browser projects.

Static source scans find no remaining production/test import of the deleted paths and no forbidden
framework/auth/server/MCP import in `src/runtime/client-core/**`.

## Remaining identity work

This task moved only the owner-facing minimum identity shape. `P3-004` still owns the full token-free
identity snapshot/subscription/generation contract shared by query, callable, pagination, plain Vue, and
embedded runtimes. It must remove duplicate controller reads without moving Better Auth session/token
coordination into the private island.
