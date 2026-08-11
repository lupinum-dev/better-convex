import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

describe('official MCP and canonical application schema boundaries', () => {
  it('validates strict bounded input twice and projects only bounded public output', async () => {
    const edgeInput = z.object({ query: z.string().max(8) }).strict()
    const canonicalInput = z.object({ query: z.string().max(8) }).strict()
    const publicOutput = z.object({ matches: z.array(z.string().max(16)).max(2) }).strict()
    let applicationCalls = 0
    const applicationOperation = (input: unknown) => {
      applicationCalls += 1
      const { query } = canonicalInput.parse(input)
      const canonicalRow = {
        id: 'note-1',
        privateOwnerEmail: 'private-owner-sentinel@example.test',
        title: query,
      }
      return { matches: [canonicalRow.title] }
    }

    const server = new McpServer({ name: 'schema-proof', version: '0.1.0' })
    server.registerTool(
      'search_notes',
      { inputSchema: edgeInput, outputSchema: publicOutput },
      (input) => {
        const output = applicationOperation(input)
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        }
      },
    )
    const client = new Client({ name: 'schema-client', version: '0.1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const valid = await client.callTool({ name: 'search_notes', arguments: { query: 'alpha' } })
      expect(valid.structuredContent).toEqual({ matches: ['alpha'] })
      expect(JSON.stringify(valid)).not.toContain('private-owner-sentinel')
      expect(applicationCalls).toBe(1)

      for (const arguments_ of [
        { query: 'alpha', unknown: true },
        { query: 'a'.repeat(9) },
        { query: 7 },
      ]) {
        const denied = await client.callTool({ name: 'search_notes', arguments: arguments_ })
        expect(denied.isError).toBe(true)
        expect(JSON.stringify(denied)).not.toContain('a'.repeat(9))
      }
      expect(applicationCalls).toBe(1)

      expect(() => applicationOperation({ query: 'a'.repeat(9) })).toThrow()
      expect(() => applicationOperation({ query: 'alpha', unknown: true })).toThrow()
    } finally {
      await client.close()
      await server.close()
    }
  })

  it('rejects handler output that violates the declared public schema', async () => {
    const server = new McpServer({ name: 'output-schema-proof', version: '0.1.0' })
    server.registerTool(
      'invalid_output',
      {
        inputSchema: z.object({}).strict(),
        outputSchema: z.object({ value: z.string().max(8) }).strict(),
      },
      () => ({
        content: [{ type: 'text', text: 'must not escape' }],
        structuredContent: { value: 'a'.repeat(9) },
      }),
    )
    const client = new Client({ name: 'output-schema-client', version: '0.1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const denied = await client.callTool({ name: 'invalid_output', arguments: {} })
      expect(denied.isError).toBe(true)
      expect(JSON.stringify(denied)).not.toContain('must not escape')
      expect(JSON.stringify(denied)).not.toContain('a'.repeat(9))
    } finally {
      await client.close()
      await server.close()
    }
  })
})
