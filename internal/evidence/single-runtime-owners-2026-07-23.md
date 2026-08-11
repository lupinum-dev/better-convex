# Single lifecycle and MCP runtime owners — 2026-07-23

## Outcome

The active source and freshly built packages contain:

- one browser Convex lifecycle implementation in `packages/vue/src`;
- thin Nuxt adapters that import the public `better-convex-vue` package;
- one MCP server/runtime implementation in `packages/mcp/src`; and
- one official `McpServer` construction in `packages/mcp/src/handler.ts`.

No second Nuxt controller engine, hand-written supported MCP parser, Nitro MCP
relay, or alternative MCP server construction remains. The former Nitro
candidate remains only on the frozen archive branch recorded by `D-019`; it is
not in the active source, dependency graph, or artifacts.

## Durable gate

`scripts/check-single-runtime-owners.mjs` replaces the narrower historical Nuxt
client-engine check. It preserves those source and `dist` sentinels and adds:

- deleted-path checks for the old client engine, Nuxt MCP relay, service
  starter, and delegated starter parser/security files;
- AST import-edge checks that permit value imports from the official MCP server
  SDK only inside `packages/mcp/src`;
- an AST construction check requiring exactly one `new McpServer(...)`, in the
  package-owned handler;
- hand-written protocol-literal sentinels in remaining MCP-named production
  paths outside the package owner; and
- fresh Nuxt/Vue/MCP `dist` checks proving the Nuxt artifact contains no MCP
  server and the MCP artifact retains one external official-SDK runtime.

Type-only official SDK imports remain allowed in application composition, so a
starter can type its registration callback without becoming a protocol owner.
The Apps client entry is also intentionally separate: it imports the official
Apps SDK, not the MCP server runtime.

The gate is part of the canonical contracts check and root prepack. There is
one script and one unit suite rather than keeping the old and new gates in
parallel.

## Deletion evidence

The original lifecycle cutover deleted the Nuxt controllers and private source
island, as recorded in
`internal/evidence/client-lifecycle-single-source-cleanup-2026-07-22.md`.
The MCP hard cut deleted 18,650 lines of the relay, hand-written parser,
duplicate starter, and topology comparison paths, as recorded in
`internal/evidence/mcp-single-topology-hard-cut-2026-07-22.md`.

This final proof also removed the stale empty `src/runtime/server/mcp`
directory from the local build tree. No compatibility script or alternate
runtime was added.

## Executed proof

```text
pnpm --dir packages/vue build
pnpm --dir packages/mcp build
pnpm run build:package
pnpm run check:single-runtime-owners
pnpm run check:single-runtime-owners:dist
pnpm run check:boundaries
pnpm exec vitest run --project=unit \
  test/unit/single-runtime-owners.test.ts --reporter=verbose
pnpm check
```

The three package builds passed. The source and fresh-artifact ownership gates
passed, all 13 AST architecture rules passed over 263 files, and the focused
suite passed 6 tests including deliberately reintroduced duplicate runtime,
constructor, parser, removed-path, and bundle failures. From committed source,
the canonical repository gate also passed formatting, lint, module/server/
fixture typechecks, the architecture graph, and 163 files containing 1,884
tests. The localhost-dependent tests were run with loopback permission; their
initial sandbox-denied `EPERM` results were environmental and passed unchanged
when the required permission was present.
