<p align="center"><img src="https://raw.githubusercontent.com/lupinum-dev/better-convex/main/docs/public/web-app-manifest-512x512.png" width="128" alt="Better Convex icon"></p>

<h1 align="center">@lupinum/better-convex-mcp</h1>

<p align="center">Serve a bounded, provider-neutral MCP endpoint from a Convex HTTP Action.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lupinum/better-convex-mcp"><img src="https://img.shields.io/npm/v/@lupinum/better-convex-mcp?label=npm" alt="npm version"></a>
  <a href="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml"><img src="https://github.com/lupinum-dev/better-convex/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/lupinum-dev/better-convex/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

> [!WARNING]
> This package is experimental beta software. Applications remain responsible for tools, roles, permissions, and effects.

## Purpose

Use this package to serve MCP tools from a Convex HTTP Action to hosts such as ChatGPT and Claude. It handles the MCP transport, request bounds, bearer challenges, and exact issuer and resource verification. It gives each request the verified access context and the verifier's typed principal.

Tools stay explicit. Each tool calls one Convex function, and that function reloads and enforces current application authorization.

## Requirements

The package requires Node.js `^22.19.0 || ^24.11.0` and the modern MCP protocol `2026-07-28`. OAuth mode requires the documented transport and protected-resource metadata routes. Preconfigured bearer mode exposes only the transport routes.

## Installation

```bash
pnpm add @lupinum/better-convex-mcp@1.0.0-beta.3 @modelcontextprotocol/server@2.1.0 zod@4.6.5
```

## Quick start

With Better Convex auth, configure `oauth: { mcp: { scopes } }` in `createBetterConvexAuth` and use its verifier. The tool passes the typed principal to an internal Convex function, which calls `auth.requireMcpPrincipal` before it reads data.

```ts
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

For another token provider, implement the
[provider-neutral verifier contract](https://better-convex.lupinum.com/docs/build/agents/mcp#use-another-token-provider)
in your application, for example as `applicationTokenVerifier` in
`convex/mcp/verify.ts`. It must validate the token and its issuer, resource,
identity, granted scopes, and actual expiry in Unix seconds. Never substitute a
fixed identity or invented expiry. Then import it with
`import { applicationTokenVerifier } from './mcp/verify'` and pass
`verifier: applicationTokenVerifier`.

## Exports

`configureServer` receives one object: the verified `access`, the verifier's typed `principal`, the per-request `server`, and `tools` with `runTool(name, operation)` and `requireScopes(...scopes)`. `requestState` receives `{ access, principal }`.

`registerMcpTool(server, tools, definition)` and `defineMcpTool(tools, definition)` derive annotations from `risk`, `_meta.securitySchemes` and the scope step-up from `scopes`, and run the handler through `runTool`. Pass a `defineMcpTool` result to `registerAppTool` for an MCP Apps tool.

`exposeErrorCodes` on `handleMcpRequest`, `runMcpTool()`, and `projectMcpToolError()` project a `ConvexError` whose `data.code` is allowlisted (plus `UNAUTHENTICATED`, `MCP_ACCESS_DENIED`, and `MCP_INSUFFICIENT_SCOPE`) as a structured tool error. Any other throw becomes one static failure. They are not a general authorization or SDK sanitizer.

`listMcpCatalog()` from `@lupinum/better-convex-mcp/test` returns the `tools/list` and `resources/list` results a client sees, for snapshot tests.

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

Read [MCP on Convex](https://better-convex.lupinum.com/docs/build/agents/mcp), [Connect ChatGPT and Claude](https://better-convex.lupinum.com/docs/build/agents/connect-chatgpt-and-claude), and the [delegated OAuth reference](https://better-convex.lupinum.com/docs/build/authentication/delegated-oauth-and-mcp).

## Support and security

Open a [GitHub issue](https://github.com/lupinum-dev/better-convex/issues) for support. Report vulnerabilities through the [private security process](https://github.com/lupinum-dev/better-convex/security/policy).

## License

This package uses the [MIT License](https://github.com/lupinum-dev/better-convex/blob/main/LICENSE).
