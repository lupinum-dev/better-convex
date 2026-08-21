import { describe, expect, it } from 'vitest'

import { handleMcpRequest } from '../../packages/mcp/src/handler'
import type { McpAccessVerifier } from '../../packages/mcp/src/index'

const bearer = 'mcp-routing-bearer-sentinel'
const issuer = 'https://issuer.example.test/'
const resource = new URL('https://notes.example.test/mcp')

describe('MCP request routing', () => {
  it('routes one optional trailing slash while preserving the configured resource identity', async () => {
    let verifiedResource: string | undefined
    const verifier: McpAccessVerifier = {
      async verifyAccessToken(token, expected) {
        expect(token).toBe(bearer)
        verifiedResource = expected.resource.href
        return {
          access: {
            clientId: 'client-123',
            issuer,
            resource: resource.href,
            scopes: ['notes:read'],
            subject: 'integration-123',
          },
          expiresAt: Math.floor(Date.now() / 1_000) + 300,
        }
      },
    }

    const response = await handleMcpRequest(
      new Request('https://notes.example.test/mcp/', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
        },
        body: '{}',
      }),
      {
        authorization: { issuer, mode: 'oauth', verifier },
        configureServer(_access, server) {
          void server
        },
        resource,
        serverInfo: { name: 'mcp-routing-test', version: '0.1.0' },
      },
    )

    expect(response.status).not.toBe(404)
    expect(verifiedResource).toBe(resource.href)
  })
})
