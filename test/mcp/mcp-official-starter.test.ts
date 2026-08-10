import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'

import { handleMcpRequest, type HandleMcpRequestOptions } from '../../packages/mcp/src/handler'
import { createDelegatedMcpServer } from '../../starters/mcp-oauth-agent/convex/mcp'
import { isMcpScope } from '../../starters/mcp-oauth-agent/convex/mcp/scopes'

const resource = new URL('https://starter.example.test/mcp')
const issuer = 'https://starter.example.test/credentials/'
const bearer = 'delegated-starter-bearer-must-not-escape'

describe('delegated OAuth starter official MCP composition', () => {
  it('lists the exact catalog and maps one tool without bearer passthrough', async () => {
    const calls: unknown[] = []
    const application = {
      async runMutation(_reference: unknown, args: unknown) {
        calls.push(args)
        return [{ id: 'project-1', name: 'Example' }]
      },
    }
    const requestOptions = {
      serverInfo: {
        name: 'better-convex-nuxt-mcp-oauth-agent',
        version: '0.1.0',
      },
      resource,
      authorization: {
        mode: 'preconfigured-bearer',
        issuer,
        verifier: {
          async verifyAccessToken(token, expected) {
            if (
              token !== bearer ||
              expected.issuer !== issuer ||
              expected.resource.href !== resource.href
            ) {
              throw new Error('invalid')
            }
            return {
              access: {
                clientId: 'client-1',
                issuer,
                resource: resource.href,
                scopes: ['mcp:read', 'mcp:write'],
                subject: 'user-1',
              },
              expiresAt: Math.floor(Date.now() / 1_000) + 300,
            }
          },
        },
      },
      configureServer(access, server) {
        createDelegatedMcpServer(
          application as never,
          access,
          {
            clientId: access.clientId,
            issuer: access.issuer,
            resource: access.resource,
            scopes: access.scopes.filter(isMcpScope),
            sessionId: 'session-1',
            subject: access.subject,
          },
          server,
        )
      },
    } satisfies HandleMcpRequestOptions
    const responseBodies: string[] = []
    const transport = new StreamableHTTPClientTransport(resource, {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
      fetch: async (input, init) => {
        const response = await handleMcpRequest(new Request(input, init), requestOptions)
        responseBodies.push(await response.clone().text())
        return response
      },
    })
    const client = new Client(
      { name: 'delegated-starter-proof', version: '1' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )

    try {
      await client.connect(transport)
      expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
        'projects.list',
        'projects.create',
        'projects.delete.preview',
        'projects.delete.requestApproval',
        'projects.delete.execute',
      ])
      const result = await client.callTool({
        arguments: { organizationId: 'organization-1' },
        name: 'projects.list',
      })
      expect(result).toMatchObject({
        structuredContent: [{ id: 'project-1', name: 'Example' }],
      })
      expect(result.isError).not.toBe(true)
      expect(calls).toEqual([
        {
          organizationId: 'organization-1',
          principal: {
            clientId: 'client-1',
            issuer,
            resource: resource.href,
            scopes: ['mcp:read', 'mcp:write'],
            sessionId: 'session-1',
            subject: 'user-1',
          },
        },
      ])
      expect(JSON.stringify({ calls, responseBodies })).not.toContain(bearer)
    } finally {
      await client.close()
    }
  })
})
