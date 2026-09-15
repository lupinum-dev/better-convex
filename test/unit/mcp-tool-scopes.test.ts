import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { handleMcpRequest, type HandleMcpRequestOptions } from '../../packages/mcp/src/handler'

const resource = new URL('https://tool-scopes.example.test/mcp')
const issuer = 'https://issuer.example.test/'
const bearer = 'tool-scope-test-bearer'
const supported = ['notes:read', 'notes:write', 'notes:issue']

function harness(scopes: readonly string[] = ['notes:read']) {
  const operation = vi.fn(() => ({
    content: [{ type: 'text' as const, text: 'done' }],
  }))
  const configureServer = vi.fn<HandleMcpRequestOptions['configureServer']>((_access, server) => {
    server.registerTool('read_note', { inputSchema: z.object({}) }, operation)
    server.registerTool('write_note', { inputSchema: z.object({}) }, operation)
  })
  const options: HandleMcpRequestOptions = {
    resource,
    serverInfo: { name: 'tool-scopes', version: '1.0.0' },
    authorization: {
      mode: 'oauth',
      issuer,
      scopesSupported: supported,
      requiredScopes: ['notes:read'],
      verifier: {
        async verifyAccessToken(token) {
          if (token !== bearer) throw new Error('invalid token')
          return {
            access: {
              issuer,
              resource: resource.href,
              subject: 'user-1',
              clientId: 'client-1',
              scopes,
            },
            expiresAt: Math.floor(Date.now() / 1_000) + 300,
          }
        },
      },
    },
    requiredToolScopes: { write_note: ['notes:write'] },
    configureServer,
  }
  const exchanges: Array<{ request: Request; response: Response }> = []
  const transport = new StreamableHTTPClientTransport(resource, {
    requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    fetch: async (input, init) => {
      const request = new Request(input, init)
      const saved = request.clone()
      const response = await handleMcpRequest(request, options)
      exchanges.push({ request: saved, response: response.clone() })
      return response
    },
  })
  const client = new Client(
    { name: 'tool-scope-client', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  )
  return { options, operation, configureServer, exchanges, client, transport }
}

async function sdkCall(h: ReturnType<typeof harness>, name = 'write_note') {
  await h.client.connect(h.transport)
  h.configureServer.mockClear()
  h.operation.mockClear()
  try {
    return await h.client.callTool({ name, arguments: {} })
  } finally {
    await h.client.close()
  }
}

async function capturedCall(): Promise<Request> {
  const h = harness(supported)
  await sdkCall(h)
  const exchange = h.exchanges.find(
    ({ request }) => request.headers.get('mcp-method') === 'tools/call',
  )
  if (!exchange) throw new Error('Official SDK did not send tools/call')
  // The client aborts its transport signal on close. Reuse its wire bytes with a fresh signal.
  return new Request(resource, {
    method: 'POST',
    headers: exchange.request.headers,
    body: await exchange.request.text(),
  })
}

function challengeScopes(response: Response): string[] {
  return (
    response.headers
      .get('www-authenticate')
      ?.match(/(?:^|[ ,])scope="([^"]*)"/)?.[1]
      ?.split(' ') ?? []
  )
}

describe('per-tool MCP scope challenges', () => {
  it('challenges an official SDK call before configuration or the operation and keeps global scopes', async () => {
    const h = harness()
    await expect(sdkCall(h)).rejects.toThrow()
    const response = h.exchanges.at(-1)!.response
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: 'insufficient_scope',
    })
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://tool-scopes.example.test/.well-known/oauth-protected-resource/mcp"',
    )
    expect(challengeScopes(response).sort()).toEqual(['notes:read', 'notes:write'])
    expect(h.configureServer).not.toHaveBeenCalled()
    expect(h.operation).not.toHaveBeenCalled()
  })

  it('dispatches once with sufficient scopes and leaves unprotected tools usable', async () => {
    for (const [scopes, name] of [
      [supported, 'write_note'],
      [['notes:read'], 'read_note'],
    ] as const) {
      const h = harness(scopes)
      await expect(sdkCall(h, name)).resolves.toMatchObject({
        content: [{ text: 'done' }],
      })
      expect(h.operation).toHaveBeenCalledOnce()
      expect(h.exchanges.at(-1)!.response.headers.get('www-authenticate')).toBeNull()
    }
  })

  it('leaves discovery visible to read-only callers without executing tools', async () => {
    const h = harness()
    try {
      await h.client.connect(h.transport)
      expect((await h.client.listTools()).tools.map(({ name }) => name).sort()).toEqual([
        'read_note',
        'write_note',
      ])
      expect(h.operation).not.toHaveBeenCalled()
      const response = await handleMcpRequest(
        new Request('https://tool-scopes.example.test/.well-known/oauth-protected-resource/mcp'),
        h.options,
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        scopes_supported: supported.toSorted(),
      })
    } finally {
      await h.client.close()
    }
  })

  it('requires every additional scope, without duplicating global scopes', async () => {
    const h = harness(['notes:read', 'notes:write'])
    h.options = {
      ...h.options,
      requiredToolScopes: {
        write_note: ['notes:read', 'notes:write', 'notes:issue'],
      },
    }
    const response = await handleMcpRequest(await capturedCall(), h.options)
    expect(response.status).toBe(403)
    expect(challengeScopes(response).sort()).toEqual(supported.toSorted())
    expect(h.configureServer).not.toHaveBeenCalled()
    expect(h.operation).not.toHaveBeenCalled()
  })

  it('does not let tool scopes replace the endpoint baseline', async () => {
    const h = harness(['notes:write'])
    const response = await handleMcpRequest(await capturedCall(), h.options)
    expect(response.status).toBe(403)
    expect(challengeScopes(response)).toContain('notes:read')
    expect(h.configureServer).not.toHaveBeenCalled()
    expect(h.operation).not.toHaveBeenCalled()
  })

  it('preserves default behavior when no tool scope map is configured', async () => {
    const h = harness()
    const { requiredToolScopes: _unused, ...options } = h.options
    const response = await handleMcpRequest(await capturedCall(), options)
    expect(response.status).toBe(200)
    expect(h.operation).toHaveBeenCalledOnce()
  })

  it('rejects unsupported tool scopes as configuration errors before callbacks', async () => {
    const h = harness()
    await expect(
      handleMcpRequest(await capturedCall(), {
        ...h.options,
        requiredToolScopes: { write_note: ['notes:admin'] },
      }),
    ).rejects.toThrow('MCP required tool scopes must be advertised as supported')
    expect(h.configureServer).not.toHaveBeenCalled()
    expect(h.operation).not.toHaveBeenCalled()
  })

  it('supports preconfigured bearer mode without advertising OAuth discovery', async () => {
    const h = harness()
    const options: HandleMcpRequestOptions = {
      ...h.options,
      authorization: {
        mode: 'preconfigured-bearer',
        issuer,
        verifier: h.options.authorization.verifier,
        requiredScopes: ['notes:read'],
      },
    }
    const response = await handleMcpRequest(await capturedCall(), options)
    expect(response.status).toBe(403)
    expect(challengeScopes(response).sort()).toEqual(['notes:read', 'notes:write'])
    expect(response.headers.get('www-authenticate')).not.toContain('resource_metadata')
    const discovery = await handleMcpRequest(
      new Request('https://tool-scopes.example.test/.well-known/oauth-protected-resource/mcp'),
      options,
    )
    expect(discovery.status).toBe(404)
    expect(h.configureServer).not.toHaveBeenCalled()
  })

  it.each([
    'method mismatch',
    'version mismatch',
    'missing envelope',
    'invalid JSON',
    'batch',
    'notification',
  ])('keeps the SDK response for %s without asking for more authority', async (malformation) => {
    const original = await capturedCall()
    const headers = new Headers(original.headers)
    const body = await original.json()
    let serialized: string
    if (malformation === 'method mismatch') headers.set('mcp-method', 'tools/list')
    if (malformation === 'version mismatch') headers.set('mcp-protocol-version', '2025-11-25')
    if (malformation === 'missing envelope') delete body.params._meta
    if (malformation === 'notification') delete body.id
    serialized = JSON.stringify(malformation === 'batch' ? [body] : body)
    if (malformation === 'invalid JSON') serialized = '{'
    const malformed = () => new Request(resource, { method: 'POST', headers, body: serialized })
    const h = harness()
    const { requiredToolScopes: _unused, ...defaultOptions } = h.options
    const baseline = await handleMcpRequest(malformed(), defaultOptions)
    const response = await handleMcpRequest(malformed(), h.options)
    expect(response.status).toBe(baseline.status)
    expect(await response.text()).toBe(await baseline.text())
    expect(response.headers.get('www-authenticate')).toBeNull()
    expect(h.operation).not.toHaveBeenCalled()
  })

  it('authorizes before later SDK version validation without dispatching unsupported revisions', async () => {
    const original = await capturedCall()
    const headers = new Headers(original.headers)
    headers.set('mcp-protocol-version', '2099-01-01')
    const body = await original.json()
    body.params._meta['io.modelcontextprotocol/protocolVersion'] = '2099-01-01'
    const request = () =>
      new Request(resource, { method: 'POST', headers, body: JSON.stringify(body) })
    const denied = harness()
    const challenge = await handleMcpRequest(request(), denied.options)
    expect(challenge.status).toBe(403)
    expect(challengeScopes(challenge)).toContain('notes:write')
    expect(denied.configureServer).not.toHaveBeenCalled()
    expect(denied.operation).not.toHaveBeenCalled()

    const allowed = harness(supported)
    const rejection = await handleMcpRequest(request(), allowed.options)
    expect(rejection.status).toBe(400)
    expect(rejection.headers.get('www-authenticate')).toBeNull()
    expect(allowed.operation).not.toHaveBeenCalled()
  })

  it('cannot bypass the body-selected tool scope by forging the MCP-Name routing header', async () => {
    const original = await capturedCall()
    const headers = new Headers(original.headers)
    headers.set('mcp-name', 'read_note')
    const h = harness()
    const response = await handleMcpRequest(
      new Request(resource, {
        method: 'POST',
        headers,
        body: await original.text(),
      }),
      h.options,
    )
    expect(response.status).toBe(403)
    expect(challengeScopes(response)).toContain('notes:write')
    expect(h.configureServer).not.toHaveBeenCalled()
    expect(h.operation).not.toHaveBeenCalled()
  })

  it('lets the SDK reject a forged MCP-Name even after tool scope authorization passes', async () => {
    const original = await capturedCall()
    const headers = new Headers(original.headers)
    headers.set('mcp-name', 'read_note')
    const h = harness(supported)
    const response = await handleMcpRequest(
      new Request(resource, {
        method: 'POST',
        headers,
        body: await original.text(),
      }),
      h.options,
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('www-authenticate')).toBeNull()
    expect(h.operation).not.toHaveBeenCalled()
  })
})
