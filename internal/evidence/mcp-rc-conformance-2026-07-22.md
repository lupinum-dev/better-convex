# MCP locked-RC conformance boundary — 2026-07-22

## Decision

The experimental MCP package targets the locked `2026-07-28` release candidate through the exact
official TypeScript SDK beta. It does not claim final-spec or stable-SDK compliance before July 28.

Conformance is intentionally split by protocol support:

1. `@modelcontextprotocol/conformance@0.1.16` remains an official-tool checkpoint for the protocol
   revisions it actually advertises, but is not run against the RC-only product server.
2. `runRcProtocolConformance` is a BCN black-box locked-RC layer driven by the exact official
   `@modelcontextprotocol/client@2.0.0-beta.5` client. It is not described as the official conformance
   suite.

The selected-scenario legacy relay is deleted. The official conformance package has no
`2026-07-28` server scenarios, and its `2025-11-25` initialize handshake cannot truthfully certify an
RC-only stateless server. Re-enabling the legacy protocol solely to satisfy that tool would contradict
the selected product boundary. The final matching official suite remains a separate stabilization
gate (`P9-004`).

## Exact dependency and publication checkpoint

Installed and lockfile-pinned on 2026-07-22:

```text
@modelcontextprotocol/client@2.0.0-beta.5
@modelcontextprotocol/server@2.0.0-beta.5
@modelcontextprotocol/core@2.0.0-beta.5
@modelcontextprotocol/conformance@0.1.16
@modelcontextprotocol/inspector@0.22.0
```

Primary sources checked:

- [MCP `2026-07-28` release-candidate announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [official conformance suite](https://github.com/modelcontextprotocol/conformance)

The announcement says the RC was locked on May 21 and the final specification is scheduled for July 28. The SDK remains a prerelease and its repository still recommends v1 for production until the new
spec and stable v2 ship. Therefore this repository may build and certify an experimental package now,
but it may not promote the protocol or SDK contract as stable.

`pnpm exec conformance list --server` for `0.1.16` listed only `2025-06-18` and `2025-11-25` for every
scenario. It advertised no locked-RC scenario.

## Locked-RC invariants executed

The official v2 client is pinned to `2026-07-28` and must complete exactly two stateless requests:

- `server/discover`;
- `tools/list`.

The runner rejects any endpoint other than an exact `/mcp` URL and proves:

- no `initialize`, `notifications/initialized`, or `Mcp-Session-Id` exchange;
- exact `MCP-Protocol-Version`, `Mcp-Method`, and per-request client/version/capability metadata;
- complete result metadata with server name and version;
- an exact `tools`-only advertised capability surface;
- private, zero-TTL discovery and tool-list results;
- JSON Schema 2020-12 object-root tool inputs;
- fail-closed missing or mismatched `Mcp-Method`;
- fail-closed mismatched `Mcp-Name` for tool calls;
- method-not-found results for unadvertised prompts, resources, and Tasks;
- bearer absence from every inspected response.

Exact capability equality is the negative extension proof: Apps, Tasks, prompts, resources, roots,
sampling, and logging are not silently advertised by the base package consumer.

## Official-tool status

The current Inspector and official conformance versions previously passed the current-final
preflight against both topology candidates; see
`internal/evidence/mcp-official-tools-preflight-2026-07-22.md`. They do not certify the locked RC.

A full local OAuth run on 2026-07-22 reached the existing MCP gate, then Inspector `0.22.0`
failed to settle its legacy OAuth connection and timed out waiting for `Connected`. Its logs show the
v1 SDK transport and repeated authorization callbacks. This is recorded as an official-tool version
gap, not hidden as RC success and not worked around by weakening the stateless server contract. The
RC runner executes against the deployed server once a bearer reaches the conformance stage; exact
deployed execution is owned by `P5-023`.

## Executed local proof

```text
pnpm exec vitest run test/mcp/mcp-runner-contracts.test.ts
  1 file, 5 tests passed

pnpm test:mcp-conformance
  2026-07-28 RC: 2 stateless requests, 5 tools, exact tools-only capability
  live PKCE, Convex authorization, terminal revocation, and server conformance passed

pnpm exec eslint scripts/run-mcp-conformance.mjs test/mcp/mcp-runner-contracts.test.ts
pnpm exec oxfmt scripts/run-mcp-conformance.mjs test/mcp/mcp-runner-contracts.test.ts
git diff --check
```

The in-memory proof uses the official server handler rather than a BCN protocol double. `P5-023`
must execute the same RC runner against installed package bytes in the selected production Convex
runtime. Matching official conformance scenarios must be added after the tool publishes them; older
initialize-era scenarios are not retained as a compatibility product.
