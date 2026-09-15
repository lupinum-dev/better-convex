import {
  createRequestStateCodec,
  inputRequired,
  type ServerContext,
  type ServerOptions,
} from '@modelcontextprotocol/server'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'

import { handleMcpRequest, type HandleMcpRequestOptions } from '../../packages/mcp/src/handler'
import type { McpAccessContext } from '../../packages/mcp/src/index'

const resource = new URL('https://state.example.test/mcp')
const issuer = 'https://issuer.example.test/'
const key = 'synthetic-request-state-key-32-bytes-minimum'

function codecFor(access: McpAccessContext, ttlSeconds = 60) {
  return createRequestStateCodec({
    key,
    ttlSeconds,
    bind: (ctx) =>
      JSON.stringify([
        access.issuer,
        access.resource,
        access.subject,
        access.clientId,
        ctx.mcpReq.method,
        ctx.http?.req?.headers.get('mcp-name'),
        ctx.http?.req?.headers.get('mcp-param-project'),
      ]),
  })
}

function fixture(ttlSeconds = 60) {
  const invoked = vi.fn()
  const verify = vi.fn()
  const stateFactory = vi.fn((access: McpAccessContext) => ({
    async verify(state: string, ctx: ServerContext) {
      verify(access, state)
      return await codecFor(access, ttlSeconds).verify(state, ctx)
    },
  }))
  const options: HandleMcpRequestOptions = {
    resource,
    serverInfo: { name: 'request-state-test', version: '1.0.0' },
    authorization: {
      mode: 'preconfigured-bearer',
      issuer,
      verifier: {
        async verifyAccessToken(token) {
          if (!['alice-client-a', 'bob-client-a', 'alice-client-b'].includes(token))
            throw new Error('Invalid synthetic bearer')
          return {
            access: {
              issuer,
              resource: resource.href,
              subject: token.startsWith('alice') ? 'alice' : 'bob',
              clientId: token.endsWith('a') ? 'client-a' : 'client-b',
              scopes: ['notes:read'],
            },
            expiresAt: Math.floor(Date.now() / 1_000) + 300,
          }
        },
      },
    },
    requestState: stateFactory,
    configureServer(access, server) {
      for (const name of ['review_project', 'other_review']) {
        server.registerTool(
          name,
          { inputSchema: z.object({ project: z.string().meta({ 'x-mcp-header': 'Project' }) }) },
          async ({ project }, ctx) => {
            invoked(access, project, ctx.mcpReq.requestState())
            const state = ctx.mcpReq.requestState()
            if (state !== undefined) {
              return { content: [{ type: 'text', text: JSON.stringify(state) }] }
            }
            return inputRequired({
              requestState: await codecFor(access, ttlSeconds).mint({ project, round: 1 }, ctx),
            })
          },
        )
      }
    },
  }
  return { options, invoked, verify, stateFactory }
}

function request({
  state,
  token = 'alice-client-a',
  tool = 'review_project',
  project = 'project-a',
  id = 'initial',
}: { state?: unknown; token?: string; tool?: string; project?: string; id?: string } = {}) {
  return new Request(resource, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': tool,
      'mcp-param-project': project,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: tool,
        arguments: { project },
        ...(state === undefined ? {} : { requestState: state }),
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'state-test', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  })
}

async function initialState(f: ReturnType<typeof fixture>) {
  const response = await handleMcpRequest(request(), f.options)
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.result.resultType).toBe('input_required')
  expect(typeof body.result.requestState).toBe('string')
  f.invoked.mockClear()
  return body.result.requestState as string
}

describe('official SDK request-state verification', () => {
  it('keeps the public verifier on the official SDK contract', () => {
    type Configured = ReturnType<NonNullable<HandleMcpRequestOptions['requestState']>>
    expectTypeOf<Configured['verify']>().toEqualTypeOf<
      NonNullable<NonNullable<ServerOptions['requestState']>['verify']>
    >()
  })

  it('supplies verified decoded state to a fresh server before the resumed tool runs', async () => {
    const f = fixture()
    const state = await initialState(f)
    expect(f.verify).not.toHaveBeenCalled()
    const response = await handleMcpRequest(request({ state, id: 'resume' }), f.options)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: 'resume',
      result: { content: [{ text: '{"project":"project-a","round":1}' }] },
    })
    expect(f.stateFactory).toHaveBeenCalledTimes(2)
    expect(f.verify).toHaveBeenCalledOnce()
    expect(f.invoked).toHaveBeenCalledOnce()
    expect(f.invoked.mock.calls[0]?.[2]).toEqual({ project: 'project-a', round: 1 })
    expect(f.stateFactory.mock.calls[0]?.[0]).not.toHaveProperty('token')
  })

  it.each(['tampered', 'expired', 'principal', 'client', 'tool', 'project', 'non-string'])(
    'rejects %s state before application execution',
    async (fault) => {
      const f = fixture(fault === 'expired' ? -1 : 60)
      const state = await initialState(f)
      const response = await handleMcpRequest(
        request({
          state: fault === 'tampered' ? `${state}-tampered` : fault === 'non-string' ? {} : state,
          id: 'rejected-resume',
          ...(fault === 'principal' ? { token: 'bob-client-a' } : {}),
          ...(fault === 'client' ? { token: 'alice-client-b' } : {}),
          ...(fault === 'tool' ? { tool: 'other_review' } : {}),
          ...(fault === 'project' ? { project: 'project-b' } : {}),
        }),
        f.options,
      )
      expect(await response.json()).toMatchObject({
        id: 'rejected-resume',
        error: { code: -32602 },
      })
      expect(f.invoked).not.toHaveBeenCalled()
    },
  )

  it('uses the SDK sanitized failure without exposing verifier errors', async () => {
    const f = fixture()
    const response = await handleMcpRequest(request({ state: 'opaque' }), {
      ...f.options,
      requestState: () => ({
        verify() {
          throw new Error('private-provider-proof-sentinel')
        },
      }),
    })
    const body = await response.text()
    expect(body).toContain('Invalid or expired requestState')
    expect(body).not.toContain('private-provider-proof-sentinel')
    expect(f.invoked).not.toHaveBeenCalled()
  })

  it('does not construct the verifier for a rejected bearer', async () => {
    const f = fixture()
    const response = await handleMcpRequest(
      request({ token: 'invalid', state: 'opaque' }),
      f.options,
    )
    expect(response.status).toBe(401)
    expect(f.stateFactory).not.toHaveBeenCalled()
    expect(f.invoked).not.toHaveBeenCalled()
  })

  it('preserves the official raw-state behavior when no verifier is configured', async () => {
    const f = fixture()
    const { requestState: _unused, ...withoutVerification } = f.options
    const response = await handleMcpRequest(
      request({ state: 'unverified-state' }),
      withoutVerification,
    )
    expect(response.status).toBe(200)
    expect(f.invoked.mock.calls[0]?.[2]).toBe('unverified-state')
    expect(f.stateFactory).not.toHaveBeenCalled()
  })
})
