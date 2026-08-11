# MCP SDK beta.5 reconciliation — 2026-07-22

This evidence amends the private SDK pin recorded in
[`mcp-sdk-lab-pin-2026-07-20.md`](./mcp-sdk-lab-pin-2026-07-20.md). It does not complete `P1-015`,
select a topology, or make the `2026-07-28` release candidate a supported public protocol.

## Publication status checked

Primary project sources still describe `2026-07-28` as a release candidate and the split TypeScript
SDK v2 line as prerelease development. The latest exact packages available during this check were:

| Package                             | Exact version  | Registry integrity                                                                                |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/server`      | `2.0.0-beta.5` | `sha512-i1E5l75rQKsgY/AKAIspgMBH1vEL7dqiK7tHr0L+raYcb0SWOziqNGJXGIG6NY4AlXDWIKGJQGB7Nqfs3oUi5g==` |
| `@modelcontextprotocol/client`      | `2.0.0-beta.5` | `sha512-YuuNm5f2TMoFQRje1UqVP8TJRjijCXMz4ckvoVpx1cUXuBEmykWQ2d8R536pek6UKcXT41T5nWc4qR1JFIbEmg==` |
| `@modelcontextprotocol/core`        | `2.0.0-beta.5` | `sha512-HKbY9XTbsDy1Y6r2I55TGE3JEapM0vg96e1MUmBIF9LGjos5gjhcIrTz1yvBPLg2aFKHjwhUAQfRdrCEnPxNew==` |
| `@modelcontextprotocol/conformance` | `0.1.16`       | unchanged from the current-final preflight                                                        |
| `@modelcontextprotocol/inspector`   | `1.0.0`        | unchanged from the current-final preflight                                                        |

The root and Convex laboratory manifests now pin beta.5 exactly. The packages remain development-only
and private to the topology laboratory.

## Installed-byte delta reviewed

The beta.4 and beta.5 tarballs and their published source maps were compared directly. The material
wire-contract change re-seals the release candidate after the specification adjustment tracked by the
official project:

- `clientInfo` is optional in the modern request metadata;
- discovery no longer returns `serverInfo` as a top-level result field;
- modern results carry server identity in `_meta['io.modelcontextprotocol/serverInfo']`;
- client negotiation now records a modern/legacy discovery verdict, disposes the temporary stdio probe,
  and has tighter close, timeout, and cache partitioning behavior.

No Node engine or runtime dependency boundary changed. The client and server now resolve exact core
beta.5. No compatibility adapter, parser fork, or application-facing option was added.

## Executed contract proof

`test/unit/vnext-mcp-sdk-transport.test.ts` pins modern negotiation to `2026-07-28` and proves:

- discovery, `tools/list`, `tools/call`, and `resources/read` omit top-level `serverInfo`;
- every one of those results contains the exact server identity under the official server-info metadata
  key;
- an otherwise valid modern request remains accepted after the official client-info metadata is removed;
- existing official in-memory discovery, tool, and resource behavior remains green.

Both independent production topology probes also create an additional pinned-modern client while
retaining their legacy clients. Each modern client performs discovery, `tools/list`, `search_notes`, and
the `note://note-a` resource read. Every captured modern response carries server-info metadata, the tool
returns the expected structured note, the resource returns one bounded content item, and both candidates
still expose the same four explicit neutral tools.

| Proof                                 | Command                                                                            | Result                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| SDK wire contract                     | `pnpm exec vitest run test/unit/vnext-mcp-sdk-transport.test.ts`                   | 1 file, 2 tests passed                                                 |
| Convex-native production route        | `pnpm exec vitest run --config internal/labs/mcp-topology/convex/vitest.config.ts` | 1 deployed test passed                                                 |
| Nitro production bundle and route     | `pnpm exec vitest run --config internal/labs/mcp-topology/nitro/vitest.config.ts`  | 1 production-build test passed                                         |
| Current official tools, Convex-native | same Convex command with `BCN_VNEXT_MCP_OFFICIAL_TOOLS=true`                       | Inspector and conformance preflight passed                             |
| Current official tools, Nitro-native  | same Nitro command with `BCN_VNEXT_MCP_OFFICIAL_TOOLS=true`                        | Inspector and conformance preflight passed through the exact-call path |

The existing OAuth, application-authorization, framing, redaction, Apps, exact-call, and token-absence
assertions run in those production probes and remained green. The local latency samples remain noisy
comparison input only; they are not a topology decision.

## Decision

Advance the private laboratory from beta.4 to beta.5 because the exact delta is understood and both
real candidate paths pass it. Preserve the final-publication gate:

- `P1-015` remains blocked until the protocol and corresponding SDK are actually final;
- `P1-013` remains blocked rather than fabricating stateless interaction semantics;
- `P1-017` and `G-001` remain open;
- no public MCP package or support statement follows from this reconciliation.

When final packages publish, compare them against beta.5 from exact bytes again. Do not assume this
release-candidate result shape is final merely because both private probes accept it.
