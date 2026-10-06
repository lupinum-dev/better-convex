<p align="center"><img src="https://raw.githubusercontent.com/lupinum-dev/better-convex/main/docs/public/web-app-manifest-512x512.png" width="128" alt="Better Convex icon"></p>

<h1 align="center">@lupinum/better-convex-agents</h1>

<p align="center">Let AI hosts such as ChatGPT and Claude, and your own agents, call your Convex functions, with approvals, limits and an activity feed.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lupinum/better-convex-agents"><img src="https://img.shields.io/npm/v/@lupinum/better-convex-agents?label=npm" alt="npm version"></a>
  <a href="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml"><img src="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/lupinum-dev/better-convex/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

> [!WARNING]
> This package is experimental (`0.x`). Its API can change in any release until `1.0.0`.

## Purpose

This package builds on [`@lupinum/better-convex-functions`](https://www.npmjs.com/package/@lupinum/better-convex-functions).
An operation with a `tool` field becomes a tool that agents can call:

- `defineTools` (`@lupinum/better-convex-agents`) collects those operations and returns one
  internal Convex function per tool, the approval functions (`pending`, `get`, `approve`,
  `decline`), the activity feed and `housekeeping` for a cron. A tool call runs the same
  operation, policy and row rules as the web, as the agent of the person who connected it.
- An action that the policy holds for a person (`agents: { action: 'approve' }`) waits for that
  person, or an approver, to approve it in your application. Approving runs it in the same
  transaction, and fails if the rows changed since the request.
- Agent writes are limited per minute, open requests per agent, and every agent write lands in
  the tenant's activity feed.
- `createMcpServer` (`@lupinum/better-convex-agents/mcp`) publishes the tools to MCP hosts from
  one Convex HTTP action. A connection sees only the tools its OAuth scopes unlock.

[MCP](https://modelcontextprotocol.io) (Model Context Protocol) is the protocol that AI hosts
use to call tools. `handleMcpRequest`, the transport under `createMcpServer`, also works on
its own: it accepts only bounded MCP requests, checks the OAuth access token of each request
against your issuer and your MCP resource URL, answers a missing or insufficient token with
the standard OAuth challenge, and gives your tools the verified user as a typed `principal`.

## Requirements

- Node.js `^22.19.0 || ^24.11.0`
- Convex `>=1.42.2 <2` and `@lupinum/better-convex-functions`
- For MCP hosts: `@modelcontextprotocol/server` `2.1.0` (an exact peer dependency that only
  `/mcp` loads) and an OAuth token verifier. With Better Convex authentication, the auth
  factory from `@lupinum/better-convex-nuxt/better-auth/server` provides it.

## Installation

```bash
pnpm add @lupinum/better-convex-agents@next @lupinum/better-convex-functions@next @modelcontextprotocol/server@2.1.0
```

## Quick start

Give an operation a `tool` field, then collect the tools in one module that exports each tool
function:

```ts
// convex/agents.ts
import { defineTools } from '@lupinum/better-convex-agents'
import { internal } from './_generated/api'
import { fns } from './functions'
import * as projects from './projects'

export const tools = defineTools(fns, { projects }, { functions: internal.agents })
export const { create_project, archive_project, check_approval, housekeeping } = tools.functions
export const { pending, get, approve, decline } = tools.approvals
export const { activity } = tools
```

Serve them to MCP hosts from `convex/http.ts`. `auth` is the Better Convex auth factory with an
`oauth.mcp` profile:

```ts
// convex/http.ts
const mcp = createMcpServer(auth, { name: 'Projects', agents })
```

`starters/mcp-oauth-agent` in the repository is the complete example, with login, consent and
an approval page.

### Register tools yourself

Without `@lupinum/better-convex-functions` operations, register each tool with the official
SDK inside `handleMcpRequest`. The tool passes the typed `principal` to an internal Convex
function. First, turn on the MCP OAuth profile in `convex/auth.ts`:

```ts [convex/auth.ts]
export const auth = createBetterConvexAuth<DataModel>(components.betterAuth, {
  oauth: { mcp: { scopes: { 'notes:read': 'Read your notes' } } },
})
```

```ts [convex/mcp.ts]
import { handleMcpRequest } from '@lupinum/better-convex-agents/mcp'
import { z } from 'zod'

import { internal } from './_generated/api'
import { httpAction } from './_generated/server'
import { auth } from './auth'

export const handleMcp = httpAction((ctx, request) =>
  handleMcpRequest(request, {
    serverInfo: { name: 'notes', version: '1.0.0' },
    // The resource, issuer, scopes and token verifier of the `oauth.mcp` profile.
    ...auth.mcpAuthorization(ctx),
    configureServer({ principal, server, tools }) {
      server.registerTool(
        'list_notes',
        {
          description: 'List your newest notes.',
          inputSchema: z.object({}).strict(),
          annotations: { readOnlyHint: true, openWorldHint: false },
          scopeChallenge: tools.requireScopes('notes:read'),
        },
        () =>
          tools.runTool('list_notes', async () => {
            const result = await ctx.runQuery(internal.notes.list, { principal })
            return { content: [{ type: 'text', text: JSON.stringify(result) }] }
          }),
      )
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

| Export                             | Entry   | Use                                                                                                                                                                      |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `defineTools`                      | `.`     | Tools, approvals, activity and housekeeping from the operations that have a `tool` field.                                                                                |
| `createMcpServer`                  | `/mcp`  | The MCP door: an HTTP action that publishes the tools of `defineTools` to MCP hosts.                                                                                     |
| `handleMcpRequest`                 | `/mcp`  | Handles one MCP HTTP request. Options: `serverInfo`, `resource`, `authorization`, `configureServer`, and optional `requestState`, `exposeErrorCodes`, and `onToolError`. |
| `projectMcpToolError`              | `/mcp`  | Turns an exposed `ConvexError` into a tool error result. Returns `undefined` for any other error.                                                                        |
| `McpUnsupportedCapabilityError`    | `/mcp`  | Thrown when the server offers a capability other than tools and resources.                                                                                               |
| `listMcpCatalog`                   | `/test` | Returns the `tools/list` and `resources/list` results that a client sees, for snapshot tests.                                                                            |
| `testMcpAuth`, `mcpClient`, `refs` | `/test` | The MCP token check faked for convex-test, a JSON-RPC client over its HTTP router, and `internal.<module>` without codegen.                                              |

`configureServer` receives one object with the verified `access`, the verifier's `principal`, the request's `server`, and `tools`. `tools.runTool(name, operation)` runs an operation with this request's error handling. `tools.requireScopes(...scopes)` returns the scope challenge for a tool or resource.

Errors: a `ConvexError` whose `data.code` is in `exposeErrorCodes` becomes a structured tool error with its `data.message` and `data.retryable`. `UNAUTHENTICATED`, `MCP_ACCESS_DENIED`, and `MCP_INSUFFICIENT_SCOPE` use static generic messages unless their codes are in `exposeErrorCodes`. Every other error becomes one generic failure, so internal details do not reach the model. Tools from `defineTools` show the model the library's error codes and messages.

<!-- BEGIN:consumer-onboarding -->

## Use a coding agent

A coding agent is a development tool that can inspect and change your project.
Every Better Convex package contains documentation for coding agents that
matches the installed version: `dist/agent/AGENTS.md`, also exported as
`<package>/agent-docs`. It starts with a task index and the rules that agents
most often get wrong.

Add this pointer to your project's `AGENTS.md` (or `CLAUDE.md`). Name the
package that you installed:

```md [AGENTS.md]
## Better Convex

Before you change Convex functions or Better Convex code, read
`node_modules/@lupinum/better-convex-nuxt/dist/agent/AGENTS.md` and follow its
"Start here" table. It matches the installed version. Prefer it over the
website and over knowledge of earlier versions.
```

To add Better Convex to an application, give your agent this prompt:

```text
Add Better Convex to this application. Install @lupinum/better-convex-nuxt@next
(or @lupinum/better-convex-vue@next for Vue without Nuxt). Then read
node_modules/<package>/dist/agent/AGENTS.md and follow its "Start here" table.
Add the Better Convex pointer from the package README to AGENTS.md. Finish
with the "Check your setup" steps of the Installation page.
```

The pointer names the installed package, so an upgrade or a rollback selects
the matching documentation. Installing a package never changes your project
instructions.

<!-- END:consumer-onboarding -->

## Documentation

Read [MCP on Convex](https://better-convex.lupinum.com/docs/build/agents/mcp), [add MCP to your application](https://better-convex.lupinum.com/docs/build/agents/mcp-application), [connect ChatGPT and Claude](https://better-convex.lupinum.com/docs/build/agents/connect-chatgpt-and-claude), and the [delegated OAuth reference](https://better-convex.lupinum.com/docs/build/authentication/delegated-oauth-and-mcp).

## Support and security

Open a [GitHub issue](https://github.com/lupinum-dev/better-convex/issues) for support. Report a vulnerability privately through the [security policy](https://github.com/lupinum-dev/better-convex/security/policy).

## License

This package uses the [MIT License](https://github.com/lupinum-dev/better-convex/blob/main/LICENSE).
