import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { ScopeChallengeHandler } from '@modelcontextprotocol/server'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  handleMcpRequest,
  type HandleMcpRequestOptions,
  type McpRequestTools,
} from '../../packages/mcp/src/handler'

const resource = new URL('https://tool-scopes.example.test/mcp')
const resourceMetadata = 'https://tool-scopes.example.test/.well-known/oauth-protected-resource/mcp'
const issuer = 'https://issuer.example.test/'
const bearer = 'tool-scope-test-bearer'
const supported = ['notes:read', 'notes:write', 'notes:issue']
const noteUri = 'note://private/one'

function harness(
  scopes: readonly string[] = ['notes:read'],
  writeChallenge: ((tools: McpRequestTools) => ScopeChallengeHandler) | null = (tools) =>
    tools.requireScopes('notes:write'),
) {
  const operation = vi.fn(() => ({
    content: [{ type: 'text' as const, text: 'done' }],
  }))
  const readResource = vi.fn((uri: URL) => ({
    contents: [{ uri: uri.href, text: 'private note' }],
  }))
  const configureServer = vi.fn<HandleMcpRequestOptions['configureServer']>(
    (_access, server, tools) => {
      server.registerTool('read_note', { inputSchema: z.object({}) }, operation)
      server.registerTool(
        'write_note',
        {
          inputSchema: z.object({}),
          ...(writeChallenge === null ? {} : { scopeChallenge: writeChallenge(tools) }),
        },
        operation,
      )
      server.registerResource(
        'private_note',
        noteUri,
        { scopeChallenge: tools.requireScopes('notes:issue') },
        readResource,
      )
    },
  )
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
  return { options, operation, readResource, configureServer, exchanges, client, transport }
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

async function capturedExchange(method: 'tools/call' | 'resources/read'): Promise<Request> {
  const h = harness(supported)
  await h.client.connect(h.transport)
  try {
    if (method === 'tools/call') await h.client.callTool({ name: 'write_note', arguments: {} })
    else await h.client.readResource({ uri: noteUri })
  } finally {
    await h.client.close()
  }
  const exchange = h.exchanges.find(({ request }) => request.headers.get('mcp-method') === method)
  if (!exchange) throw new Error(`Official SDK did not send ${method}`)
  // The client aborts its transport signal on close. Reuse its wire bytes with a fresh signal.
  return new Request(resource, {
    method: 'POST',
    headers: exchange.request.headers,
    body: await exchange.request.text(),
  })
}

const capturedCall = () => capturedExchange('tools/call')

function challengeScopes(response: Response): string[] {
  return (
    response.headers
      .get('www-authenticate')
      ?.match(/(?:^|[ ,])scope="([^"]*)"/)?.[1]
      ?.split(' ') ?? []
  )
}

describe('per-tool MCP scope challenges', () => {
  it('returns the official SDK step-up challenge before the operation runs', async () => {
    const h = harness()
    await expect(sdkCall(h)).rejects.toThrow()
    const response = h.exchanges.at(-1)!.response
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: 'insufficient_scope',
    })
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer error="insufficient_scope", error_description="Insufficient scope", scope="notes:read notes:write", resource_metadata="${resourceMetadata}"`,
    )
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

  it('keeps step-up tools discoverable to callers that cannot run them yet', async () => {
    const h = harness()
    try {
      await h.client.connect(h.transport)
      expect((await h.client.listTools()).tools.map(({ name }) => name).sort()).toEqual([
        'read_note',
        'write_note',
      ])
      const listing = h.exchanges.find(
        ({ request }) => request.headers.get('mcp-method') === 'tools/list',
      )!.response
      expect(listing.status).toBe(200)
      expect(listing.headers.get('www-authenticate')).toBeNull()
      expect(h.operation).not.toHaveBeenCalled()
      const response = await handleMcpRequest(new Request(resourceMetadata), h.options)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        scopes_supported: supported.toSorted(),
      })
    } finally {
      await h.client.close()
    }
  })

  it('requires every declared scope and challenges with exactly that set', async () => {
    const h = harness(['notes:read', 'notes:write'], (tools) =>
      tools.requireScopes('notes:write', 'notes:issue'),
    )
    const response = await handleMcpRequest(await capturedCall(), h.options)
    expect(response.status).toBe(403)
    expect(challengeScopes(response).sort()).toEqual(supported.toSorted())
    expect(h.operation).not.toHaveBeenCalled()
  })

  it('adds the endpoint baseline once to a challenge for the extra scope', async () => {
    for (const writeChallenge of [
      (tools: McpRequestTools) => tools.requireScopes('notes:write'),
      (tools: McpRequestTools) => tools.requireScopes('notes:read', 'notes:write', 'notes:write'),
    ]) {
      const h = harness(['notes:read'], writeChallenge)
      const response = await handleMcpRequest(await capturedCall(), h.options)
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: 'insufficient_scope',
        error_description: 'Insufficient scope',
      })
      expect(response.headers.get('www-authenticate')).toBe(
        `Bearer error="insufficient_scope", error_description="Insufficient scope", scope="notes:read notes:write", resource_metadata="${resourceMetadata}"`,
      )
      expect(h.operation).not.toHaveBeenCalled()
    }
  })

  it('leaves a raw official SDK scope challenge unchanged', async () => {
    const h = harness(['notes:read'], () => () => ({
      scopes: ['notes:write'],
      errorDescription: 'Writing notes requires approval',
    }))
    const response = await handleMcpRequest(await capturedCall(), h.options)
    expect(response.status).toBe(403)
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer error="insufficient_scope", error_description="Writing notes requires approval", scope="notes:write", resource_metadata="${resourceMetadata}"`,
    )
    expect(h.operation).not.toHaveBeenCalled()
  })

  it('rejects a scope that discovery does not advertise while registering', async () => {
    for (const scopes of [['notes:read'], supported]) {
      const h = harness(scopes, (tools) => tools.requireScopes('notes:wirte'))
      const response = await handleMcpRequest(await capturedCall(), h.options)
      expect(h.configureServer.mock.results).toEqual([
        {
          type: 'throw',
          value: new TypeError('MCP scope challenges must be advertised as supported'),
        },
      ])
      expect(response.status).toBe(500)
      expect(response.headers.get('www-authenticate')).toBeNull()
      expect(h.operation).not.toHaveBeenCalled()
    }
  })

  it('does not let tool scopes replace the endpoint baseline', async () => {
    const h = harness(['notes:write'])
    const response = await handleMcpRequest(await capturedCall(), h.options)
    expect(response.status).toBe(403)
    expect(challengeScopes(response)).toContain('notes:read')
    expect(h.configureServer).not.toHaveBeenCalled()
    expect(h.operation).not.toHaveBeenCalled()
  })

  it('dispatches tools without a declared scope challenge', async () => {
    const h = harness(['notes:read'], null)
    const response = await handleMcpRequest(await capturedCall(), h.options)
    expect(response.status).toBe(200)
    expect(h.operation).toHaveBeenCalledOnce()
  })

  it('challenges a protected resource read before its callback', async () => {
    const denied = harness(['notes:read', 'notes:write'])
    const challenge = await handleMcpRequest(
      await capturedExchange('resources/read'),
      denied.options,
    )
    expect(challenge.status).toBe(403)
    expect(challengeScopes(challenge).sort()).toEqual(['notes:issue', 'notes:read'])
    expect(challenge.headers.get('www-authenticate')).toContain(
      `resource_metadata="${resourceMetadata}"`,
    )
    expect(denied.readResource).not.toHaveBeenCalled()

    const allowed = harness(supported)
    const response = await handleMcpRequest(
      await capturedExchange('resources/read'),
      allowed.options,
    )
    expect(response.status).toBe(200)
    expect(allowed.readResource).toHaveBeenCalledOnce()
  })

  it.each([
    [
      'throws',
      () => {
        throw new Error('scope policy failure')
      },
    ],
    ['returns an invalid scope', () => ({ scopes: ['notes write'] as [string] })],
  ] satisfies Array<[string, ScopeChallengeHandler]>)(
    'fails closed when the scope challenge %s',
    async (_label, writeChallenge) => {
      const h = harness(supported, () => writeChallenge)
      const response = await handleMcpRequest(await capturedCall(), h.options)
      expect(response.status).toBe(500)
      expect(response.headers.get('www-authenticate')).toBeNull()
      expect(await response.text()).not.toContain('scope policy failure')
      expect(h.operation).not.toHaveBeenCalled()
    },
  )

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
    const discovery = await handleMcpRequest(new Request(resourceMetadata), options)
    expect(discovery.status).toBe(404)
    expect(h.operation).not.toHaveBeenCalled()

    const extraOnly = harness(['notes:read'], (tools) => tools.requireScopes('notes:admin'))
    const challenge = await handleMcpRequest(await capturedCall(), {
      ...options,
      configureServer: extraOnly.options.configureServer,
    })
    expect(challenge.headers.get('www-authenticate')).toBe(
      'Bearer error="insufficient_scope", error_description="Insufficient scope", scope="notes:read notes:admin"',
    )
    expect(extraOnly.operation).not.toHaveBeenCalled()
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
    const baseline = await handleMcpRequest(malformed(), harness(['notes:read'], null).options)
    const h = harness()
    const response = await handleMcpRequest(malformed(), h.options)
    expect(response.status).toBe(baseline.status)
    expect(await response.text()).toBe(await baseline.text())
    expect(response.headers.get('www-authenticate')).toBeNull()
    expect(h.operation).not.toHaveBeenCalled()
  })

  it('rejects a call without MCP-Protocol-Version before asking for more authority', async () => {
    const original = await capturedCall()
    const headers = new Headers(original.headers)
    headers.delete('mcp-protocol-version')
    const body = await original.json()
    const h = harness()
    const response = await handleMcpRequest(
      new Request(resource, { method: 'POST', headers, body: JSON.stringify(body) }),
      h.options,
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('www-authenticate')).toBeNull()
    expect(await response.json()).toMatchObject({ id: body.id, error: { code: -32020 } })
    expect(h.configureServer).not.toHaveBeenCalled()
    expect(h.operation).not.toHaveBeenCalled()
  })

  it('leaves header validation of notifications to the SDK and never reaches a tool', async () => {
    const original = await capturedCall()
    const headers = new Headers(original.headers)
    headers.delete('mcp-protocol-version')
    headers.set('mcp-method', 'notifications/cancelled')
    headers.delete('mcp-name')
    const { _meta } = (await original.json()).params
    for (const params of [{ requestId: 1, _meta }, { requestId: 1 }]) {
      const h = harness()
      const response = await handleMcpRequest(
        new Request(resource, {
          method: 'POST',
          headers,
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params }),
        }),
        h.options,
      )
      expect(response.status).toBe(202)
      expect(await response.text()).toBe('')
      expect(h.operation).not.toHaveBeenCalled()
      expect(h.readResource).not.toHaveBeenCalled()
    }

    const h = harness()
    const request = await handleMcpRequest(
      new Request(resource, {
        method: 'POST',
        headers: new Headers({
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
          'mcp-method': 'tools/list',
        }),
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
      }),
      h.options,
    )
    expect(request.status).toBe(400)
    expect(await request.json()).toMatchObject({ id: 3, error: { code: -32022 } })
    expect(h.configureServer).not.toHaveBeenCalled()
  })

  it('rejects unsupported revisions before the scope challenge without dispatching', async () => {
    const original = await capturedCall()
    const headers = new Headers(original.headers)
    headers.set('mcp-protocol-version', '2099-01-01')
    const body = await original.json()
    body.params._meta['io.modelcontextprotocol/protocolVersion'] = '2099-01-01'
    const request = () =>
      new Request(resource, { method: 'POST', headers, body: JSON.stringify(body) })
    for (const h of [harness(), harness(supported)]) {
      const rejection = await handleMcpRequest(request(), h.options)
      expect(rejection.status).toBe(400)
      expect(rejection.headers.get('www-authenticate')).toBeNull()
      expect(await rejection.json()).toMatchObject({
        error: { data: { requested: '2099-01-01' } },
      })
      expect(h.configureServer).not.toHaveBeenCalled()
      expect(h.operation).not.toHaveBeenCalled()
    }
  })

  it('cannot reach a protected tool by forging the MCP-Name routing header', async () => {
    const original = await capturedCall()
    const headers = new Headers(original.headers)
    headers.set('mcp-name', 'read_note')
    const serialized = await original.text()
    for (const h of [harness(), harness(supported)]) {
      const response = await handleMcpRequest(
        new Request(resource, { method: 'POST', headers, body: serialized }),
        h.options,
      )
      expect(response.status).toBe(400)
      expect(response.headers.get('www-authenticate')).toBeNull()
      expect(await response.json()).toMatchObject({ error: { code: -32020 } })
      expect(h.operation).not.toHaveBeenCalled()
    }
  })
})
