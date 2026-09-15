import { ProtocolError } from '@modelcontextprotocol/server'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { handleMcpRequest, type HandleMcpRequestOptions } from '../../packages/mcp/src/handler'

const resource = new URL('https://finite.example.test/mcp')
const bearer = 'synthetic-finite-bearer'
const version = '2026-07-28'

function fixture() {
  const invoked = vi.fn(() => ({ content: [{ type: 'text' as const, text: 'ok' }] }))
  const configureServer = vi.fn<HandleMcpRequestOptions['configureServer']>((_access, server) => {
    server.registerTool('read_note', { inputSchema: z.object({}) }, invoked)
    server.registerResource('note', 'note://example', {}, () => ({ contents: [] }))
  })
  const options: HandleMcpRequestOptions = {
    resource,
    serverInfo: { name: 'finite-profile-test', version: '1.0.0' },
    authorization: {
      mode: 'preconfigured-bearer',
      issuer: 'https://issuer.example.test/',
      verifier: {
        async verifyAccessToken(token) {
          if (token !== bearer) throw new Error('invalid')
          return {
            access: {
              issuer: 'https://issuer.example.test/',
              resource: resource.href,
              subject: 'subject',
              clientId: 'client',
              scopes: ['notes:read'],
            },
            expiresAt: Math.floor(Date.now() / 1_000) + 300,
          }
        },
      },
    },
    configureServer,
  }
  return { options, configureServer, invoked }
}

function request({
  method = 'subscriptions/listen',
  id = 'listen-1',
  headers = {},
  params = {},
  protocolVersion = version,
}: {
  method?: string
  id?: string | number
  headers?: Record<string, string>
  params?: Record<string, unknown>
  protocolVersion?: string
} = {}) {
  return new Request(resource, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'mcp-method': method,
      'mcp-protocol-version': protocolVersion,
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params: {
        notifications: { toolsListChanged: true },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': protocolVersion,
          'io.modelcontextprotocol/clientInfo': { name: 'finite-client', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
        ...params,
      },
    }),
  })
}

describe('finite MCP subscription boundary', () => {
  it.each(['listen-1', 42])(
    'rejects unavailable subscriptions with the correlated SDK method error (%s)',
    async (id) => {
      const f = fixture()
      const response = await handleMcpRequest(request({ id }), f.options)
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'Method not found' },
      })
      expect(f.invoked).not.toHaveBeenCalled()
    },
  )

  it('does not advertise subscription capabilities', async () => {
    const f = fixture()
    const response = await handleMcpRequest(request({ method: 'server/discover' }), f.options)
    const body = await response.json()
    expect(body.result.capabilities).toMatchObject({
      tools: { listChanged: false },
      resources: { listChanged: false, subscribe: false },
    })
    expect(body.result.capabilities).not.toHaveProperty('subscriptions')
  })

  it.each<Record<string, string>>([
    { 'mcp-protocol-version': '' },
    { 'mcp-protocol-version': '2025-11-25' },
    { 'mcp-method': '' },
    { 'mcp-method': 'tools/list' },
  ])('preserves SDK/header failures before unsupported-method handling (%j)', async (headers) => {
    const f = fixture()
    const response = await handleMcpRequest(request({ headers }), f.options)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ id: 'listen-1', error: { code: -32020 } })
    expect(f.configureServer).not.toHaveBeenCalled()
  })

  it('preserves the SDK unsupported-version response', async () => {
    const f = fixture()
    const response = await handleMcpRequest(request({ protocolVersion: '2099-01-01' }), f.options)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      id: 'listen-1',
      error: { data: { requested: '2099-01-01', supported: [version] } },
    })
    expect(f.configureServer).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid-json', -32700],
    ['batch', -32600],
    ['missing-meta', -32602],
  ] as const)('preserves the SDK %s rejection', async (fault, code) => {
    const f = fixture()
    const original = request()
    const body = await original.json()
    if (fault === 'missing-meta') delete body.params._meta
    const response = await handleMcpRequest(
      new Request(original, {
        body: fault === 'invalid-json' ? '{' : JSON.stringify(fault === 'batch' ? [body] : body),
      }),
      f.options,
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code } })
    expect(f.configureServer).not.toHaveBeenCalled()
  })

  it('preserves bearer and Origin rejection', async () => {
    const f = fixture()
    for (const [headers, status] of [
      [{ authorization: 'Bearer invalid' }, 401],
      [{ origin: 'https://hostile.example.test' }, 403],
    ] as const) {
      const response = await handleMcpRequest(request({ headers }), f.options)
      expect(response.status).toBe(status)
      expect(f.configureServer).not.toHaveBeenCalled()
    }
  })

  it('preserves SDK configuration failures instead of rewriting unrelated errors', async () => {
    const f = fixture()
    const response = await handleMcpRequest(request(), {
      ...f.options,
      configureServer() {
        throw new Error('unavailable configuration')
      },
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: { code: -32603, message: 'Internal server error' },
    })
  })

  it('preserves the same error when it comes from an ordinary application method', async () => {
    const f = fixture()
    const response = await handleMcpRequest(request({ method: 'tools/list' }), {
      ...f.options,
      configureServer(_access, server) {
        server.server.registerCapabilities({ tools: {} })
        server.server.setRequestHandler('tools/list', () => {
          throw new ProtocolError(-32603, 'Subscription limit reached')
        })
      },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      error: { code: -32603, message: 'Subscription limit reached' },
    })
  })
})
