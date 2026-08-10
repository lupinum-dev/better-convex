import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { handleMcpRequest, type HandleMcpRequestOptions } from '../../packages/mcp/src/handler'
import type { McpAccessVerifier } from '../../packages/mcp/src/index'
import { runMcpTool } from '../../packages/mcp/src/tools'

const resource = new URL('https://absence.example.test/mcp')
const bearer = 'unique-raw-bearer-4f74c5c8'
const providerReference = 'unique-provider-reference-93bd5701'
const privateInput = 'unique-private-tool-argument-792fd791'
const subjectPii = 'unique-user-pii-2b89@example.invalid'
const oauthMetadata = {
  authorization_endpoint: 'https://issuer.example.test/authorize',
  code_challenge_methods_supported: ['S256'],
  grant_types_supported: ['authorization_code'],
  issuer: 'https://issuer.example.test/',
  response_types_supported: ['code'],
  token_endpoint: 'https://issuer.example.test/token',
  token_endpoint_auth_methods_supported: ['none'],
}

afterEach(() => vi.restoreAllMocks())

describe('MCP credential passthrough absence', () => {
  it('terminates raw credential state before application arguments, results, diagnostics, and logs', async () => {
    const consoleSpies = [
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    ]
    const verifier: McpAccessVerifier = {
      async verifyAccessToken(token, expected) {
        if (
          token !== bearer ||
          expected.issuer !== oauthMetadata.issuer ||
          expected.resource.href !== resource.href ||
          providerReference.length === 0
        ) {
          throw new Error('invalid')
        }
        return {
          access: {
            issuer: oauthMetadata.issuer,
            subject: subjectPii,
            clientId: 'client-123',
            resource: resource.href,
            scopes: ['notes:read'],
          },
          expiresAt: Math.floor(Date.now() / 1_000) + 300,
        }
      },
    }
    const operationArguments: unknown[] = []
    const responseBodies: string[] = []
    const callbackHeaders: Headers[] = []
    const requestOptions = {
      serverInfo: { name: 'absence-proof', version: '0.1.0' },
      resource,
      authorization: { mode: 'oauth', issuer: oauthMetadata.issuer, verifier },
      configureServer(access, server) {
        server.registerTool(
          'search_notes',
          {
            inputSchema: z.object({ query: z.string() }).strict(),
            outputSchema: z.object({ matches: z.array(z.string()) }).strict(),
          },
          async (input, extra) => {
            if (extra.http?.req) callbackHeaders.push(new Headers(extra.http.req.headers))
            const args = {
              actor: { issuer: access.issuer, subject: access.subject },
              input,
            }
            operationArguments.push(args)
            return {
              content: [{ type: 'text', text: 'No notes matched.' }],
              structuredContent: { matches: [] },
            }
          },
        )
        server.registerTool(
          'fail_safely',
          { inputSchema: z.object({}).strict() },
          (_input, extra) => {
            if (extra.http?.req) callbackHeaders.push(new Headers(extra.http.req.headers))
            return runMcpTool(() => {
              throw new Error(`${bearer}:${providerReference}`)
            })
          },
        )
      },
    } satisfies HandleMcpRequestOptions
    const transport = new StreamableHTTPClientTransport(resource, {
      requestInit: {
        headers: {
          authorization: `Bearer ${bearer}`,
          cookie: 'session=unique-cookie-credential-sentinel',
          'proxy-authorization': 'Basic unique-proxy-credential-sentinel',
          'x-forwarded-authorization': 'unique-forwarded-credential-sentinel',
        },
      },
      fetch: async (input, init) => {
        const response = await handleMcpRequest(new Request(input, init), requestOptions)
        responseBodies.push(await response.clone().text())
        return response
      },
    })
    const client = new Client(
      { name: 'absence-client', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )

    try {
      await client.connect(transport)
      const success = await client.callTool({
        name: 'search_notes',
        arguments: { query: privateInput },
      })
      expect(success).toMatchObject({
        content: [{ type: 'text', text: 'No notes matched.' }],
        structuredContent: { matches: [] },
      })
      const failure = await client.callTool({
        name: 'fail_safely',
        arguments: {},
      })
      expect(failure).toMatchObject({
        content: [{ type: 'text', text: 'Tool execution failed' }],
        isError: true,
      })
    } finally {
      await client.close()
    }

    expect(operationArguments).toEqual([
      {
        actor: { issuer: oauthMetadata.issuer, subject: subjectPii },
        input: { query: privateInput },
      },
    ])
    expect(callbackHeaders).toHaveLength(2)
    for (const headers of callbackHeaders) {
      expect(headers.get('authorization')).toBeNull()
      expect(headers.get('cookie')).toBeNull()
      expect(headers.get('proxy-authorization')).toBeNull()
      expect(headers.get('x-forwarded-authorization')).toBeNull()
      expect(headers.get('content-type')).toContain('application/json')
    }
    const observable = JSON.stringify({
      callbackHeaders: callbackHeaders.map((headers) => Object.fromEntries(headers)),
      operationArguments,
      responseBodies,
    })
    expect(observable).not.toContain(bearer)
    expect(observable).not.toContain(providerReference)
    const publicObservable = JSON.stringify({
      callbackHeaders: callbackHeaders.map((headers) => Object.fromEntries(headers)),
      responseBodies,
    })
    expect(publicObservable).not.toContain(subjectPii)
    expect(publicObservable).not.toContain(privateInput)
    for (const spy of consoleSpies.slice(0, -1)) expect(spy).not.toHaveBeenCalled()
    const warningCalls = consoleSpies.at(-1)!.mock.calls
    expect(warningCalls).toEqual([
      [
        "responseMode: 'json' drops mid-call notifications. subscriptions/listen streams are always served over SSE regardless; other notifications emitted before a result are dropped.",
      ],
      [
        "responseMode: 'json' drops mid-call notifications. subscriptions/listen streams are always served over SSE regardless; other notifications emitted before a result are dropped.",
      ],
      [
        "responseMode: 'json' drops mid-call notifications. subscriptions/listen streams are always served over SSE regardless; other notifications emitted before a result are dropped.",
      ],
    ])
    const logged = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls))
    expect(logged).not.toContain(bearer)
    expect(logged).not.toContain(providerReference)
    expect(logged).not.toContain(subjectPii)
    expect(logged).not.toContain(privateInput)
  })
})
