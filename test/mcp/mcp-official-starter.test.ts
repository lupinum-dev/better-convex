import { handleMcpRequest, type HandleMcpRequestOptions } from '@lupinum/better-convex-mcp'
import { listMcpCatalog } from '@lupinum/better-convex-mcp/test'
import type { BetterConvexMcpPrincipal } from '@lupinum/better-convex-nuxt/better-auth/server'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { ConvexError } from 'convex/values'
import { describe, expect, it, vi } from 'vitest'

import { registerProjectTools } from '../../starters/mcp-oauth-agent/convex/mcp'
import { PROJECT_ERROR_CODES } from '../../starters/mcp-oauth-agent/convex/projects'

const resource = new URL('https://starter.example.test/mcp')
const issuer = 'https://starter-app.example.test/api/auth'
const bearer = 'delegated-starter-bearer-must-not-escape'
const scopesSupported = ['mcp:read', 'mcp:write', 'offline_access']

function principalFor(scopes: string[]): BetterConvexMcpPrincipal {
  return {
    kind: 'oauth',
    userId: 'user-1',
    clientId: 'client-1',
    scopes,
    sessionId: 'session-private',
    grantId: 'grant-private',
    issuer,
    resource: resource.href,
    expiresAt: Math.floor(Date.now() / 1_000) + 300,
  }
}

function accessFor(principal: BetterConvexMcpPrincipal) {
  return {
    issuer,
    subject: principal.userId,
    clientId: principal.clientId,
    resource: resource.href,
    scopes: principal.scopes,
  }
}

function harness(scopes = ['mcp:read', 'mcp:write']) {
  const principal = principalFor(scopes)
  const runMutation = vi.fn(
    async (_reference: unknown, _args: unknown): Promise<unknown> => ({
      projects: [{ id: 'project-1', name: 'Example' }],
    }),
  )
  const options: HandleMcpRequestOptions<BetterConvexMcpPrincipal> = {
    serverInfo: { name: 'starter-proof', version: '1.0.0' },
    resource,
    authorization: {
      mode: 'oauth',
      issuer,
      scopesSupported,
      verifier: {
        async verifyAccessToken(token, expected) {
          if (token !== bearer || expected.resource.href !== resource.href) {
            throw new Error('invalid')
          }
          return { access: accessFor(principal), principal, expiresAt: principal.expiresAt }
        },
      },
    },
    exposeErrorCodes: PROJECT_ERROR_CODES,
    configureServer: (context) => registerProjectTools({ runMutation } as never, context),
  }
  const exchanges: Array<{ status: number; body: string; challenge: string | null }> = []
  const client = new Client(
    { name: 'starter-proof', version: '1' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  )
  const transport = new StreamableHTTPClientTransport(resource, {
    requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    fetch: async (input, init) => {
      const response = await handleMcpRequest(new Request(input, init), options)
      exchanges.push({
        status: response.status,
        body: await response.clone().text(),
        challenge: response.headers.get('www-authenticate'),
      })
      return response
    },
  })
  return { client, exchanges, principal, runMutation, transport }
}

describe('MCP starter composition', () => {
  it('lists the reviewed catalog with risk annotations and per-tool scopes', async () => {
    const principal = principalFor(['mcp:read', 'mcp:write'])
    const catalog = await listMcpCatalog({
      configureServer: (context) => registerProjectTools({} as never, context),
      access: accessFor(principal),
      principal,
      scopesSupported,
    })
    const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    const summary = catalog.tools.map((tool) => ({
      name: tool.name,
      annotations: tool.annotations,
      scopes: (tool._meta?.securitySchemes as Array<{ scopes: string[] }>)[0]?.scopes,
    }))
    expect(summary).toEqual([
      {
        name: 'list_organizations',
        annotations: { ...read, openWorldHint: false },
        scopes: ['mcp:read'],
      },
      {
        name: 'list_projects',
        annotations: { ...read, openWorldHint: false },
        scopes: ['mcp:read'],
      },
      {
        name: 'create_project',
        annotations: { ...write, openWorldHint: false },
        scopes: ['mcp:write'],
      },
      {
        name: 'request_project_deletion',
        annotations: { ...write, openWorldHint: false },
        scopes: ['mcp:write'],
      },
      {
        name: 'delete_project',
        annotations: { ...write, destructiveHint: true, openWorldHint: false },
        scopes: ['mcp:write'],
      },
    ])
    expect(catalog.tools.every((tool) => tool.outputSchema !== undefined)).toBe(true)
    expect(catalog.resources).toEqual([])
  })

  it('passes the verified principal to one internal mutation without the bearer', async () => {
    const h = harness()
    try {
      await h.client.connect(h.transport)
      const result = await h.client.callTool({
        name: 'list_projects',
        arguments: { organizationId: 'organization-1' },
      })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toEqual({ projects: [{ id: 'project-1', name: 'Example' }] })
      expect(h.runMutation).toHaveBeenCalledOnce()
      expect(h.runMutation.mock.calls[0]?.[1]).toEqual({
        organizationId: 'organization-1',
        principal: h.principal,
      })
      const wire = JSON.stringify(h.exchanges)
      expect(wire).not.toContain(bearer)
      expect(wire).not.toMatch(/session-private|grant-private/)
    } finally {
      await h.client.close()
    }
  })

  it('projects allowlisted application errors and hides every other failure', async () => {
    const h = harness()
    try {
      await h.client.connect(h.transport)
      h.runMutation.mockRejectedValueOnce(
        new ConvexError({ code: 'MCP_RESOURCE_NOT_FOUND', message: 'No such project.' }),
      )
      expect(
        await h.client.callTool({
          name: 'request_project_deletion',
          arguments: { organizationId: 'organization-1', projectId: 'project-9' },
        }),
      ).toMatchObject({
        isError: true,
        structuredContent: {
          error: { code: 'MCP_RESOURCE_NOT_FOUND', message: 'No such project.', retryable: false },
        },
      })

      h.runMutation.mockRejectedValueOnce(
        new ConvexError({ code: 'MCP_ACCESS_DENIED', message: 'MCP access denied' }),
      )
      expect(await h.client.callTool({ name: 'list_organizations', arguments: {} })).toMatchObject({
        isError: true,
        structuredContent: { error: { code: 'MCP_ACCESS_DENIED' } },
      })

      h.runMutation.mockRejectedValueOnce(
        new ConvexError({ code: 'DATABASE_DETAIL', message: 'private-internal-detail' }),
      )
      expect(await h.client.callTool({ name: 'list_organizations', arguments: {} })).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'Tool execution failed' }],
      })
      expect(JSON.stringify(h.exchanges)).not.toContain('private-internal-detail')
    } finally {
      await h.client.close()
    }
  })

  it('asks a read-only connection to step up before a write reaches Convex', async () => {
    const h = harness(['mcp:read'])
    try {
      await h.client.connect(h.transport)
      await expect(
        h.client.callTool({
          name: 'create_project',
          arguments: { organizationId: 'organization-1', name: 'New' },
        }),
      ).rejects.toThrow()
      const denied = h.exchanges.at(-1)!
      expect(denied.status).toBe(403)
      expect(denied.challenge).toContain('error="insufficient_scope"')
      expect(denied.challenge).toContain('scope="mcp:write"')
      expect(h.runMutation).not.toHaveBeenCalled()
    } finally {
      await h.client.close()
    }
  })
})
