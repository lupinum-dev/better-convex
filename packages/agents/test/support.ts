import type { McpDoorAuth, McpPrincipal } from '@lupinum/better-convex-agents/mcp'
import type { Auth } from '@lupinum/better-convex-functions'
import {
  makeFunctionReference,
  type FunctionReference,
  type GenericDataModel,
  type GenericQueryCtx,
} from 'convex/server'
import { ConvexError } from 'convex/values'

// Fixtures of this package's own tests. Apps test with `callTool` from
// `@lupinum/better-convex-agents/test` and the real auth component from
// `@lupinum/better-convex-nuxt/better-auth/test`.

// convex-test serves HTTP actions at this origin.
const testSite = 'https://some.convex.site'

/**
 * The auth component, faked for convex-test: one object for `defineFunctions({ auth })` and
 * `createMcpServer(auth, ...)`, as the real `auth` from `createBetterConvexAuth` is. A person
 * is `t.withIdentity({ subject: authId })`. A bearer token `<authId>:<scope>,<scope>` is a
 * connection of that user on the host `host`; everything after the token check is the real
 * door and tools. Like the real component, the connection is checked on every agent call, so
 * `revoke` ends it at the next call, and an access token past its `expiresAt` is refused.
 *
 * Create it in the module that calls `defineFunctions`, with the app's data model, and call
 * `reset()` when each test starts, since modules outlive it.
 */
export function testAuth<DM extends GenericDataModel>() {
  const revoked = new Set<string>()
  const auth: Auth<DM> & McpDoorAuth = {
    getUser: async (ctx: GenericQueryCtx<DM>) => {
      const identity = await ctx.auth.getUserIdentity()
      return identity ? { id: identity.subject } : null
    },
    requireMcpPrincipal: async (_ctx, principal, options) => {
      const expired = !options?.allowExpiredToken && principal.expiresAt * 1000 <= Date.now()
      if (expired || revoked.has(`${principal.userId}:${principal.clientId}`))
        throw new ConvexError({ code: 'MCP_ACCESS_DENIED', message: 'MCP access denied' })
      return { user: { id: principal.userId } }
    },
    mcpAuthorization: () => ({
      resource: new URL(`${testSite}/mcp`),
      authorization: {
        mode: 'oauth',
        issuer: testSite,
        scopesSupported: ['read', 'write'],
        verifier: {
          async verifyAccessToken(token, expected) {
            const [authId = '', scopeList = ''] = token.split(':')
            const scopes = scopeList ? scopeList.split(',') : []
            const expiresAt = Math.floor(Date.now() / 1000) + 600
            const principal: McpPrincipal = {
              kind: 'oauth',
              userId: authId,
              clientId: 'host',
              scopes,
              sessionId: 'session',
              grantId: 'grant',
              issuer: expected.issuer,
              resource: expected.resource.href,
              expiresAt,
            }
            const access = {
              issuer: expected.issuer,
              subject: authId,
              clientId: 'host',
              resource: expected.resource.href,
              scopes,
            }
            return { access, expiresAt, principal }
          },
        },
      },
    }),
  }
  return {
    auth,
    /** Ends a connection in the fake auth component: its next tool call fails. */
    revoke: (authId: string, clientId = 'host') => void revoked.add(`${authId}:${clientId}`),
    reset: () => revoked.clear(),
  }
}

/**
 * JSON-RPC over convex-test's HTTP router, as an MCP host sends it today (protocol
 * `2025-06-18`). `call` returns a tool's `structuredContent`: `{ status: 'done', result }`,
 * `{ status: 'needs_approval', approvalId, summary, url }`, or `{ error: { code, message } }`.
 * `mcp` returns the whole response, for other methods and protocol errors.
 */
export function mcpClient(
  t: { fetch(path: string, init?: RequestInit): Promise<Response> },
  path = '/mcp',
) {
  let next = 1
  async function mcp(token: string, method: string, params: Record<string, unknown> = {}) {
    const response = await t.fetch(path, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: next++, method, params }),
    })
    const raw = await response.text()
    return { status: response.status, raw, body: raw.startsWith('{') ? JSON.parse(raw) : null }
  }
  async function call(token: string, name: string, args: Record<string, unknown>) {
    const { body, raw } = await mcp(token, 'tools/call', { name, arguments: args })
    if (!body?.result) throw new Error(`No tool result: ${raw}`)
    return body.result.structuredContent
  }
  return { mcp, call }
}

/**
 * `internal.<module>` without codegen, for fixtures: a reference for any export name, as
 * `defineTools(..., { functions: refs('agents') })` needs.
 */
export function refs(module: string) {
  return new Proxy({} as Record<string, FunctionReference<'query' | 'mutation', 'internal'>>, {
    get: (_target, name) => makeFunctionReference<'mutation'>(`${module}:${String(name)}`) as never,
  })
}
