<p align="center"><img src="https://raw.githubusercontent.com/lupinum-dev/better-convex/main/docs/public/web-app-manifest-512x512.png" width="128" alt="Better Convex icon"></p>

<h1 align="center">@lupinum/better-convex-mcp</h1>

<p align="center">Serve a bounded, provider-neutral MCP endpoint from a Convex HTTP Action.</p>

> [!WARNING]
> This package is experimental beta software. Applications remain responsible for tools, roles, permissions, and effects.

## Purpose

Use this package when a Convex HTTP Action must handle MCP transport, request bounds, bearer challenges, and exact issuer and resource verification.

The package returns a credential-free access context. Every tool and resource must still reload and enforce current application authorization in Convex.

## Installation

```bash
pnpm add @lupinum/better-convex-mcp@0.1.0-beta.28 @modelcontextprotocol/server@2.0.0 zod@4.4.3
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

## Exports and requirements

The package requires Node.js 22.14 or newer. OAuth mode requires the documented transport and protected-resource metadata routes. Preconfigured bearer mode exposes only the transport routes.

`runMcpTool()` only converts unexpected throws inside a wrapped tool callback. It is not a general authorization or SDK sanitizer.

## Documentation

Read the [MCP and delegated OAuth guide](https://better-convex.lupinum.com/docs/build/authentication/delegated-oauth-and-mcp).

## Support, security, and license

Open a [GitHub issue](https://github.com/lupinum-dev/better-convex/issues) for support. Report vulnerabilities through the [private security process](https://github.com/lupinum-dev/better-convex/security/policy). This package uses the [MIT License](https://github.com/lupinum-dev/better-convex/blob/main/LICENSE).
