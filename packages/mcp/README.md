<p align="center"><img src="https://raw.githubusercontent.com/lupinum-dev/better-convex/main/docs/public/web-app-manifest-512x512.png" width="128" alt="Better Convex icon"></p>

<h1 align="center">@lupinum/better-convex-mcp</h1>

<p align="center">Serve MCP tools from a Convex HTTP action, so AI hosts such as ChatGPT and Claude can call your Convex functions.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lupinum/better-convex-mcp"><img src="https://img.shields.io/npm/v/@lupinum/better-convex-mcp?label=npm" alt="npm version"></a>
  <a href="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml"><img src="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/lupinum-dev/better-convex/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

> [!WARNING]
> This package is experimental prerelease software. Your application decides which tools exist and what each tool may read or change.

## Purpose

[MCP](https://modelcontextprotocol.io) (Model Context Protocol) lets an AI host call tools that your application defines. This package runs an MCP server inside one Convex HTTP action. It:

- accepts only bounded MCP requests on the modern protocol version `2026-07-28`;
- checks the OAuth access token of each request against your issuer and your MCP resource URL;
- answers a missing or insufficient token with the standard OAuth challenge, so the host can ask the user to sign in or grant more scopes;
- gives your tools the verified user as a typed `principal`;
- turns errors that you choose to expose into structured tool errors, and every other error into one generic failure.

The package does not export your Convex functions automatically. You register each tool yourself. Each tool calls one internal Convex function, and that function checks what the user may do before it reads or writes data.

## Requirements

- Node.js `^22.19.0 || ^24.11.0`
- A Convex deployment with HTTP actions
- An OAuth token verifier. With Better Convex authentication, use `auth.createMcpAccessVerifier(ctx)` from `@lupinum/better-convex-nuxt/better-auth/server`.

`@modelcontextprotocol/server` `2.1.0` is an exact peer dependency. `McpServer` crosses this package's API, so your application installs the SDK and both share one copy.

## Installation

```bash
pnpm add @lupinum/better-convex-mcp@1.0.0-rc.0 @modelcontextprotocol/server@2.1.0 zod@4.6.5
```

## Quick start

This example uses Better Convex authentication. First, turn on the MCP OAuth profile in `convex/auth.ts`:

```ts [convex/auth.ts]
export const auth = createBetterConvexAuth<DataModel>(components.betterAuth, {
  oauth: { mcp: { scopes: { 'notes:read': 'Read your notes' } } },
})
```

Handle MCP requests in an HTTP action. The tool passes the typed `principal` to an internal Convex function:

```ts [convex/mcp.ts]
import { handleMcpRequest, registerMcpTool } from '@lupinum/better-convex-mcp'
import { z } from 'zod'

import { internal } from './_generated/api'
import { httpAction } from './_generated/server'
import { auth } from './auth'

export const handleMcp = httpAction((ctx, request) =>
  handleMcpRequest(request, {
    serverInfo: { name: 'notes', version: '1.0.0' },
    resource: auth.mcp.resource(),
    authorization: {
      mode: 'oauth',
      issuer: auth.mcp.issuer(),
      verifier: auth.createMcpAccessVerifier(ctx),
      scopesSupported: auth.mcp.scopesSupported(),
    },
    configureServer({ principal, server, tools }) {
      registerMcpTool(server, tools, {
        name: 'list_notes',
        description: 'List your newest notes.',
        risk: 'read',
        scopes: ['notes:read'],
        inputSchema: z.object({}).strict(),
        outputSchema: z.object({ notes: z.array(z.object({ id: z.string(), title: z.string() })) }),
        handler: async () => ({
          structuredContent: await ctx.runQuery(internal.notes.list, { principal }),
        }),
      })
    },
  }),
)
```

Check the principal inside the internal function, before you read data:

```ts [convex/notes.ts]
import { mcpPrincipalValidator } from '@lupinum/better-convex-nuxt/better-auth/server'

import { internalQuery } from './_generated/server'
import { auth } from './auth'

export const list = internalQuery({
  args: { principal: mcpPrincipalValidator },
  handler: async (ctx, { principal }) => {
    const { user } = await auth.requireMcpPrincipal(ctx, principal, { scope: 'notes:read' })
    const notes = await ctx.db
      .query('notes')
      .withIndex('by_owner', (q) => q.eq('ownerId', user.id))
      .take(20)
    return { notes: notes.map((note) => ({ id: note._id, title: note.title })) }
  },
})
```

Register the MCP route and its OAuth metadata route in `convex/http.ts`. The [MCP guide](https://better-convex.lupinum.com/docs/build/agents/mcp#register-the-routes) shows the five route registrations. Then [connect ChatGPT and Claude](https://better-convex.lupinum.com/docs/build/agents/connect-chatgpt-and-claude).

Use `mcpPrincipalValidator` only on internal functions. A public function would let any caller name another user.

### Use another token provider

For another OAuth provider, write a verifier that implements the
[verifier contract](https://better-convex.lupinum.com/docs/build/agents/mcp#use-another-token-provider),
for example as `applicationTokenVerifier` in `convex/mcp/verify.ts`. It must
check the token and its issuer, resource, identity, granted scopes, and
actual expiry in Unix seconds. Never return a fixed identity or an invented
expiry. Then import it with
`import { applicationTokenVerifier } from './mcp/verify'` and pass
`verifier: applicationTokenVerifier`.

## Exports

| Export                          | Use                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `handleMcpRequest`              | Handles one MCP HTTP request. Options: `serverInfo`, `resource`, `authorization`, `configureServer`, and optional `requestState`, `exposeErrorCodes`, and `onToolError`. |
| `registerMcpTool`               | Defines one tool and registers it on the request's server.                                                                                                               |
| `defineMcpTool`                 | Returns `{ name, config, handler }`. Pass it to `server.registerTool` or to `registerAppTool` for an MCP Apps tool.                                                      |
| `runMcpTool`                    | Runs a tool operation outside `configureServer`. A thrown error becomes a tool result.                                                                                   |
| `projectMcpToolError`           | Turns an exposed `ConvexError` into a tool error result. Returns `undefined` for any other error.                                                                        |
| `McpUnsupportedCapabilityError` | Thrown when the server offers a capability other than tools and resources.                                                                                               |
| `listMcpCatalog`                | From `@lupinum/better-convex-mcp/test`. Returns the `tools/list` and `resources/list` results that a client sees, for snapshot tests.                                    |

`configureServer` receives one object with the verified `access`, the verifier's `principal`, the request's `server`, and `tools`. `tools.runTool(name, operation)` runs an operation with this request's error handling. `tools.requireScopes(...scopes)` returns the scope challenge for a tool or resource.

A tool definition sets `risk` to `read`, `write`, or `destructive`. The package turns `risk` into the MCP hints that hosts use to ask for confirmation. `scopes` lists the OAuth scopes the tool needs.

Errors: a `ConvexError` whose `data.code` is in `exposeErrorCodes` becomes a structured tool error with its `data.message` and `data.retryable`. `UNAUTHENTICATED`, `MCP_ACCESS_DENIED`, and `MCP_INSUFFICIENT_SCOPE` are always exposed. Every other error becomes one generic failure, so internal details do not reach the model.

<!-- BEGIN:consumer-onboarding -->

## Use a coding agent

A coding agent is a development tool that can inspect and change your project.
After installation, copy this prompt into your coding agent:

```text
Add Better Convex to this application using the smallest suitable Nuxt, Vue,
or MCP package. Read the project's existing instructions first. Resolve the
installed @lupinum/better-convex-*/agent-docs export from this application's
directory and read its starting pages. Use the installed version's examples
and public types. Preserve existing authorization, routes, conventions, and
AGENTS.md instructions. Convex functions remain the source of truth for
authorization; do not move that rule into client state, Nuxt middleware, or MCP
transport. Add or update one short Better Convex pointer in AGENTS.md if the
project allows it; do not duplicate the documentation. If the file is absent,
create only that pointer. Report missing guidance. Verify the affected type,
build, runtime, authentication, and disposal boundaries.
```

If the installed package has no `agent-docs` export, read its packaged README
and types. Use documentation from the matching source tag when more detail is
needed. Installing or updating the package does not edit project instructions.
The pointer resolves the installed package, so upgrades and rollbacks select
the matching documentation without copying it into your application.

<!-- END:consumer-onboarding -->

## Documentation

Read [MCP on Convex](https://better-convex.lupinum.com/docs/build/agents/mcp), [add MCP to your application](https://better-convex.lupinum.com/docs/build/agents/mcp-application), [connect ChatGPT and Claude](https://better-convex.lupinum.com/docs/build/agents/connect-chatgpt-and-claude), and the [delegated OAuth reference](https://better-convex.lupinum.com/docs/build/authentication/delegated-oauth-and-mcp).

## Support and security

Open a [GitHub issue](https://github.com/lupinum-dev/better-convex/issues) for support. Report a vulnerability privately through the [security policy](https://github.com/lupinum-dev/better-convex/security/policy).

## License

This package uses the [MIT License](https://github.com/lupinum-dev/better-convex/blob/main/LICENSE).
