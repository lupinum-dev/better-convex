# MCP URL-interaction gate — 2026-07-21

## Result

The published MCP `2025-11-25` URL-elicitation protocol cannot provide the RFC's truthful
supported/unsupported branch through either vNext candidate's intentionally stateless HTTP serving.
`P1-013` therefore remains blocked on the final stateless interaction protocol and SDK. No Better
Convex URL-interaction API, state table, compatibility channel, or clickable fallback was added.

This is a protocol-era limitation, not a failure of URL elicitation itself. A sessionful 2025 server
can retain the capabilities declared at `initialize`; the two candidate topologies deliberately use a
fresh official-SDK server for every HTTP request so they can run on horizontally scaled Nitro and
Convex HTTP actions without a second session store.

## Authority checked

Checked on 2026-07-21:

- [published MCP `2025-11-25` elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation):
  URL capability is declared during initialization; URL mode may use `elicitation/create` or
  `URLElicitationRequiredError` (`-32042`); `accept` means navigation consent, not completion;
- [published MCP `2025-11-25` lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle):
  client capabilities are exchanged during initialization;
- [draft elicitation](https://modelcontextprotocol.io/specification/draft/client/elicitation): the
  release-candidate design instead carries client capabilities on every request and uses an embedded
  `input_required` multi-round-trip result;
- [2026-07-28 release-candidate notice](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/):
  the final specification is scheduled for 2026-07-28 and remains non-final at this checkpoint;
- [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk): v1 remains the
  supported production release until the v2/stable specification release.

Installed official-SDK tuple:

| Package                        | Version        | Installed `package.json` SHA-256                                   |
| ------------------------------ | -------------- | ------------------------------------------------------------------ |
| `@modelcontextprotocol/server` | `2.0.0-beta.4` | `6c38e338ad5221a0054e040b62e0f8cce0637a9d11b7fb74a44ba396aa42fae8` |
| `@modelcontextprotocol/client` | `2.0.0-beta.4` | `48b59bf78fcca2a4049d4cb5abf2e61a5f6165c040445eac65fc047c1b77133a` |
| `@modelcontextprotocol/core`   | `2.0.0-beta.4` | `1ece725335b5396af57ea3f7515be8abc8c9d5964c8ab5b5476146876e2d9c0a` |

The installed beta reports `LATEST_PROTOCOL_VERSION = "2025-11-25"` and does not list
`2026-07-28` in `SUPPORTED_PROTOCOL_VERSIONS`. Its declaration bytes describe both eras explicitly:

- 2025 server-to-client `elicitInput` and `-32042` are legacy-only;
- 2026 URL interaction uses `inputRequired.elicitUrl(...)` and a per-request capability envelope;
- `McpRequestContext` for the 2025 stateless leg contains only `era`, optional validated `authInfo`,
  and optional `requestInfo`—not the earlier initialize capabilities;
- `legacy: 'stateless'` creates a fresh server instance for every request.

Installed declaration hashes used for that inspection:

```text
70e7e36316da79e30d8c81539d19e6be492854d4160f6e85dfee4f5a408b8ca4  @modelcontextprotocol/server createMcpHandler declaration
a9767737a47198f6271e75cbbc91e5e897a0a4f6b17e323e784be0de2f3ac5dd  @modelcontextprotocol/client index declaration
```

## Executed proof

`test/unit/vnext-mcp-url-interaction-gate.test.ts` connects two official clients to the exact
official stateless HTTP handler:

1. one client initializes with `elicitation.url`;
2. one client initializes without elicitation capability;
3. both call the same explicit tool;
4. the tool uses the official `UrlElicitationRequiredError` with an inert, opaque-locator URL;
5. both clients receive the same `-32042` URL interaction because the later tool requests are
   byte-identical and the factory receives no client-capability state;
6. a fresh legacy factory instance is created for every initialize, initialized notification, and
   tool-call request.

Command:

```sh
pnpm exec vitest run --project=unit test/unit/vnext-mcp-url-interaction-gate.test.ts
pnpm exec eslint test/unit/vnext-mcp-url-interaction-gate.test.ts
```

Result: one regression test passed; ESLint passed.

The limitation applies to both candidates, not just the unit harness:

- Nitro selects `{ legacy: 'stateless', responseMode: 'json' }` in
  `internal/labs/mcp-topology/nitro/notes-handler.ts`;
- Convex-native selects the same mode and constructs/closes the handler inside each HTTP action in
  `internal/labs/mcp-topology/convex/fixture/convex/mcp.ts`.

## Why the remaining matrix was not fabricated

Wrong-user, inert-GET, expiry, stale-impact, replay, and exactly-once effect tests require an actual
application-owned pending interaction. Creating such a record before the official stateless
capability branch exists would add state that an unsupported client cannot reach truthfully and would
turn a protocol probe into a speculative workflow implementation. Returning its URL in ordinary tool
content would violate the RFC's explicit no-clickable-fallback rule.

Those tests remain the acceptance proof for `P1-013` after final protocol publication and for Phase 6.
Until then the only correct behavior is to keep ordinary writes ordinary and report high-impact direct
interaction as unavailable rather than create dependent state.

## Rejected workarounds

- Do not put client capabilities in a custom header, tool argument, or bearer claim.
- Do not persist an MCP session solely to bridge initialize capabilities into stateless calls.
- Do not return the interaction URL as tool text or a resource link when URL elicitation is absent.
- Do not certify the installed `2026-07-28` beta code as a final protocol contract.
- Do not build the application interaction record until the negotiated path can reach it.

## Re-entry condition

Resume `P1-013` only after the final `2026-07-28` specification and a compatible official SDK are
published and reconciled by `P1-015`. The first re-entry proof must use the final per-request
capability mechanism through both candidates and then execute supported, unsupported, wrong-user,
GET, expiry, stale, and replay cases without a custom wire extension.
