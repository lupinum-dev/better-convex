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

Use this package when a Convex HTTP Action must handle MCP transport, request bounds, bearer challenges, and exact issuer and resource verification.

The package returns a credential-free access context. Every tool and resource must still reload and enforce current application authorization in Convex.

## Requirements

The package requires Node.js `^22.19.0 || ^24.11.0`. OAuth mode requires the documented transport and protected-resource metadata routes. Preconfigured bearer mode exposes only the transport routes.

## Installation

```bash
pnpm add @lupinum/better-convex-mcp@1.0.0-beta.1 @modelcontextprotocol/server@2.0.0 zod@4.4.3
```

## Quick start

```ts
import { handleMcpRequest } from '@lupinum/better-convex-mcp'
import { httpAction } from './_generated/server'

export const handleMcp = httpAction(async (_ctx, request) =>
  handleMcpRequest(request, {
    resource: new URL('https://example.convex.site/mcp'),
    serverInfo: { name: 'example', version: '1.0.0' },
    authorization: {
      mode: 'preconfigured-bearer',
      issuer: 'https://example.convex.site/managed-credentials',
      verifier: {
        async verifyAccessToken(token, expected) {
          // Validate the token, issuer, resource, subject, expiry, and scopes.
          return {
            access: {
              issuer: expected.issuer,
              subject: 'managed-agent',
              clientId: 'managed-agent',
              resource: expected.resource.href,
              scopes: ['notes:read'],
            },
          }
        },
      },
    },
    configureServer(_access, server) {
      // Register the application's bounded tools and resources here.
    },
  }),
)
```

## Exports

`runMcpTool()` only converts unexpected throws inside a wrapped tool callback. It is not a general authorization or SDK sanitizer.

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

Read the [MCP and delegated OAuth guide](https://better-convex.lupinum.com/docs/build/authentication/delegated-oauth-and-mcp).

## Support and security

Open a [GitHub issue](https://github.com/lupinum-dev/better-convex/issues) for support. Report vulnerabilities through the [private security process](https://github.com/lupinum-dev/better-convex/security/policy).

## License

This package uses the [MIT License](https://github.com/lupinum-dev/better-convex/blob/main/LICENSE).
