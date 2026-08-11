# Convex-native MCP topology probe — 2026-07-20

## Boundary proved

The private fixture at `internal/labs/mcp-topology/convex/fixture` runs the exact official
`@modelcontextprotocol/server@2.0.0-beta.4` inside a Convex HTTP action. It was deployed by
`convex@1.42.2` to the reviewed local backend:

```text
precompiled-2026-07-06-44f7aa7
darwin-arm64 SHA-256 3d28873cf24019877146367c539104d54a05a9b8ec1b501e503077474c84415d
```

The Convex bundler selected a working non-Node SDK path without repository patches or polyfills. The
deployed action uses the official `createMcpHandler`, `McpServer`, and `ResourceTemplate`. Real Node
clients use the official `Client` and `StreamableHTTPClientTransport` over loopback HTTP. No
repository-owned JSON-RPC parser or dispatcher participates.

The fixture is materialized into a temporary directory. Convex-generated files, local selection, data,
and `.env.local` remain outside the worktree and are removed with the owned backend process. The inert
`/api/auth/get-session` route exists only because the established local-backend helper performs an auth
readiness probe; it returns no identity and is not used by MCP authentication.

## Identity and authority path

```text
Authorization bearer
  → exact private-lab token verification in the one /mcp HTTP action
  → official SDK AuthInfo (inside the resource boundary)
  → request-local { subject } provenance
  → explicit internal Convex query/mutation
  → current canonical workspace + membership rows
  → effect/result
```

The bearer is not a Convex function argument. Roles and tenants are not token claims or tool arguments.
Each internal operation receives only the verified subject, loads the current workspace tenant and
membership, and authorizes from those canonical rows in the same query/mutation as the read or effect.
The four tool references and one resource reference are registered explicitly; caller-controlled values
never become Convex function references.

## Executed evidence

`internal/labs/mcp-topology/convex/probe.test.ts`:

- creates an isolated anonymous local Convex deployment;
- deploys the exact fixture and seeds two tenants;
- connects two official clients concurrently with different bearer credentials;
- discovers exactly `search_notes`, `rename_note`, `generate_report`, and `delete_workspace`;
- searches, renames, reports, and reads `note://` resources independently per tenant;
- denies a cross-tenant operation;
- rejects a forged `subject` tool argument through the strict official schema;
- denies deletion for the current editor role;
- changes that canonical membership to owner outside the MCP call and immediately permits the next
  deletion, proving current database authority;
- excludes both raw bearer sentinels from every captured HTTP response;
- stops the backend and deletes all temporary deployment state.

Reproduction (requires permission to bind loopback ports and launch the reviewed backend binary):

```sh
pnpm exec vitest run --config internal/labs/mcp-topology/convex/vitest.config.ts
```

Result on 2026-07-20: one file, one test passed in two independent permitted runs (approximately five
seconds each). A sandboxed rerun that was denied loopback `listen` permission is not counted as product
evidence; the same bytes passed immediately when the required local permission was granted.

## Remaining risks

- Static lab tokens are only a topology stimulus, not an OAuth verifier. Exact OAuth discovery,
  challenges, issuer/audience/resource binding, and revocation are `P1-010`.
- The fixture recreates an SDK handler for each Convex action. Runtime cost and timeout behavior are not
  yet measured.
- Only JSON response mode and POST traffic are exercised here. Streaming, aborts, body limits, framing,
  and concurrency stress remain `P1-009`.
- Raw bearer absence is proven from Convex function arguments by construction and from HTTP responses by
  sentinel. Full logs, diagnostics, bundle, and trace scans remain later gates.
- Passing this probe establishes viability, not the topology winner.
