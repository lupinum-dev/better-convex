# better-convex-mcp

A small provider-neutral boundary for serving an official MCP server from a
Convex HTTP Action. It owns request bounds, exact issuer/resource verification,
bearer challenges, and a credential-free access context. Your application
continues to own tools, resources, roles, permissions, and effects.

## Install

```bash
pnpm add better-convex-mcp@0.1.0-beta.20 @modelcontextprotocol/server@2.0.0 zod@4.4.3
```

## Handle one request

```ts
import { handleMcpRequest } from 'better-convex-mcp'
import { z } from 'zod'

import { httpAction } from './_generated/server'

const resource = new URL('https://example.convex.site/mcp')
const issuer = 'https://example.convex.site/managed-credentials'
const credential = process.env.MCP_BEARER_TOKEN

if (!credential) throw new Error('MCP_BEARER_TOKEN is required')

export const handleMcp = httpAction(async (_ctx, request) =>
  handleMcpRequest(request, {
    resource,
    serverInfo: { name: 'example', version: '1.0.0' },
    authorization: {
      mode: 'preconfigured-bearer',
      issuer,
      verifier: {
        async verifyAccessToken(token, expected) {
          if (
            token !== credential ||
            expected.issuer !== issuer ||
            expected.resource.href !== resource.href
          ) {
            throw new Error('invalid credential')
          }
          return {
            access: {
              issuer,
              subject: 'managed-agent',
              clientId: 'managed-agent',
              resource: expected.resource.href,
              scopes: ['notes:read'],
            },
            expiresAt: Math.floor(Date.now() / 1_000) + 60,
          }
        },
      },
    },
    configureServer(access, server) {
      server.registerTool('whoami', { inputSchema: z.object({}) }, () => ({
        content: [{ type: 'text', text: `Authenticated as ${access.subject}` }],
      }))
    },
  }),
)
```

This is a complete preconfigured-credential example for a secret placed in the
MCP client out of band. Production OAuth uses the same request boundary with an
OAuth verifier and protected-resource metadata. In either mode, the verifier
receives the exact validated issuer and a request-local resource URL. It must
validate token class, issuer, resource/audience, client, subject, expiry,
scopes, and any live provider grant promised by the deployment. The returned
`McpAccessContext` contains no bearer token or provider-private data. Every
application effect must still reload and enforce current application
authorization in Convex.

OAuth mode requires explicit `POST`, `GET`, and `DELETE` routes for `/mcp`, plus
`GET` and `OPTIONS` routes for
`/.well-known/oauth-protected-resource/mcp`. Preconfigured-bearer mode exposes
only the three transport routes and no OAuth metadata.

`runMcpTool()` is a narrow opt-in wrapper for unexpected throws inside a tool
callback. It is not an SDK-wide sanitizer and cannot cover schema validation,
resources, prompts, or callbacks that bypass it.

Documentation: <https://better-convex-nuxt.vercel.app/docs/build/agents/mcp>
