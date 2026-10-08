import type { McpDoorAuth, McpPrincipal } from '@lupinum/better-convex-agents/mcp'
import { componentsGeneric, makeFunctionReference, type FunctionReference } from 'convex/server'

// Fixtures of this package's own tests. Apps test with `callTool` from
// `@lupinum/better-convex-agents/test` and the real auth component from
// `@lupinum/better-convex-nuxt/better-auth/test`.

/**
 * `components.betterAuth` without codegen: the real Better Auth component that each fixture's
 * setup registers with `register` from `@lupinum/better-convex-nuxt/better-auth/test`.
 */
export const betterAuthComponent = componentsGeneric().betterAuth as never

/**
 * The MCP door's token check, faked for convex-test: a bearer token is the principal that
 * `grantMcp` returned, encoded by `tokenFor`. Everything after the token check is real: the
 * door, the tools, and `requireMcpPrincipal` against the Better Auth component, so a revoked
 * grant fails the next call.
 */
export const doorAuth: McpDoorAuth = {
  mcpAuthorization: () => ({
    resource: new URL('/mcp', process.env.CONVEX_SITE_URL),
    authorization: {
      mode: 'oauth',
      issuer: `${process.env.SITE_URL}/api/auth`,
      verifier: {
        async verifyAccessToken(token) {
          const principal = JSON.parse(atob(token)) as McpPrincipal
          const { issuer, userId: subject, clientId, resource, scopes, expiresAt } = principal
          return { access: { issuer, subject, clientId, resource, scopes }, expiresAt, principal }
        },
      },
    },
  }),
}

/** The bearer token `doorAuth` turns back into `principal`. */
export const tokenFor = (principal: McpPrincipal) => btoa(JSON.stringify(principal))

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
