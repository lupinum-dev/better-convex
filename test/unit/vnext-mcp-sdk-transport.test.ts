import {
  CLIENT_INFO_META_KEY,
  Client,
  SERVER_INFO_META_KEY,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { createMcpHandler, InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

describe('vNext MCP SDK transport laboratory', () => {
  it('uses the official SDK for discovery, a structured tool call, and a resource read', async () => {
    const server = new McpServer({ name: 'better-convex-vnext-lab', version: '0.0.0' })
    const client = new Client({ name: 'better-convex-vnext-lab-client', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    server.registerTool(
      'search_notes',
      {
        description: 'Search neutral notes in the topology laboratory.',
        inputSchema: z.object({ query: z.string().min(1) }),
        outputSchema: z.object({ matches: z.array(z.string()) }),
      },
      async ({ query }) => {
        const output = { matches: query === 'alpha' ? ['note-alpha'] : [] }
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        }
      },
    )

    server.registerResource(
      'note-alpha',
      'note://note-alpha',
      { description: 'A neutral note resource.', mimeType: 'application/json' },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ id: 'note-alpha', title: 'Alpha' }),
          },
        ],
      }),
    )

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name)).toContain('search_notes')

      const called = await client.callTool({
        name: 'search_notes',
        arguments: { query: 'alpha' },
      })
      expect(called.structuredContent).toEqual({ matches: ['note-alpha'] })

      const resource = await client.readResource({ uri: 'note://note-alpha' })
      expect(resource.contents).toEqual([
        {
          uri: 'note://note-alpha',
          mimeType: 'application/json',
          text: JSON.stringify({ id: 'note-alpha', title: 'Alpha' }),
        },
      ])
    } finally {
      await client.close()
      await server.close()
    }
  })

  it('matches the stable 2026 result identity and optional client-info envelope', async () => {
    const serverInfo = { name: 'better-convex-vnext-modern-lab', version: '0.0.0' }
    const handler = createMcpHandler(
      () => {
        const server = new McpServer(serverInfo)
        server.registerTool(
          'search_notes',
          { inputSchema: z.object({ query: z.string() }) },
          () => ({
            content: [{ type: 'text', text: 'No notes matched.' }],
          }),
        )
        server.registerResource('note-alpha', 'note://note-alpha', {}, async (uri) => ({
          contents: [{ mimeType: 'text/plain', text: 'Alpha', uri: uri.href }],
        }))
        return server
      },
      { legacy: 'reject', responseMode: 'json' },
    )
    const exchanges: Array<{
      request: Record<string, unknown>
      requestHeaders: Headers
      response: Record<string, unknown>
    }> = []
    const transport = new StreamableHTTPClientTransport(new URL('https://mcp-lab.invalid/mcp'), {
      fetch: async (input, init) => {
        const request = new Request(input, init)
        const requestBody = JSON.parse(await request.clone().text()) as Record<string, unknown>
        const response = await handler.fetch(request)
        exchanges.push({
          request: requestBody,
          requestHeaders: new Headers(request.headers),
          response: (await response.clone().json()) as Record<string, unknown>,
        })
        return response
      },
    })
    const client = new Client(
      { name: 'better-convex-vnext-modern-client', version: '0.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )

    try {
      await client.connect(transport)
      await client.listTools()
      await client.callTool({ arguments: { query: 'alpha' }, name: 'search_notes' })
      await client.readResource({ uri: 'note://note-alpha' })

      const discover = exchanges.find(({ request }) => request.method === 'server/discover')
      const toolsList = exchanges.find(({ request }) => request.method === 'tools/list')
      expect(discover).toBeDefined()
      expect(toolsList).toBeDefined()
      expect(exchanges.map(({ request }) => request.method)).toEqual([
        'server/discover',
        'tools/list',
        'tools/call',
        'resources/read',
      ])
      for (const exchange of exchanges) {
        const result = exchange.response.result as Record<string, unknown>
        expect(result.serverInfo).toBeUndefined()
        expect((result._meta as Record<string, unknown>)[SERVER_INFO_META_KEY]).toEqual(serverInfo)
      }

      const requestWithoutClientInfo = structuredClone(toolsList!.request)
      const params = requestWithoutClientInfo.params as Record<string, unknown>
      const meta = params._meta as Record<string, unknown>
      Reflect.deleteProperty(meta, CLIENT_INFO_META_KEY)
      const directResponse = await handler.fetch(
        new Request('https://mcp-lab.invalid/mcp', {
          method: 'POST',
          headers: toolsList!.requestHeaders,
          body: JSON.stringify(requestWithoutClientInfo),
        }),
      )
      const directBody = (await directResponse.json()) as {
        error?: unknown
        result?: { tools?: unknown[]; _meta?: Record<string, unknown> }
      }
      expect(directResponse.status).toBe(200)
      expect(directBody.error).toBeUndefined()
      expect(directBody.result?.tools).toHaveLength(1)
      expect(directBody.result?._meta?.[SERVER_INFO_META_KEY]).toEqual(serverInfo)
    } finally {
      await client.close()
      await handler.close()
    }
  })
})
