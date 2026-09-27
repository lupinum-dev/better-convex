import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { handleMcpRequest, registerMcpTool } from '@lupinum/better-convex-mcp'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { ConvexError, v } from 'convex/values'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc'
import { z } from 'zod'

import {
  mcpPrincipalValidator,
  type BetterConvexMcpPrincipal,
} from '../../src/runtime/convex-auth/mcp-principal'
import { resolveMcpProfile } from '../../src/runtime/convex-auth/mcp-profile'
import { validateOAuthProviderProfile } from '../../src/runtime/convex-auth/oauth-security'

const recipe = readFileSync('docs/content/docs/3.build/7.agents/2.mcp-application.md', 'utf8')
const addresses = {
  issuer: 'https://notes.example/api/auth',
  resource: 'https://notes.convex.site/mcp',
}
const principal: BetterConvexMcpPrincipal = {
  kind: 'oauth',
  userId: 'owner-1',
  clientId: 'client-1',
  scopes: ['notes:read', 'offline_access'],
  sessionId: 'session-private',
  grantId: 'consent-private',
  issuer: addresses.issuer,
  resource: addresses.resource,
  expiresAt: Math.floor(Date.now() / 1_000) + 300,
}

function block(path: string, language = 'ts'): string {
  const source = recipe.split('```' + language + ' [' + path + ']\n')[1]?.split('\n```')[0]
  if (!source) throw new Error(`Missing recipe block: ${path}`)
  return source
}

/** Markdown is an untyped external boundary; callers assert the exported recipe contract here. */
function loadRecipe<T>(path: string, bindings: Record<string, unknown>): T {
  const source = block(path).replace(/^import[\s\S]*?from '[^']+'\n/gm, '')
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    reportDiagnostics: true,
  })
  expect(compiled.diagnostics).toEqual([])
  const exports: Record<string, unknown> = {}
  runInNewContext(compiled.outputText, {
    exports,
    URL,
    URLSearchParams,
    Error,
    Boolean,
    JSON,
    Object,
    ...bindings,
  })
  return exports as T
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MCP application recipe', () => {
  it('configures a valid MCP OAuth profile with renewal', () => {
    const { MCP_SCOPES } = loadRecipe<{ MCP_SCOPES: Record<string, string> }>(
      'convex/mcpScopes.ts',
      {},
    )
    // The auth block is one property of the existing factory options.
    const options = runInNewContext(`({\n${block('convex/auth.ts')}\n})`, { MCP_SCOPES }) as {
      oauth: { mcp: unknown }
    }
    const profile = resolveMcpProfile(options.oauth.mcp)
    expect(() => validateOAuthProviderProfile(profile.provider)).not.toThrow()
    expect(profile).toMatchObject({
      hosts: ['chatgpt', 'claude'],
      loginPage: '/oauth/login',
      renewal: true,
      scopes: { 'notes:read': 'Read your notes.' },
    })
    expect(profile.provider.scopes).toEqual(['notes:read', 'offline_access'])
  })

  it('discovers and pages notes; the internal function denies a revoked grant before reading', async () => {
    let live = true
    const checks: Array<{ principal: BetterConvexMcpPrincipal; scope?: string }> = []
    let selectedOwner: string | undefined
    const paginate = vi.fn().mockResolvedValue({
      page: [{ _id: 'note-1', title: 'A note' }],
      isDone: false,
      continueCursor: 'opaque-next',
    })
    const db = {
      query: vi.fn(() => ({
        withIndex: (
          _name: string,
          select: (query: { eq: (field: string, value: string) => void }) => void,
        ) => {
          select({ eq: (_field, value) => void (selectedOwner = value) })
          return { order: () => ({ paginate }) }
        },
      })),
    }
    const auth = {
      mcp: {
        issuer: () => addresses.issuer,
        resource: () => new URL(addresses.resource),
        scopes: () => ({ 'notes:read': 'Read your notes.' }),
        scopesSupported: () => ['notes:read', 'offline_access'],
      },
      createMcpAccessVerifier: () => ({
        async verifyAccessToken(token: string) {
          if (token !== 'private-bearer') throw new Error('invalid')
          return {
            access: {
              issuer: principal.issuer,
              subject: principal.userId,
              clientId: principal.clientId,
              resource: principal.resource,
              scopes: principal.scopes,
            },
            principal,
            expiresAt: principal.expiresAt,
          }
        },
      }),
      async requireMcpPrincipal(
        _ctx: unknown,
        value: BetterConvexMcpPrincipal,
        options: { scope?: string },
      ) {
        checks.push({ principal: value, scope: options.scope })
        if (!live) throw new ConvexError({ code: 'MCP_ACCESS_DENIED', message: 'Access denied.' })
        return { user: { id: value.userId }, principal: value }
      },
    }
    type ToolArgs = { cursor: string | null; principal: BetterConvexMcpPrincipal }
    const { listNotes } = loadRecipe<{
      listNotes: {
        args: Record<string, unknown>
        handler: (ctx: unknown, args: ToolArgs) => unknown
      }
    }>('convex/notes.ts', {
      auth,
      v,
      mcpPrincipalValidator,
      internalQuery: (definition: unknown) => definition,
    })
    expect(listNotes.args.principal).toBe(mcpPrincipalValidator)
    const runQuery = vi.fn((_reference: unknown, args: ToolArgs) => listNotes.handler({ db }, args))
    const diagnostics = vi.fn()
    const { handleMcp } = loadRecipe<{
      handleMcp: (ctx: { runQuery: typeof runQuery }, request: Request) => Promise<Response>
    }>('convex/mcp.ts', {
      auth,
      z,
      handleMcpRequest,
      registerMcpTool,
      console: { error: diagnostics },
      httpAction: (handler: unknown) => handler,
      internal: { notes: { listNotes: 'internal-list-notes' } },
    })
    const bodies: string[] = []
    const client = new Client(
      { name: 'recipe', version: '1' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    await client.connect(
      new StreamableHTTPClientTransport(new URL(addresses.resource), {
        requestInit: { headers: { authorization: 'Bearer private-bearer' } },
        fetch: async (input, init) => {
          const response = await handleMcp({ runQuery }, new Request(input, init))
          bodies.push(await response.clone().text())
          return response
        },
      }),
    )
    try {
      const tools = (await client.listTools()).tools
      expect(tools).toHaveLength(1)
      expect(tools[0]).toMatchObject({
        name: 'list_notes',
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        outputSchema: {},
        _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['notes:read'] }] },
      })
      expect(await client.callTool({ name: 'list_notes', arguments: {} })).toMatchObject({
        structuredContent: {
          notes: [{ id: 'note-1', title: 'A note' }],
          nextCursor: 'opaque-next',
        },
      })
      expect(selectedOwner).toBe('owner-1')
      expect(paginate).toHaveBeenLastCalledWith({ cursor: null, numItems: 20 })
      await client.callTool({ name: 'list_notes', arguments: { cursor: 'opaque-next' } })
      expect(paginate).toHaveBeenLastCalledWith({ cursor: 'opaque-next', numItems: 20 })
      expect(checks).toEqual([
        { principal, scope: 'notes:read' },
        { principal, scope: 'notes:read' },
      ])
      expect(bodies.join('')).not.toMatch(/session-private|consent-private|private-bearer|owner-1/)

      live = false
      const readsBeforeDenial = paginate.mock.calls.length
      expect(await client.callTool({ name: 'list_notes', arguments: {} })).toMatchObject({
        isError: true,
        structuredContent: { error: { code: 'MCP_ACCESS_DENIED', message: 'Access denied.' } },
      })
      expect(paginate).toHaveBeenCalledTimes(readsBeforeDenial)
      expect(diagnostics).toHaveBeenLastCalledWith('MCP tool failed', {
        name: 'list_notes',
        code: 'MCP_ACCESS_DENIED',
      })

      live = true
      runQuery.mockRejectedValueOnce(new Error('private-db-error'))
      expect(await client.callTool({ name: 'list_notes', arguments: {} })).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'Tool execution failed' }],
      })
      expect(diagnostics).toHaveBeenLastCalledWith('MCP tool failed', {
        name: 'list_notes',
        code: undefined,
      })
      expect(bodies.join('')).not.toContain('private-db-error')
    } finally {
      await client.close()
    }
  })

  it('manages only the signed-in user’s connections and keeps provisioning internal', async () => {
    const calls: unknown[] = []
    const auth = {
      requireUser: async () => ({ id: 'owner-1' }),
      oauthConnections: {
        list: async (_ctx: unknown, input: unknown) => (calls.push(['list', input]), []),
        revoke: async (_ctx: unknown, input: unknown) => (
          calls.push(['revoke', input]),
          { revoked: true }
        ),
      },
      oauthOperator: {
        createHostClient: async (_ctx: unknown, input: unknown) => (
          calls.push(['createHostClient', input]),
          { clientId: 'client-2' }
        ),
      },
    }
    type Fn = { args: Record<string, unknown>; handler: (ctx: unknown, args: never) => unknown }
    const kinds: Record<string, string> = {}
    const define = (kind: string) => (definition: Fn) => ({ ...definition, kind })
    const connections = loadRecipe<
      Record<'list' | 'revoke' | 'createHostClient', Fn & { kind: string }>
    >('convex/connections.ts', {
      auth,
      v,
      query: define('query'),
      mutation: define('mutation'),
      internalMutation: define('internalMutation'),
    })
    for (const [name, fn] of Object.entries(connections)) kinds[name] = fn.kind
    expect(kinds).toEqual({
      list: 'query',
      revoke: 'mutation',
      createHostClient: 'internalMutation',
    })
    expect(Object.keys(connections.revoke.args)).toEqual(['clientId'])
    await connections.list.handler({}, {} as never)
    await connections.revoke.handler({}, { clientId: 'client-1' } as never)
    await connections.createHostClient.handler({}, { host: 'claude' } as never)
    expect(calls).toEqual([
      ['list', { userId: 'owner-1' }],
      ['revoke', { userId: 'owner-1', clientId: 'client-1' }],
      ['createHostClient', { host: 'claude' }],
    ])
  })

  it('compiles the OAuth pages, their shared form, and the connections page', () => {
    for (const path of [
      'app/components/OAuthFlow.vue',
      'app/pages/oauth/login.vue',
      'app/pages/oauth/consent.vue',
      'app/pages/settings/connections.vue',
    ]) {
      const source = block(path, 'vue')
      const { descriptor, errors } = parse(source, { filename: path })
      expect(errors).toEqual([])
      if (descriptor.scriptSetup) {
        expect(() => compileScript(descriptor, { id: path })).not.toThrow()
      }
      expect(
        compileTemplate({ source: descriptor.template!.content, filename: path, id: path }).errors,
      ).toEqual([])
    }
  })

  it('verifies transaction display data and scopes, and rejects untrusted navigation', async () => {
    const fetch = vi.fn().mockResolvedValue({
      client_id: 'client-1',
      client_name: 'Verified client',
    })
    const assign = vi.fn()
    const { loadMcpTransaction, navigateOAuth } = loadRecipe<{
      loadMcpTransaction: (
        query: string,
        resource: string,
      ) => Promise<{ clientName: string; scopes: string[] }>
      navigateOAuth: (value: unknown, redirectUri: string) => void
    }>('app/utils/mcp-oauth.ts', {
      $fetch: fetch,
      window: { location: { origin: 'https://notes.example', assign } },
    })
    const query = (scope: string) =>
      new URLSearchParams({
        client_id: 'client-1',
        scope,
        resource: addresses.resource,
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        client_name: 'Attacker name',
      }).toString()
    await expect(
      loadMcpTransaction(query('notes:read'), addresses.resource),
    ).resolves.toMatchObject({ clientName: 'Verified client', scopes: ['notes:read'] })
    await expect(
      loadMcpTransaction(query('notes:read offline_access'), addresses.resource),
    ).resolves.toMatchObject({ scopes: ['notes:read', 'offline_access'] })
    for (const scope of ['offline_access', 'notes:read notes:write', 'notes:read notes:read']) {
      await expect(loadMcpTransaction(query(scope), addresses.resource)).rejects.toThrow()
    }
    await expect(
      loadMcpTransaction(query('notes:read') + '&scope=notes:write', addresses.resource),
    ).rejects.toThrow()
    await expect(
      loadMcpTransaction(query('notes:read'), 'https://foreign.example/mcp'),
    ).rejects.toThrow()
    expect(() =>
      navigateOAuth('javascript:alert(1)', 'https://chatgpt.com/connector_platform_oauth_redirect'),
    ).toThrow()
    expect(() =>
      navigateOAuth(
        'https://attacker.example',
        'https://chatgpt.com/connector_platform_oauth_redirect',
      ),
    ).toThrow()
    navigateOAuth(
      '/oauth/consent?signed=opaque',
      'https://chatgpt.com/connector_platform_oauth_redirect',
    )
    expect(assign).toHaveBeenCalledExactlyOnceWith(
      'https://notes.example/oauth/consent?signed=opaque',
    )
  })
})
