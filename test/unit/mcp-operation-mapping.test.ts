import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createConvexMcpHandler } from '../../packages/mcp/src/handler'
import type { McpAccessVerifier } from '../../packages/mcp/src/index'

const resource = new URL('https://mapping.example.test/mcp')
const bearer = 'mapping-bearer-sentinel'
const searchNotesReference = Object.freeze({
  kind: 'query',
  name: 'notes:search',
})
const renameNoteReference = Object.freeze({
  kind: 'mutation',
  name: 'notes:rename',
})
const oauthMetadata = {
  authorization_endpoint: 'https://issuer.example.test/authorize',
  code_challenge_methods_supported: ['S256'],
  grant_types_supported: ['authorization_code'],
  issuer: 'https://issuer.example.test/',
  response_types_supported: ['code'],
  token_endpoint: 'https://issuer.example.test/token',
  token_endpoint_auth_methods_supported: ['none'],
}

const verifier: McpAccessVerifier = {
  async verifyAccessToken(token, expectedResource) {
    if (token !== bearer || expectedResource.href !== resource.href) throw new Error('invalid')
    return {
      access: {
        issuer: oauthMetadata.issuer,
        subject: 'member-123',
        clientId: 'client-123',
        resource: resource.href,
        scopes: ['notes:read', 'notes:write'],
      },
      expiresAt: Math.floor(Date.now() / 1_000) + 300,
    }
  },
}

describe('MCP explicit Convex operation mapping', () => {
  it('binds each tool to one fixed operation kind and generated reference', async () => {
    const calls: Array<{
      kind: 'query' | 'mutation'
      reference: unknown
      args: unknown
    }> = []
    const application = {
      async runQuery(reference: unknown, args: unknown) {
        calls.push({ kind: 'query', reference, args })
        return { titles: ['Alpha'] }
      },
      async runMutation(reference: unknown, args: unknown) {
        calls.push({ kind: 'mutation', reference, args })
        return { id: 'note-1', title: 'Beta' }
      },
    }
    const handler = createConvexMcpHandler<typeof application>({
      serverInfo: { name: 'mapping-proof', version: '0.1.0' },
      resource,
      verifier,
      authorization: { mode: 'oauth', metadata: oauthMetadata },
      configureServer(context, access, server) {
        server.registerTool(
          'search_notes',
          {
            inputSchema: z.object({ query: z.string() }).strict(),
            outputSchema: z.object({ titles: z.array(z.string()) }).strict(),
          },
          async (input) => {
            const output = await context.runQuery(searchNotesReference, {
              actor: { issuer: access.issuer, subject: access.subject },
              input,
            })
            return {
              content: [{ type: 'text', text: `${output.titles.length} note matched.` }],
              structuredContent: output,
            }
          },
        )
        server.registerTool(
          'rename_note',
          {
            inputSchema: z.object({ id: z.string(), title: z.string() }).strict(),
            outputSchema: z.object({ id: z.string(), title: z.string() }).strict(),
          },
          async (input) => {
            const output = await context.runMutation(renameNoteReference, {
              actor: { issuer: access.issuer, subject: access.subject },
              input,
            })
            return {
              content: [{ type: 'text', text: `Renamed ${output.id}.` }],
              structuredContent: output,
            }
          },
        )
      },
    })
    const transport = new StreamableHTTPClientTransport(resource, {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
      fetch: (input, init) => handler.fetch(application, new Request(input, init)),
    })
    const client = new Client(
      { name: 'mapping-client', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )

    try {
      await client.connect(transport)

      const search = await client.callTool({
        name: 'search_notes',
        arguments: { query: 'alpha' },
      })
      expect(search.isError).not.toBe(true)
      expect(calls).toEqual([
        {
          kind: 'query',
          reference: searchNotesReference,
          args: {
            actor: { issuer: oauthMetadata.issuer, subject: 'member-123' },
            input: { query: 'alpha' },
          },
        },
      ])

      const substituted = await client.callTool({
        name: 'search_notes',
        arguments: {
          query: 'alpha',
          operation: 'mutation',
          functionName: 'notes:rename',
        },
      })
      expect(substituted.isError).toBe(true)
      expect(calls).toHaveLength(1)

      await expect(client.callTool({ name: 'notes:rename', arguments: {} })).rejects.toThrow(
        'Tool notes:rename not found',
      )
      expect(calls).toHaveLength(1)

      const rename = await client.callTool({
        name: 'rename_note',
        arguments: { id: 'note-1', title: 'Beta' },
      })
      expect(rename.isError).not.toBe(true)
      expect(calls[1]).toEqual({
        kind: 'mutation',
        reference: renameNoteReference,
        args: {
          actor: { issuer: oauthMetadata.issuer, subject: 'member-123' },
          input: { id: 'note-1', title: 'Beta' },
        },
      })
    } finally {
      await client.close()
    }
  })
})
