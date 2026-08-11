import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { handleMcpRequest, type HandleMcpRequestOptions } from '../../packages/mcp/src/handler'
import type { McpAccessVerifier } from '../../packages/mcp/src/index'

const resource = new URL('https://lifecycle.example.test/mcp')
const bearer = 'request-lifecycle-bearer'

function verifier(): McpAccessVerifier {
  return {
    async verifyAccessToken(token, expected) {
      if (
        token !== bearer ||
        expected.issuer !== 'https://issuer.example.test/' ||
        expected.resource.href !== resource.href
      ) {
        throw new Error('invalid')
      }
      return {
        access: {
          issuer: 'https://issuer.example.test/',
          subject: 'subject-1',
          clientId: 'client-1',
          resource: resource.href,
          scopes: ['notes:read'],
        },
        expiresAt: Math.floor(Date.now() / 1_000) + 300,
      }
    },
  }
}

function toolsListRequest(id: string): Request {
  return new Request(resource, {
    body: JSON.stringify({
      id,
      jsonrpc: '2.0',
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': {
            name: 'request-lifecycle-test',
            version: '1.0.0',
          },
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        },
      },
    }),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'mcp-method': 'tools/list',
      'mcp-protocol-version': '2026-07-28',
    },
    method: 'POST',
  })
}

function options(
  configureServer: HandleMcpRequestOptions['configureServer'],
): HandleMcpRequestOptions {
  return {
    serverInfo: { name: 'request-lifecycle-test', version: '1.0.0' },
    resource,
    authorization: {
      mode: 'oauth',
      issuer: 'https://issuer.example.test/',
      verifier: verifier(),
    },
    configureServer,
  }
}

describe('request-scoped MCP lifecycle', () => {
  it('constructs a fresh configured server for every request and closes each exactly once', async () => {
    const servers = new Set<object>()
    const closeCounts: number[] = []
    const requestOptions = options((_access, server) => {
      servers.add(server)
      const index = closeCounts.push(0) - 1
      const onclose = server.server.onclose
      server.server.onclose = () => {
        closeCounts[index] = (closeCounts[index] ?? 0) + 1
        onclose?.()
      }
      server.registerTool('notes_list', { inputSchema: z.object({}) }, () => ({
        content: [{ type: 'text', text: 'ok' }],
      }))
    })

    const first = await handleMcpRequest(toolsListRequest('first'), requestOptions)
    const second = await handleMcpRequest(toolsListRequest('second'), requestOptions)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.text()).toContain('notes_list')
    expect(await second.text()).toContain('notes_list')
    expect(servers.size).toBe(2)
    expect(closeCounts).toEqual([1, 1])
  })

  it('closes a newly-created server exactly once when application configuration throws', async () => {
    let closeCount = 0
    const response = await handleMcpRequest(
      toolsListRequest('configuration-failure'),
      options((_access, server) => {
        const close = server.close.bind(server)
        server.close = async () => {
          closeCount += 1
          await close()
        }
        throw new Error('configuration-failure-sentinel')
      }),
    )

    expect(response.status).toBe(500)
    expect(closeCount).toBe(1)
    expect(await response.text()).not.toContain('configuration-failure-sentinel')
  })
})
