# Nitro-native MCP topology probe — 2026-07-20

## Boundary proved

`internal/labs/mcp-topology/nitro/notes-handler.ts` maps the neutral notes application's five explicit
surfaces to the official SDK:

- `search_notes`;
- `rename_note`;
- `delete_workspace`;
- `generate_report`;
- `note://{id}`.

The probe uses `createMcpHandler`, `McpServer`, `ResourceTemplate`, `Client`, and
`StreamableHTTPClientTransport` from the exact private SDK pin. There is no JSON-RPC parser, tool
dispatcher, generic Convex-function registry, or shared topology abstraction in repository code.

The handler instance is shared, but the SDK constructs a fresh server from its factory for each HTTP
exchange. A host-verified actor is copied into that request's private SDK `AuthInfo.extra` and captured by
only that server's explicit handlers. Identity is not module-global, tool input, output, or application
state. The application receives only its `NotesApplicationActor`; it never receives `AuthInfo`, the bearer
token, headers, or the HTTP request.

This is a private Web-standard handler seam suitable for Nitro wrapping. It does not yet certify an H3
adapter, production Nitro bundle, real socket, OAuth verifier, request-size policy, or deployed runtime;
those are separate `P1-007` through `P1-010` gates.

## Executed evidence

`test/unit/vnext-mcp-nitro-probe.test.ts` connects two official clients concurrently through the same
official HTTP handler. Each request carries a different verified actor, client, raw-token sentinel, and
shared authorization-header sentinel. The test proves:

- both clients discover exactly the four explicit tools;
- tool schemas contain no subject or tenant identity input;
- strict schemas reject an attempted `tenantId` injection;
- each tenant sees, renames, and reads only its own note;
- a cross-tenant read returns the application-owned `ACCESS_DENIED` outcome;
- owner/editor authorization for workspace deletion remains application-owned;
- reports and deletion use current canonical application state;
- no token or authorization-header sentinel appears in any HTTP response;
- both clients and the handler dispose cleanly.

Reproduction:

```sh
pnpm exec vitest run --project=unit test/unit/vnext-mcp-nitro-probe.test.ts
pnpm exec vue-tsc --noEmit --project tsconfig.json
```

Result on 2026-07-20: one topology test passed and repository type checking passed. The combined neutral,
SDK, and Nitro slice passed six tests across three files.

## Remaining risks

- The SDK's `AuthInfo` internally retains the validated token by contract. Absence is proven only from the
  application boundary and response surface in this task; diagnostics/log/artifact scans follow later.
- The per-request factory is favorable for identity isolation but has unmeasured construction cost.
- This task does not establish whether Nitro wins the topology decision. The Convex-native probe must be
  implemented independently and compared before any adapter is public.
