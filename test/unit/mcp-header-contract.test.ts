import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { SERVER_INFO_META_KEY } from '@modelcontextprotocol/server'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { handleMcpRequest, type HandleMcpRequestOptions } from '../../packages/mcp/src/handler'

const resource = new URL('https://notes.example.test/mcp')
const issuer = 'https://issuer.example.test/'
// Requirements: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#server-validation
const version = '2026-07-28'
const serverInfo = { name: 'header-contract-server', version: '1.0.0' }
const toolName = 'notes_ü_lookup'

async function fixture() {
  const invoked = vi.fn(() => ({
    content: [{ type: 'text' as const, text: 'Found the note.' }],
  }))
  const options: HandleMcpRequestOptions = {
    resource,
    serverInfo,
    authorization: {
      mode: 'preconfigured-bearer',
      issuer,
      verifier: {
        async verifyAccessToken(token) {
          if (token !== 'synthetic-header-token') throw new Error('invalid token')
          return {
            access: {
              issuer,
              resource: resource.href,
              subject: 'subject-1',
              clientId: 'client-1',
              scopes: ['notes:read'],
            },
            expiresAt: Math.floor(Date.now() / 1000) + 300,
          }
        },
      },
    },
    configureServer(_access, server) {
      server.registerTool(
        toolName,
        {
          inputSchema: z.object({
            region: z.string().meta({ 'x-mcp-header': 'Region' }),
          }),
        },
        invoked,
      )
    },
  }
  let captured: Request | undefined
  const client = new Client(
    { name: 'header-contract-client', version: '1.0.0' },
    {
      versionNegotiation: { mode: { pin: version } },
    },
  )
  const transport = new StreamableHTTPClientTransport(resource, {
    requestInit: {
      headers: { authorization: 'Bearer synthetic-header-token' },
    },
    async fetch(input, init) {
      const request = new Request(input, init)
      if (request.headers.get('mcp-method') === 'tools/call')
        captured = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: await request.clone().text(),
        })
      return handleMcpRequest(request, options)
    },
  })
  try {
    await client.connect(transport)
    const discovery = await client.listTools()
    expect(discovery.tools.map((tool) => tool.name)).toContain(toolName)
    const result = await client.callTool({
      name: toolName,
      arguments: { region: 'eu-west' },
    })
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'Found the note.' }],
    })
  } finally {
    await client.close()
  }
  if (!captured) throw new Error('SDK did not send tools/call')
  invoked.mockClear()
  return { request: captured, options, invoked }
}

describe('2026-07-28 HTTP metadata through the Better Convex boundary', () => {
  it('preserves SDK-encoded Unicode names, annotated routing parameters and result identity', async () => {
    const { request, options, invoked } = await fixture()
    expect(request.headers.get('mcp-name')).toBe(
      `=?base64?${Buffer.from(toolName).toString('base64')}?=`,
    )
    expect(request.headers.get('mcp-param-region')).toBe('eu-west')
    const response = await handleMcpRequest(request, options)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      result: { _meta: { [SERVER_INFO_META_KEY]: serverInfo } },
    })
    expect(invoked).toHaveBeenCalledOnce()
  })

  it.each([
    ['mcp-method', undefined],
    ['mcp-method', 'tools/list'],
    ['mcp-name', undefined],
    ['mcp-name', 'another_tool'],
    ['mcp-name', '=?base64?!invalid!?='],
    ['mcp-param-region', undefined],
    ['mcp-param-region', 'us-east'],
    ['mcp-protocol-version', undefined],
    ['mcp-protocol-version', ''],
    ['mcp-protocol-version', '2025-11-25'],
  ])('rejects %s = %s before the application callback', async (header, value) => {
    const { request, options, invoked } = await fixture()
    const originalBody = await request.clone().json()
    const headers = new Headers(request.headers)
    if (value === undefined) headers.delete(header)
    else headers.set(header, value)
    const response = await handleMcpRequest(new Request(request, { headers }), options)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ id: originalBody.id, error: { code: -32020 } })
    expect(invoked).not.toHaveBeenCalled()
  })

  it.each(['missing-meta', 'missing-capabilities', 'legacy-initialize', 'batch'])(
    'rejects %s without invoking the tool',
    async (fault) => {
      const { request, options, invoked } = await fixture()
      const body = await request.json()
      if (fault === 'missing-meta') delete body.params._meta
      if (fault === 'missing-capabilities')
        delete body.params._meta['io.modelcontextprotocol/clientCapabilities']
      if (fault === 'legacy-initialize') {
        body.method = 'initialize'
        body.params = {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'old-client', version: '1.0.0' },
        }
      }
      const response = await handleMcpRequest(
        new Request(resource, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(fault === 'batch' ? [body] : body),
        }),
        options,
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error')
      expect(invoked).not.toHaveBeenCalled()
    },
  )
})
