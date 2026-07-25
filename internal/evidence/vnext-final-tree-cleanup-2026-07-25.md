# vNext final-tree cleanup — 2026-07-25

## Outcome

The active tree has one Vue client lifecycle owner, one official-SDK-backed MCP server owner, and thin
Nuxt adapters. The losing Nitro topology, hand-written MCP parser, duplicate Nuxt client controllers,
service bridge, and superseded starter paths remain absent. No compatibility path was restored.

No additional production deletion was justified in this pass:

- `runMcpTool()` remains because the neutral and Ginko consumers use it as the one narrow sanitized
  tool-result boundary recorded by `P9-021`;
- the Agentic SaaS application remains an internal mock-only laboratory recorded by `P9-021`, not a
  maintained starter or public package;
- locked historical evidence and immutable candidate artifacts remain evidence, not active release
  inputs; and
- ignored local build, audit, dependency, and candidate caches are not part of the tracked source or
  packed packages.

The direct dependency inventory for Nuxt, Vue, and MCP was checked against production imports. Every
runtime dependency has a current owner; no speculative replacement package, bridge export, or public
core was added.

## Executed proof

```text
pnpm run check:no-old-auth-runtime
pnpm run check:single-runtime-owners
pnpm run check:no-starter-generated-artifacts
pnpm run check:workspace-deps
pnpm run check:contracts
pnpm run check
```

The source-owner, removed-path, generated-artifact, workspace dependency, and package contract gates
passed. The clean committed tree passed formatting, lint, module/server/fixture typechecks, all 13
architecture boundaries, and 164 files containing 1,889 tests. The exact historical package set also
passed five pnpm maintained applications, one npm consumer, and the production lifecycle runner after
the maintained lock hardening.

The first contract run reached npm packing but the sandbox could not write the user npm cache. Repeating
the unchanged packed-export portion with a task-specific temporary cache and registry permission passed;
this was an environment permission failure, not a source failure.

## Remaining work

This closes implementation cleanup only. Product documentation still needs the `P9-013` supported /
experimental / deferred truth pass before fresh package identities and artifacts are created in
`P9-014`. Final MCP specification claims, protected staging, real-host evidence, and publication remain
their existing external gates.
