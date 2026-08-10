import { handleMcpRequest } from 'better-convex-mcp'
import { z } from 'zod'

const resource = new URL('https://packed-mcp.invalid/mcp')
const bearer = 'packed-mcp-bearer-sentinel'
const cookie = 'packed-mcp-cookie-sentinel'
const proxyCredential = 'packed-mcp-proxy-sentinel'
let callbackHeaders

const options = {
  resource,
  verifier: {
    async verifyAccessToken(token, expectedResource) {
      if (token !== bearer || expectedResource.href !== resource.href) throw new Error('denied')
      return {
        access: {
          clientId: 'packed-client',
          issuer: 'https://packed-mcp.invalid/issuer/',
          resource: resource.href,
          scopes: ['notes:read'],
          subject: 'packed-subject',
        },
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      }
    },
  },
  authorization: {
    issuer: 'https://packed-mcp.invalid/issuer/',
    mode: 'preconfigured-bearer',
  },
  serverInfo: { name: 'packed-proof', version: '0.0.0' },
  configureServer(_access, server) {
    server.registerTool('inspect_headers', { inputSchema: z.object({}) }, (_input, extra) => {
      callbackHeaders = Object.fromEntries(extra.http?.req?.headers ?? [])
      return {
        content: [{ text: 'Headers inspected.', type: 'text' }],
        structuredContent: { credentialFree: true },
      }
    })
  },
}

const response = await handleMcpRequest(
  new Request(resource, {
    body: JSON.stringify({
      id: 'packed-tool-call',
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        _meta: {
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': {
            name: 'packed-client',
            version: '0.0.0',
          },
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        },
        arguments: {},
        name: 'inspect_headers',
      },
    }),
    headers: {
      authorization: `Bearer ${bearer}`,
      cookie: `session=${cookie}`,
      'content-type': 'application/json',
      'mcp-method': 'tools/call',
      'mcp-name': 'inspect_headers',
      'mcp-protocol-version': '2026-07-28',
      'proxy-authorization': `Basic ${proxyCredential}`,
    },
    method: 'POST',
  }),
  options,
)

if (response.status !== 200) throw new Error(`Packed MCP request failed: ${response.status}`)
const body = await response.text()
if (!body.includes('"credentialFree":true')) throw new Error('Packed MCP tool did not execute.')
if (callbackHeaders === undefined) throw new Error('Packed MCP callback headers were not captured.')
for (const forbidden of ['authorization', 'cookie', 'proxy-authorization']) {
  if (Object.hasOwn(callbackHeaders, forbidden)) {
    throw new Error(`Packed MCP callback retained forbidden header: ${forbidden}`)
  }
}
for (const sentinel of [bearer, cookie, proxyCredential]) {
  if (body.includes(sentinel) || JSON.stringify(callbackHeaders).includes(sentinel)) {
    throw new Error('Packed MCP credential sentinel escaped the resource boundary.')
  }
}
