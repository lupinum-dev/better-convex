import {
  handleMcpRequest,
  listMcpCatalog,
  type HandleMcpRequestOptions,
} from '@lupinum/better-convex-agents/mcp'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const resource = new URL('https://catalog.example.test/mcp')
const issuer = 'https://issuer.example.test/'
const bearer = 'catalog-bearer-sentinel'
const access = {
  issuer,
  subject: 'user-1',
  clientId: 'client-1',
  resource: resource.href,
  scopes: ['notes:read'],
}

describe('listMcpCatalog', () => {
  const toolCallback = vi.fn()
  const readCallback = vi.fn()
  const configureServer: HandleMcpRequestOptions<{ plan: 'free' | 'pro' }>['configureServer'] = ({
    principal,
    server,
    tools,
  }) => {
    for (let index = 0; index < 3; index += 1) {
      server.registerTool(
        `tool_${index}`,
        {
          description: `Tool ${index}`,
          inputSchema: z.object({ id: z.string().describe('Note id') }),
          annotations: { readOnlyHint: true },
          scopeChallenge: tools.requireScopes('notes:read'),
        },
        () => {
          toolCallback()
          return { content: [] }
        },
      )
    }
    if (principal.plan === 'pro') {
      server.registerResource(
        'card',
        'ui://notes/card.html',
        { mimeType: 'text/html;profile=mcp-app', description: 'Note card' },
        (uri) => {
          readCallback()
          return { contents: [{ uri: uri.href, text: '<p></p>' }] }
        },
      )
    }
  }

  it('matches exactly what an official client lists over the HTTP handler', async () => {
    const catalog = await listMcpCatalog({
      configureServer,
      access,
      principal: { plan: 'pro' },
      serverInfo: { name: 'catalog', version: '1.0.0' },
    })
    const options: HandleMcpRequestOptions<{ plan: 'free' | 'pro' }> = {
      resource,
      serverInfo: { name: 'catalog', version: '1.0.0' },
      authorization: {
        mode: 'oauth',
        issuer,
        verifier: {
          async verifyAccessToken() {
            return {
              access,
              principal: { plan: 'pro' },
              expiresAt: Math.floor(Date.now() / 1_000) + 300,
            }
          },
        },
      },
      configureServer,
    }
    const client = new Client(
      { name: 'catalog-client', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    const transport = new StreamableHTTPClientTransport(resource, {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
      fetch: (input, init) => handleMcpRequest(new Request(input, init), options),
    })
    try {
      await client.connect(transport)
      expect(catalog.tools).toEqual((await client.listTools()).tools)
      expect(catalog.resources).toEqual((await client.listResources()).resources)
    } finally {
      await client.close()
    }
    expect(catalog.tools.map((tool) => tool.name)).toEqual(['tool_0', 'tool_1', 'tool_2'])
    expect(catalog.resources).toEqual([
      {
        name: 'card',
        uri: 'ui://notes/card.html',
        mimeType: 'text/html;profile=mcp-app',
        description: 'Note card',
      },
    ])
    expect(toolCallback).not.toHaveBeenCalled()
    expect(readCallback).not.toHaveBeenCalled()
  })

  it('reflects the principal and returns no resources when none are registered', async () => {
    const catalog = await listMcpCatalog({ configureServer, access, principal: { plan: 'free' } })
    expect(catalog.tools).toHaveLength(3)
    expect(catalog.resources).toEqual([])
  })

  it('surfaces the same capability hardening failure as the request handler', async () => {
    await expect(
      listMcpCatalog({
        access,
        principal: undefined,
        configureServer({ server }) {
          server.registerPrompt('p', {}, () => ({ messages: [] }))
        },
      }),
    ).rejects.toThrow()
  })

  it('applies the production scope configuration', async () => {
    await expect(
      listMcpCatalog({
        configureServer,
        access,
        principal: { plan: 'free' },
        requiredScopes: ['notes:read'],
        scopesSupported: ['notes:read'],
      }),
    ).resolves.toMatchObject({
      tools: [{ name: 'tool_0' }, { name: 'tool_1' }, { name: 'tool_2' }],
    })
    await expect(
      listMcpCatalog({
        configureServer,
        access,
        principal: { plan: 'free' },
        scopesSupported: ['notes:write'],
      }),
    ).rejects.toThrow()
  })
})
