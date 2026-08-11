# MCP TypeScript SDK private-lab pin — 2026-07-20

## Decision

The private Phase 1 topology laboratory uses the exact split-package MCP TypeScript SDK prerelease:

- `@modelcontextprotocol/server@2.0.0-beta.4`
- `@modelcontextprotocol/client@2.0.0-beta.4`
- transitive `@modelcontextprotocol/core@2.0.0-beta.4`

These are root `devDependencies` only. They add no `better-convex-nuxt` runtime dependency or export and
make no public support claim. The current published MCP protocol remains `2025-11-25`, and the supported
SDK line remains v1 until the `2026-07-28` protocol and corresponding SDK are final. The beta lab pin must
be replaced or rejected at `P1-015`; it must not enter a public package unchanged merely because the lab
passes.

The root lab pin is smaller than creating a package or nested manifest before the workspace boundary is
proven. The repository already runs MCP and conformance tests from the root. Phase 2 can relocate the
selected final dependency once a public package has passed its admission gate.

## Installed-byte inspection

The frozen lock records the registry integrity for all three packages. The installed packages both:

- declare Node `>=20`;
- expose ESM and CommonJS builds;
- export the official high-level `McpServer` / `Client` APIs;
- export linked `InMemoryTransport` for test-only protocol execution;
- expose the Web-standard Streamable HTTP server transport and HTTP client transport needed by the
  production topology probes.

SHA-256 values from the installed bytes:

| File                                          | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `@modelcontextprotocol/server/package.json`   | `6c38e338ad5221a0054e040b62e0f8cce0637a9d11b7fb74a44ba396aa42fae8` |
| `@modelcontextprotocol/server/dist/index.mjs` | `3e6d7ddbf39fc213cd9fec0b38d0fdc1749da26cf07aff58dfba73b8fce8c364` |
| `@modelcontextprotocol/client/package.json`   | `48b59bf78fcca2a4049d4cb5abf2e61a5f6165c040445eac65fc047c1b77133a` |
| `@modelcontextprotocol/client/dist/index.mjs` | `df3f14df9ac9929f4e39d790f651d23f075689f207a9d5e8b4f85f52c4b3828c` |

Inspection runtime: Node `24.18.0`, pnpm `10.30.3`.

The prerelease also exports unfinished Tasks, interaction, and machine-client surfaces. Their presence in
installed bytes is not an activation signal: Phase 8 remains blocked, and no lab/public code imports
those APIs before the RFC entry gates are met.

## Executed proof

`test/unit/vnext-mcp-sdk-transport.test.ts` connects the official `Client` and `McpServer` through the
official linked in-memory transport. It then executes:

1. protocol initialization and `tools/list`;
2. a schema-validated `search_notes` tool with structured content;
3. a `note://note-alpha` resource read;
4. explicit client and server disposal.

Reproduction:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec vitest run --project=unit test/unit/vnext-mcp-sdk-transport.test.ts
```

Result on 2026-07-20: one file, one test passed. This proves the selected installed SDK bytes can own the
wire exchange in Node. It does not prove either production topology, OAuth interoperability, Convex
runtime compatibility, or final-protocol support; those remain separate Phase 1 gates.
