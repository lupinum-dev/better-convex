import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { ResourceTemplate } from '@modelcontextprotocol/server'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { handleMcpRequest, type HandleMcpRequestOptions } from '../../packages/mcp/src/handler'
import type { McpAccessVerifier } from '../../packages/mcp/src/index'
const expectedMaximumMcpRequestBytes = 65_536
const expectedMcpRequestTimeoutMs = 30_000

const resource = new URL('https://notes.example.test/mcp')
const serverInfo = { name: 'mcp-handler-test', version: '0.1.0' } as const
const bearer = 'mcp-handler-bearer-sentinel'
const issuer = 'https://issuer.example.test/'

function accessVerifier(): McpAccessVerifier {
  return {
    async verifyAccessToken(token, expected) {
      if (
        token !== bearer ||
        expected.issuer !== issuer ||
        expected.resource.href !== resource.href
      ) {
        throw new Error('invalid')
      }
      return {
        access: {
          issuer,
          subject: 'integration-123',
          clientId: 'client-123',
          resource: resource.href,
          scopes: ['notes:read', 'notes:write'],
        },
        expiresAt: Math.floor(Date.now() / 1_000) + 300,
      }
    },
  }
}

function oauthAuthorization(verifier: McpAccessVerifier = accessVerifier()) {
  return { mode: 'oauth' as const, issuer, verifier }
}

describe('Convex-native official MCP handler composition', () => {
  it('keeps a committed tool result unary when the tool emits mid-call progress', async () => {
    const application = { effects: 0 }
    const toolResponses: Array<{ contentType: string | null; status: number }> = []
    const requestOptions = {
      serverInfo,
      resource,
      authorization: oauthAuthorization(),
      configureServer({ server }) {
        server.registerTool(
          'commit_once',
          { inputSchema: z.object({}) },
          async (_args, requestContext) => {
            application.effects += 1
            const progressToken = requestContext.mcpReq._meta?.progressToken
            if (progressToken === undefined) throw new Error('missing progress token')
            await requestContext.mcpReq.notify({
              method: 'notifications/progress',
              params: { progress: 1, progressToken, total: 1 },
            })
            return {
              content: [{ type: 'text', text: 'committed once' }],
              structuredContent: { effects: application.effects },
            }
          },
        )
      },
    } satisfies HandleMcpRequestOptions
    const transport = new StreamableHTTPClientTransport(resource, {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
      fetch: async (input, init) => {
        const request = new Request(input, init)
        const response = await handleMcpRequest(request, requestOptions)
        if (request.headers.get('mcp-method') === 'tools/call') {
          toolResponses.push({
            contentType: response.headers.get('content-type'),
            status: response.status,
          })
        }
        return response
      },
    })
    const client = new Client(
      { name: 'unary-progress-client', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )

    try {
      await client.connect(transport)
      const progress = vi.fn()
      await expect(
        client.callTool({ name: 'commit_once', arguments: {} }, { onprogress: progress }),
      ).resolves.toMatchObject({
        content: [{ type: 'text', text: 'committed once' }],
        structuredContent: { effects: 1 },
      })
      expect(application.effects).toBe(1)
      expect(progress).not.toHaveBeenCalled()
      expect(toolResponses).toEqual([{ contentType: 'application/json', status: 200 }])
    } finally {
      await client.close()
    }
  })

  it('serves explicit read and write tools while keeping bearer data outside application context', async () => {
    const application = {
      notes: new Map([['note-1', 'Alpha']]),
      operations: [] as string[],
    }
    const observedAccess: unknown[] = []
    const observedOfficialAuth: unknown[] = []
    const requestOptions = {
      serverInfo,
      resource,
      authorization: {
        mode: 'oauth',
        issuer,
        verifier: accessVerifier(),
        resourceName: 'Neutral notes',
        scopesSupported: ['notes:read', 'notes:write'],
      },
      configureServer({ access, server }) {
        observedAccess.push(access)
        server.registerTool(
          'search_notes',
          {
            inputSchema: z.object({ query: z.string() }),
            outputSchema: z.object({ titles: z.array(z.string()) }),
          },
          ({ query }, extra) => {
            observedOfficialAuth.push(extra.http?.authInfo)
            application.operations.push(`search:${access.issuer}:${access.subject}`)
            const output = {
              titles: [...application.notes.values()].filter((title) =>
                title.toLowerCase().includes(query.toLowerCase()),
              ),
            }
            return {
              content: [
                {
                  type: 'text',
                  text:
                    output.titles.length === 0
                      ? 'No notes matched.'
                      : `${output.titles.length} note matched: ${output.titles.join(', ')}.`,
                },
              ],
              structuredContent: output,
            }
          },
        )
        server.registerTool(
          'rename_note',
          {
            inputSchema: z.object({ id: z.string(), title: z.string() }),
            outputSchema: z.object({ id: z.string(), title: z.string() }),
          },
          ({ id, title }, extra) => {
            observedOfficialAuth.push(extra.http?.authInfo)
            if (!application.notes.has(id)) throw new Error('missing note')
            application.notes.set(id, title)
            application.operations.push(`rename:${id}:${access.clientId}`)
            const output = { id, title }
            return {
              content: [{ type: 'text', text: `Renamed ${id} to “${title}”.` }],
              structuredContent: output,
            }
          },
        )
        server.registerResource(
          'note',
          new ResourceTemplate('note://{id}', { list: undefined }),
          {
            description: 'Read one neutral note.',
            mimeType: 'text/plain',
          },
          async (uri, { id }) => {
            const title = application.notes.get(String(id))
            if (title === undefined) throw new Error('resource unavailable')
            return {
              contents: [{ uri: uri.href, mimeType: 'text/plain', text: title }],
            }
          },
        )
      },
    } satisfies HandleMcpRequestOptions
    const transport = new StreamableHTTPClientTransport(resource, {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
      fetch: (input, init) => handleMcpRequest(new Request(input, init), requestOptions),
    })
    const client = new Client(
      { name: 'neutral-notes-client', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )

    try {
      await client.connect(transport)
      expect((await client.listTools()).tools.map(({ name }) => name).sort()).toEqual([
        'rename_note',
        'search_notes',
      ])
      const search = await client.callTool({
        name: 'search_notes',
        arguments: { query: 'alpha' },
      })
      expect(search.structuredContent).toEqual({ titles: ['Alpha'] })
      expect(search.content).toEqual([{ type: 'text', text: '1 note matched: Alpha.' }])
      const rename = await client.callTool({
        name: 'rename_note',
        arguments: { id: 'note-1', title: 'Beta' },
      })
      expect(rename.structuredContent).toEqual({ id: 'note-1', title: 'Beta' })
      expect(rename.content).toEqual([{ type: 'text', text: 'Renamed note-1 to “Beta”.' }])
      await expect(client.listResourceTemplates()).resolves.toMatchObject({
        resourceTemplates: [
          {
            name: 'note',
            uriTemplate: 'note://{id}',
            mimeType: 'text/plain',
          },
        ],
      })
      await expect(client.readResource({ uri: 'note://note-1' })).resolves.toMatchObject({
        contents: [{ uri: 'note://note-1', mimeType: 'text/plain', text: 'Beta' }],
      })
      expect(application.notes.get('note-1')).toBe('Beta')
      expect(application.operations).toEqual([
        'search:https://issuer.example.test/:integration-123',
        'rename:note-1:client-123',
      ])
      // The SDK passes its scope-challenge input to callbacks; it carries no bearer bytes.
      const officialAuth = {
        token: '',
        clientId: 'client-123',
        scopes: ['notes:read', 'notes:write'],
        expiresAt: expect.any(Number),
        resourceMetadataUrl: 'https://notes.example.test/.well-known/oauth-protected-resource/mcp',
      }
      expect(observedOfficialAuth).toEqual([officialAuth, officialAuth])
      expect(JSON.stringify(observedOfficialAuth)).not.toContain(bearer)
      expect(client.getServerCapabilities()).toMatchObject({
        resources: { listChanged: false, subscribe: false },
        tools: { listChanged: false },
      })
      expect(observedAccess.length).toBeGreaterThanOrEqual(4)
      for (const access of observedAccess) {
        expect(access).not.toHaveProperty('token')
        expect(access).not.toHaveProperty('providerReference')
      }
    } finally {
      await client.close()
    }
  })

  it('supports preconfigured bearer credentials without advertising an OAuth server', async () => {
    const credentialIssuer = 'https://notes.example.test/credentials/'
    const requestOptions = {
      serverInfo,
      resource,
      authorization: {
        mode: 'preconfigured-bearer',
        issuer: credentialIssuer,
        requiredScopes: ['notes:read'],
        verifier: {
          async verifyAccessToken(token, expected) {
            if (
              token !== bearer ||
              expected.issuer !== credentialIssuer ||
              expected.resource.href !== resource.href
            ) {
              throw new Error('invalid')
            }
            return {
              access: {
                issuer: credentialIssuer,
                subject: 'credential-123',
                clientId: 'preconfigured-client',
                resource: resource.href,
                scopes: ['notes:read'],
              },
              expiresAt: Math.floor(Date.now() / 1_000) + 300,
            }
          },
        },
      },
      configureServer({ access, server }) {
        server.registerTool('whoami', { inputSchema: z.object({}) }, () => ({
          content: [{ type: 'text', text: 'Credential is active.' }],
          structuredContent: { subject: access.subject },
        }))
      },
    } satisfies HandleMcpRequestOptions

    for (const metadataUrl of [
      'https://notes.example.test/.well-known/oauth-protected-resource/mcp',
      'https://notes.example.test/.well-known/oauth-authorization-server',
    ]) {
      const response = await handleMcpRequest(new Request(metadataUrl), requestOptions)
      expect(response.status).toBe(404)
      await expect(response.text()).resolves.toBe('')
    }

    const denied = await handleMcpRequest(
      new Request(resource, {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      requestOptions,
    )
    expect(denied.status).toBe(401)
    expect(denied.headers.get('www-authenticate')).toMatch(/^Bearer /u)
    expect(denied.headers.get('www-authenticate')).not.toContain('resource_metadata')

    const transport = new StreamableHTTPClientTransport(resource, {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
      fetch: async (input, init) =>
        await handleMcpRequest(new Request(input, init), requestOptions),
    })
    const client = new Client(
      { name: 'preconfigured-client', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    try {
      await client.connect(transport)
      await expect(client.callTool({ name: 'whoami', arguments: {} })).resolves.toMatchObject({
        structuredContent: { subject: 'credential-123' },
      })
    } finally {
      await client.close()
    }
  })

  it.each([
    {
      label: 'wrong route',
      request: () => new Request('https://notes.example.test/other'),
      status: 404,
    },
    {
      label: 'query-bearing route',
      request: () => new Request('https://notes.example.test/mcp?function=other'),
      status: 404,
    },
    {
      label: 'encoded body',
      request: () =>
        new Request(resource, {
          method: 'POST',
          headers: { 'content-encoding': 'gzip' },
          body: 'encoded',
        }),
      status: 415,
    },
    {
      label: 'non-JSON body',
      request: () =>
        new Request(resource, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: '{}',
        }),
      status: 415,
    },
    {
      label: 'browser origin',
      request: () =>
        new Request(resource, {
          headers: { origin: 'https://attacker.example' },
          method: 'POST',
        }),
      status: 403,
    },
  ])('rejects $label before credential or application handling', async ({ request, status }) => {
    let verifierCalls = 0
    let factoryCalls = 0
    const requestOptions = {
      serverInfo,
      resource,
      authorization: oauthAuthorization({
        async verifyAccessToken() {
          verifierCalls += 1
          return accessVerifier().verifyAccessToken(bearer, {
            issuer,
            resource,
          })
        },
      }),
      configureServer({ server }) {
        factoryCalls += 1
        void server
      },
    } satisfies HandleMcpRequestOptions
    const response = await handleMcpRequest(request(), requestOptions)
    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.text()).resolves.toBe('')
    expect(verifierCalls).toBe(0)
    expect(factoryCalls).toBe(0)
  })

  it('serves fixed RFC 9728 metadata and binds every challenge to its exact URL', async () => {
    const requestOptions = {
      serverInfo,
      resource,
      authorization: {
        mode: 'oauth',
        issuer,
        verifier: accessVerifier(),
        resourceName: 'Neutral notes',
        scopesSupported: ['notes:read', 'notes:write'],
      },
      configureServer({ server }) {
        void server
      },
    } satisfies HandleMcpRequestOptions
    const protectedResourceUrl = new URL(
      'https://notes.example.test/.well-known/oauth-protected-resource/mcp',
    )
    const protectedResponse = await handleMcpRequest(
      new Request(protectedResourceUrl),
      requestOptions,
    )
    expect(protectedResponse.status).toBe(200)
    expect(protectedResponse.headers.get('access-control-allow-origin')).toBe('*')
    await expect(protectedResponse.json()).resolves.toEqual({
      authorization_servers: ['https://issuer.example.test/'],
      resource: resource.href,
      resource_name: 'Neutral notes',
      scopes_supported: ['notes:read', 'notes:write'],
    })
    const protectedHead = await handleMcpRequest(
      new Request(protectedResourceUrl, { method: 'HEAD' }),
      requestOptions,
    )
    expect(protectedHead.status).toBe(200)
    expect(protectedHead.headers.get('access-control-allow-origin')).toBe('*')
    await expect(protectedHead.text()).resolves.toBe('')
    const protectedOptions = await handleMcpRequest(
      new Request(protectedResourceUrl, {
        headers: { 'access-control-request-headers': 'authorization, mcp-method' },
        method: 'OPTIONS',
      }),
      requestOptions,
    )
    expect(protectedOptions.status).toBe(204)
    expect(protectedOptions.headers.get('access-control-allow-origin')).toBe('*')
    expect(protectedOptions.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS')
    expect(protectedOptions.headers.get('access-control-allow-headers')).toBe(
      'authorization, mcp-method',
    )
    expect(protectedOptions.headers.get('vary')).toBe('Access-Control-Request-Headers')

    const authorizationResponse = await handleMcpRequest(
      new Request('https://notes.example.test/.well-known/oauth-authorization-server'),
      requestOptions,
    )
    expect(authorizationResponse.status).toBe(404)
    await expect(authorizationResponse.text()).resolves.toBe('')

    const denied = await handleMcpRequest(
      new Request(resource, {
        method: 'POST',
        headers: {
          authorization: 'Bearer wrong',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ resource: 'https://attacker.invalid' }),
      }),
      requestOptions,
    )
    expect(denied.status).toBe(401)
    const challenge = denied.headers.get('www-authenticate')
    expect(challenge).toContain(
      'resource_metadata="https://notes.example.test/.well-known/oauth-protected-resource/mcp"',
    )
    expect(challenge).not.toContain('attacker')
  })

  it.each(['oauth', 'preconfigured-bearer'] as const)(
    'rejects a plaintext remote issuer in %s mode before request handling',
    async (mode) => {
      await expect(
        handleMcpRequest(new Request(resource), {
          serverInfo,
          resource,
          authorization: {
            mode,
            issuer: 'http://issuer.example.test/',
            verifier: accessVerifier(),
          },
          configureServer({ server }) {
            void server
          },
        }),
      ).rejects.toThrow('Invalid access issuer')
    },
  )

  it.each([
    {
      label: 'duplicate required scopes',
      requiredScopes: ['notes:read', 'notes:read'],
      scopesSupported: ['notes:read'],
      message: 'MCP configured scopes must be unique',
    },
    {
      label: 'a required scope missing from metadata',
      requiredScopes: ['notes:write'],
      scopesSupported: ['notes:read'],
      message: 'MCP required scopes must be advertised as supported',
    },
    {
      label: 'an unsafe configured scope',
      requiredScopes: ['notes:\nwrite'],
      scopesSupported: ['notes:\nwrite'],
      message: 'Invalid access scope',
    },
  ])(
    'rejects $label before verifier or application work',
    async ({ requiredScopes, scopesSupported, message }) => {
      let verifierCalls = 0
      let factoryCalls = 0
      await expect(
        handleMcpRequest(new Request(resource), {
          serverInfo,
          resource,
          authorization: {
            mode: 'oauth',
            issuer,
            requiredScopes,
            scopesSupported,
            verifier: {
              async verifyAccessToken() {
                verifierCalls += 1
                return accessVerifier().verifyAccessToken(bearer, {
                  issuer,
                  resource,
                })
              },
            },
          },
          configureServer({ server }) {
            factoryCalls += 1
            void server
          },
        }),
      ).rejects.toThrow(message)
      expect(verifierCalls).toBe(0)
      expect(factoryCalls).toBe(0)
    },
  )

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts the exact reviewed %s loopback issuer in both authorization modes',
    async (host) => {
      const issuer = `http://${host}:3210/`
      for (const authorization of [
        { mode: 'oauth' as const, issuer, verifier: accessVerifier() },
        { mode: 'preconfigured-bearer' as const, issuer, verifier: accessVerifier() },
      ]) {
        await expect(
          handleMcpRequest(new Request(resource), {
            serverInfo,
            resource,
            authorization,
            configureServer({ server }) {
              void server
            },
          }),
        ).resolves.toBeInstanceOf(Response)
      }
    },
  )

  it('rejects foreign issuers and never accepts a bearer from query or body', async () => {
    let factoryCalls = 0
    const foreignIssuerVerifier: McpAccessVerifier = {
      async verifyAccessToken() {
        return {
          access: {
            issuer: 'https://foreign-issuer.example.test/',
            subject: 'foreign-subject',
            clientId: 'foreign-client',
            resource: resource.href,
            scopes: ['notes:read'],
          },
          expiresAt: Math.floor(Date.now() / 1_000) + 300,
        }
      },
    }
    const foreignOptions = {
      serverInfo,
      resource,
      authorization: oauthAuthorization(foreignIssuerVerifier),
      configureServer({ server }) {
        factoryCalls += 1
        void server
      },
    } satisfies HandleMcpRequestOptions
    const foreignResponse = await handleMcpRequest(
      new Request(resource, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
        },
        body: '{}',
      }),
      foreignOptions,
    )
    expect(foreignResponse.status).toBe(401)

    const headerOnlyOptions = {
      serverInfo,
      resource,
      authorization: oauthAuthorization(),
      configureServer({ server }) {
        factoryCalls += 1
        void server
      },
    } satisfies HandleMcpRequestOptions
    for (const [request, expectedStatus] of [
      [
        new Request(`${resource.href}?access_token=${bearer}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
        404,
      ],
      [
        new Request(resource, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: bearer }),
        }),
        401,
      ],
    ] as const) {
      const response = await handleMcpRequest(request, headerOnlyOptions)
      expect(response.status).toBe(expectedStatus)
      expect(await response.text()).not.toContain(bearer)
    }
    expect(factoryCalls).toBe(0)
  })

  it('enforces request bounds before protocol parsing or application construction', async () => {
    let factoryCalls = 0
    const requestOptions = {
      serverInfo,
      resource,
      authorization: oauthAuthorization(),
      configureServer({ server }) {
        factoryCalls += 1
        void server
      },
    } satisfies HandleMcpRequestOptions
    const response = await handleMcpRequest(
      new Request(resource, {
        body: 'a'.repeat(expectedMaximumMcpRequestBytes + 1),
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      }),
      requestOptions,
    )

    expect(response.status).toBe(413)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.text()).resolves.toBe('')
    expect(factoryCalls).toBe(0)
  })

  it('rejects unsupported configured capabilities through the official SDK boundary', async () => {
    const requestOptions = {
      serverInfo,
      resource,
      authorization: oauthAuthorization(),
      configureServer({ server }) {
        server.registerPrompt('unsupported', {}, () => ({
          messages: [],
        }))
      },
    } satisfies HandleMcpRequestOptions

    await expect(
      handleMcpRequest(
        new Request(resource, {
          body: JSON.stringify({
            id: 'unsupported-capability',
            jsonrpc: '2.0',
            method: 'server/discover',
            params: {
              _meta: {
                'io.modelcontextprotocol/clientCapabilities': {},
                'io.modelcontextprotocol/clientInfo': {
                  name: 'unsupported-capability-client',
                  version: '0.1.0',
                },
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              },
            },
          }),
          headers: {
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
            'mcp-method': 'server/discover',
            'mcp-protocol-version': '2026-07-28',
          },
          method: 'POST',
        }),
        requestOptions,
      ),
    ).resolves.toMatchObject({ status: 500 })
  })

  it('returns an opaque timeout when the official handler cannot settle', async () => {
    vi.useFakeTimers()
    try {
      let factoryCalls = 0
      const requestOptions = {
        serverInfo,
        resource,
        authorization: oauthAuthorization(),
        async configureServer({ server }) {
          factoryCalls += 1
          void server
          return await new Promise<void>(() => {})
        },
      } satisfies HandleMcpRequestOptions
      const pending = handleMcpRequest(
        new Request(resource, {
          body: JSON.stringify({
            id: 'server-discover-timeout',
            jsonrpc: '2.0',
            method: 'server/discover',
            params: {
              _meta: {
                'io.modelcontextprotocol/clientCapabilities': {},
                'io.modelcontextprotocol/clientInfo': {
                  name: 'timeout-client',
                  version: '0.1.0',
                },
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              },
            },
          }),
          headers: {
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
            'mcp-method': 'server/discover',
            'mcp-protocol-version': '2026-07-28',
          },
          method: 'POST',
        }),
        requestOptions,
      )
      const responsePromise = expect(pending).resolves.toMatchObject({
        status: 504,
      })
      await vi.advanceTimersByTimeAsync(expectedMcpRequestTimeoutMs)
      await responsePromise
      const response = await pending
      expect(response.headers.get('cache-control')).toBe('no-store')
      await expect(response.text()).resolves.toBe('')
      expect(factoryCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
