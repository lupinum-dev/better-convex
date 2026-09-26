import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { McpServer } from '@modelcontextprotocol/server'
import { ConvexError } from 'convex/values'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { defineMcpTool, registerMcpTool } from '../../packages/mcp/src/define'
import { handleMcpRequest, type HandleMcpRequestOptions } from '../../packages/mcp/src/handler'
import type { McpAccessContext } from '../../packages/mcp/src/index'
import { listMcpCatalog } from '../../packages/mcp/src/test'

const resource = new URL('https://define-tool.example.test/mcp')
const resourceMetadata = 'https://define-tool.example.test/.well-known/oauth-protected-resource/mcp'
const issuer = 'https://issuer.example.test/'
const bearer = 'define-tool-bearer-sentinel'

interface Principal {
  readonly userId: string
}

const access = (scopes: readonly string[]): McpAccessContext => ({
  issuer,
  subject: 'user-1',
  clientId: 'client-1',
  resource: resource.href,
  scopes,
})

const noteOutput = z.object({ id: z.string(), title: z.string() })

/** The exact runtime behaviour of `registerAppTool` from `@modelcontextprotocol/ext-apps` 2.0. */
function registerAppToolLike(
  server: Pick<McpServer, 'registerTool'>,
  name: string,
  config: { _meta: Record<string, unknown> },
  handler: unknown,
) {
  const meta = config._meta
  const ui = meta.ui as { resourceUri?: string } | undefined
  const legacy = meta['ui/resourceUri']
  let normalized = meta
  if (ui?.resourceUri && !legacy) normalized = { ...meta, 'ui/resourceUri': ui.resourceUri }
  else if (legacy && !ui?.resourceUri) normalized = { ...meta, ui: { ...ui, resourceUri: legacy } }
  return (server.registerTool as (...args: unknown[]) => unknown)(
    name,
    { ...config, _meta: normalized },
    handler,
  )
}

const effects = { writes: 0 }

const configureServer: HandleMcpRequestOptions<Principal>['configureServer'] = ({
  principal,
  server,
  tools,
}) => {
  registerMcpTool(server, tools, {
    name: 'get_note',
    title: 'Read a note',
    description: 'Read one note.',
    risk: 'read',
    scopes: ['notes:read'],
    inputSchema: z.object({ id: z.string() }),
    outputSchema: noteOutput,
    handler: ({ id }) => ({ structuredContent: { id, title: `Note for ${principal.userId}` } }),
  })
  registerMcpTool(server, tools, {
    name: 'rename_note',
    description: 'Rename one note.',
    risk: 'write',
    idempotent: true,
    scopes: ['notes:read', 'notes:write'],
    inputSchema: z.object({ id: z.string(), title: z.string() }),
    handler: ({ id, title }) => {
      effects.writes += 1
      if (id === 'missing')
        throw new ConvexError({ code: 'NOTE_NOT_FOUND', message: 'No such note.' })
      if (id === 'hidden') throw new ConvexError({ code: 'INTERNAL_SENTINEL', message: 'secret' })
      if (id === 'revoked') {
        throw new ConvexError({ code: 'MCP_ACCESS_DENIED', message: 'Access was revoked.' })
      }
      return { content: [{ type: 'text', text: `Renamed to ${title}` }] }
    },
  })
  const show = defineMcpTool(tools, {
    name: 'show_note',
    description: 'Show a note card.',
    risk: 'destructive',
    openWorld: true,
    ui: { resourceUri: 'ui://notes/card.html' },
    _meta: { 'example/flag': true },
    inputSchema: z.object({}),
    handler: () => ({ content: [{ type: 'text', text: 'shown' }] }),
  })
  registerAppToolLike(server, show.name, show.config, show.handler)
}

function connect(scopes: readonly string[], onToolError = vi.fn()) {
  const options: HandleMcpRequestOptions<Principal> = {
    resource,
    serverInfo: { name: 'define-tool', version: '1.0.0' },
    exposeErrorCodes: ['NOTE_NOT_FOUND'],
    onToolError,
    authorization: {
      mode: 'oauth',
      issuer,
      requiredScopes: ['notes:read'],
      scopesSupported: ['notes:read', 'notes:write'],
      verifier: {
        async verifyAccessToken(token) {
          if (token !== bearer) throw new Error('invalid')
          return {
            access: access(scopes),
            principal: { userId: 'user-1' },
            expiresAt: Math.floor(Date.now() / 1_000) + 300,
          }
        },
      },
    },
    configureServer,
  }
  const responses: Response[] = []
  const transport = new StreamableHTTPClientTransport(resource, {
    requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    fetch: async (input, init) => {
      const response = await handleMcpRequest(new Request(input, init), options)
      responses.push(response.clone())
      return response
    },
  })
  const client = new Client(
    { name: 'define-tool-client', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  )
  return { client, transport, responses, onToolError }
}

describe('defineMcpTool', () => {
  it('derives annotations, security schemes and UI metadata visible in tools/list', async () => {
    const catalog = await listMcpCatalog({
      configureServer,
      access: access(['notes:read']),
      principal: { userId: 'user-1' },
      serverInfo: { name: 'define-tool', version: '1.0.0' },
    })
    expect(catalog.resources).toEqual([])
    expect(catalog.tools.map((tool) => tool.name)).toEqual(['get_note', 'rename_note', 'show_note'])
    const [read, write, destructive] = catalog.tools
    expect(read).toMatchObject({
      title: 'Read a note',
      description: 'Read one note.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['notes:read'] }] },
      outputSchema: { type: 'object', required: ['id', 'title'] },
    })
    expect(write!.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(write!._meta).toEqual({
      securitySchemes: [{ type: 'oauth2', scopes: ['notes:read', 'notes:write'] }],
    })
    expect(destructive!.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(destructive!._meta).toEqual({
      'example/flag': true,
      ui: { resourceUri: 'ui://notes/card.html' },
      'ui/resourceUri': 'ui://notes/card.html',
    })
  })

  it('fills text content from structured output and keeps tools/list unfiltered by scope', async () => {
    const { client, transport } = connect(['notes:read'])
    try {
      await client.connect(transport)
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name)).toContain('rename_note')
      const result = await client.callTool({ name: 'get_note', arguments: { id: 'n1' } })
      expect(result).toMatchObject({
        structuredContent: { id: 'n1', title: 'Note for user-1' },
        content: [{ type: 'text', text: JSON.stringify({ id: 'n1', title: 'Note for user-1' }) }],
      })
    } finally {
      await client.close()
    }
  })

  it('challenges for missing scopes before the handler runs', async () => {
    effects.writes = 0
    const { client, transport, responses } = connect(['notes:read'])
    try {
      await client.connect(transport)
      await expect(
        client.callTool({ name: 'rename_note', arguments: { id: 'n1', title: 'x' } }),
      ).rejects.toThrow()
    } finally {
      await client.close()
    }
    const challenge = responses.at(-1)!
    expect(challenge.status).toBe(403)
    expect(challenge.headers.get('www-authenticate')).toBe(
      `Bearer error="insufficient_scope", error_description="Insufficient scope", scope="notes:read notes:write", resource_metadata="${resourceMetadata}"`,
    )
    expect(effects.writes).toBe(0)
  })

  it('projects allowlisted and built-in ConvexError codes and hides everything else', async () => {
    const { client, transport, onToolError } = connect(['notes:read', 'notes:write'])
    try {
      await client.connect(transport)
      await expect(
        client.callTool({ name: 'rename_note', arguments: { id: 'missing', title: 'x' } }),
      ).resolves.toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'No such note.' }],
        structuredContent: {
          error: { code: 'NOTE_NOT_FOUND', message: 'No such note.', retryable: false },
        },
      })
      await expect(
        client.callTool({ name: 'rename_note', arguments: { id: 'revoked', title: 'x' } }),
      ).resolves.toMatchObject({
        isError: true,
        structuredContent: { error: { code: 'MCP_ACCESS_DENIED' } },
      })
      const hidden = await client.callTool({
        name: 'rename_note',
        arguments: { id: 'hidden', title: 'x' },
      })
      expect(hidden).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'Tool execution failed' }],
      })
      expect(hidden).not.toHaveProperty('structuredContent')
      expect(JSON.stringify(hidden)).not.toContain('secret')
      await expect(client.callTool({ name: 'show_note', arguments: {} })).resolves.toMatchObject({
        content: [{ type: 'text', text: 'shown' }],
      })
    } finally {
      await client.close()
    }
    expect(onToolError.mock.calls.map(([metadata]) => metadata)).toEqual([
      { kind: 'tool', name: 'rename_note', code: 'NOTE_NOT_FOUND' },
      { kind: 'tool', name: 'rename_note', code: 'MCP_ACCESS_DENIED' },
      { kind: 'tool', name: 'rename_note' },
    ])
  })

  it('rejects an unknown risk and a scope that discovery does not advertise', async () => {
    const tools = {
      runTool: vi.fn(),
      requireScopes: vi.fn(() => {
        throw new TypeError('MCP scope challenges must be advertised as supported')
      }),
    }
    const base = {
      name: 'x',
      description: 'x',
      inputSchema: z.object({}),
      handler: () => ({ content: [] }),
    }
    expect(() => defineMcpTool(tools, { ...base, risk: 'unknown' as 'read' })).toThrow(
      'Invalid MCP tool risk',
    )
    expect(() => defineMcpTool(tools, { ...base, risk: 'read', scopes: ['admin'] })).toThrow(
      'advertised',
    )
  })

  it('rejects invalid exposed error codes at configuration time', async () => {
    await expect(
      handleMcpRequest(new Request(resource, { method: 'POST' }), {
        resource,
        serverInfo: { name: 'define-tool', version: '1.0.0' },
        exposeErrorCodes: ['not a code'],
        authorization: {
          mode: 'oauth',
          issuer,
          verifier: {
            async verifyAccessToken() {
              throw new Error('unused')
            },
          },
        },
        configureServer() {},
      }),
    ).rejects.toThrow('Invalid MCP exposed error code')
  })
})
