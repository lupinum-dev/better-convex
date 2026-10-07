import {
  handleMcpRequest,
  type McpAccessVerifier,
  type HandleMcpRequestOptions,
} from '@lupinum/better-convex-agents/mcp'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const resource = new URL('https://principal.example.test/mcp')
const resourceMetadata = 'https://principal.example.test/.well-known/oauth-protected-resource/mcp'
const issuer = 'https://issuer.example.test/'
const bearer = 'typed-principal-bearer-sentinel'

interface GrantPrincipal {
  readonly kind: 'oauth'
  readonly userId: string
  readonly grantId: string
}

const access = {
  issuer,
  subject: 'user-1',
  clientId: 'client-1',
  resource: resource.href,
  scopes: ['notes:read'],
}

function verifier(principal: GrantPrincipal): McpAccessVerifier<GrantPrincipal> {
  return {
    async verifyAccessToken(token) {
      if (token !== bearer) throw new Error('invalid token')
      return { access, principal, expiresAt: Math.floor(Date.now() / 1_000) + 300 }
    },
  }
}

function connect(options: HandleMcpRequestOptions<GrantPrincipal>) {
  const transport = new StreamableHTTPClientTransport(resource, {
    requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    fetch: (input, init) => handleMcpRequest(new Request(input, init), options),
  })
  const client = new Client(
    { name: 'typed-principal-client', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  )
  return { client, transport }
}

describe('typed MCP principal', () => {
  it('hands the verifier principal to requestState and configureServer without closure capture', async () => {
    const principal: GrantPrincipal = { kind: 'oauth', userId: 'user-1', grantId: 'grant-42' }
    const seen: unknown[] = []
    const requestState = vi.fn<
      NonNullable<HandleMcpRequestOptions<GrantPrincipal>['requestState']>
    >(() => ({
      async verify() {
        return undefined
      },
    }))
    const options: HandleMcpRequestOptions<GrantPrincipal> = {
      resource,
      serverInfo: { name: 'typed-principal', version: '1.0.0' },
      authorization: { mode: 'oauth', issuer, verifier: verifier(principal) },
      requestState,
      configureServer(context) {
        seen.push(context)
        const { principal: typed, server } = context
        server.registerTool('whoami', { inputSchema: z.object({}) }, () => ({
          content: [{ type: 'text', text: typed.grantId }],
          structuredContent: { userId: typed.userId, grantId: typed.grantId },
        }))
      },
    }
    const { client, transport } = connect(options)
    try {
      await client.connect(transport)
      await expect(client.callTool({ name: 'whoami', arguments: {} })).resolves.toMatchObject({
        structuredContent: { userId: 'user-1', grantId: 'grant-42' },
      })
    } finally {
      await client.close()
    }
    expect(seen.length).toBeGreaterThan(0)
    for (const context of seen) {
      expect(Object.keys(context as object).sort()).toEqual([
        'access',
        'principal',
        'server',
        'tools',
      ])
      expect(context).toMatchObject({ access, principal })
      expect(Object.isFrozen(context)).toBe(true)
      expect(context).not.toHaveProperty('token')
    }
    expect(requestState).toHaveBeenCalled()
    for (const [context] of requestState.mock.calls) {
      expect(context).toEqual({ access, principal })
    }
  })

  it.each([
    [
      'throws',
      {
        async verifyAccessToken() {
          throw new Error('live access revoked sentinel')
        },
      },
    ],
    [
      'returns fields beyond access, principal and expiresAt',
      {
        async verifyAccessToken() {
          return {
            access,
            principal: { kind: 'oauth', userId: 'user-1', grantId: 'grant-1' },
            expiresAt: Math.floor(Date.now() / 1_000) + 300,
            token: bearer,
          }
        },
      } as unknown as McpAccessVerifier<GrantPrincipal>,
    ],
  ] as Array<[string, McpAccessVerifier<GrantPrincipal>]>)(
    'keeps the unchanged 401 challenge when the verifier %s',
    async (_label, failing) => {
      const configureServer = vi.fn()
      const response = await handleMcpRequest(
        new Request(resource, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: '{}',
        }),
        {
          resource,
          serverInfo: { name: 'typed-principal', version: '1.0.0' },
          authorization: { mode: 'oauth', issuer, verifier: failing },
          configureServer,
        },
      )
      expect(response.status).toBe(401)
      expect(response.headers.get('www-authenticate')).toBe(
        `Bearer error="invalid_token", error_description="Invalid access token", resource_metadata="${resourceMetadata}"`,
      )
      // The bearer itself ends in "sentinel", so this also proves it is not echoed.
      expect(await response.text()).not.toContain('sentinel')
      expect(configureServer).not.toHaveBeenCalled()
    },
  )
})
