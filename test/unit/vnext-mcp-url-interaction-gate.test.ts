import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import {
  createMcpHandler,
  McpServer,
  ProtocolErrorCode,
  UrlElicitationRequiredError,
  type McpRequestContext,
} from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const ELICITATION_ID = '65b14f1d-897b-4df9-8755-1146b2190c86'
const INTERACTION_URL =
  'https://notes.example.invalid/interactions/0d13e3cf62574c27a0c8093e45ea46b4'

interface ConnectedClient {
  readonly client: Client
  readonly requestBodies: string[]
}

function createInteractionServer(): McpServer {
  const server = new McpServer({
    name: 'url-interaction-gate-lab',
    version: '0.0.0',
  })
  server.registerTool(
    'request_workspace_deletion',
    {
      inputSchema: z.object({ workspaceId: z.string() }).strict(),
    },
    async () => {
      throw new UrlElicitationRequiredError([
        {
          elicitationId: ELICITATION_ID,
          message: 'Review this workspace deletion in the notes application.',
          mode: 'url',
          url: INTERACTION_URL,
        },
      ])
    },
  )
  return server
}

async function connectClient(
  handler: ReturnType<typeof createMcpHandler>,
  supportsUrlElicitation: boolean,
): Promise<ConnectedClient> {
  const requestBodies: string[] = []
  const transport = new StreamableHTTPClientTransport(new URL('https://mcp-lab.invalid/mcp'), {
    fetch: async (input, init) => {
      const request = new Request(input, init)
      requestBodies.push(await request.clone().text())
      return handler.fetch(request)
    },
  })
  const client = new Client(
    {
      name: supportsUrlElicitation ? 'url-capable-client' : 'url-incapable-client',
      version: '0.0.0',
    },
    {
      capabilities: supportsUrlElicitation ? { elicitation: { url: {} } } : {},
    },
  )
  await client.connect(transport)
  return { client, requestBodies }
}

function parseRequests(requestBodies: string[]): Array<Record<string, unknown>> {
  return requestBodies
    .filter((body) => body.length > 0)
    .map((body) => JSON.parse(body) as Record<string, unknown>)
}

describe('vNext published URL-interaction capability gate', () => {
  it('proves 2025 stateless serving cannot distinguish capable and incapable clients', async () => {
    const factoryContexts: McpRequestContext[] = []
    const handler = createMcpHandler(
      (context) => {
        factoryContexts.push(context)
        return createInteractionServer()
      },
      { legacy: 'stateless', responseMode: 'json' },
    )
    const capable = await connectClient(handler, true)
    const incapable = await connectClient(handler, false)

    try {
      const call = {
        arguments: { workspaceId: 'workspace-a' },
        name: 'request_workspace_deletion',
      }
      const outcomes = await Promise.allSettled([
        capable.client.callTool(call),
        incapable.client.callTool(call),
      ])

      for (const outcome of outcomes) {
        expect(outcome.status).toBe('rejected')
        if (outcome.status !== 'rejected') continue
        expect(outcome.reason).toBeInstanceOf(UrlElicitationRequiredError)
        expect(outcome.reason).toMatchObject({
          code: ProtocolErrorCode.UrlElicitationRequired,
          elicitations: [
            {
              elicitationId: ELICITATION_ID,
              mode: 'url',
              url: INTERACTION_URL,
            },
          ],
        })
      }

      const capableRequests = parseRequests(capable.requestBodies)
      const incapableRequests = parseRequests(incapable.requestBodies)
      expect(capableRequests[0]).toMatchObject({
        method: 'initialize',
        params: { capabilities: { elicitation: { url: {} } } },
      })
      expect(incapableRequests[0]).toMatchObject({
        method: 'initialize',
        params: { capabilities: {} },
      })

      const capableToolCall = capableRequests.find((request) => request.method === 'tools/call')
      const incapableToolCall = incapableRequests.find((request) => request.method === 'tools/call')
      expect(capableToolCall).toEqual(incapableToolCall)
      expect(factoryContexts).toHaveLength(capableRequests.length + incapableRequests.length)
      expect(factoryContexts.every((context) => context.era === 'legacy')).toBe(true)
      expect(factoryContexts.every((context) => !('clientCapabilities' in context))).toBe(true)
    } finally {
      await Promise.allSettled([capable.client.close(), incapable.client.close()])
      await handler.close()
    }
  })
})
