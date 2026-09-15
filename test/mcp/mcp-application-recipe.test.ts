import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { ConvexError, v } from 'convex/values'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc'
import { z } from 'zod'

import { handleMcpRequest } from '../../packages/mcp/src/handler'
import type { OAuthLiveAccess } from '../../src/runtime/convex-auth/oauth-live-access'
import { validateOAuthProviderProfile } from '../../src/runtime/convex-auth/oauth-security'

const recipe = readFileSync('docs/content/docs/4.build/7.agents/3.mcp-application.md', 'utf8')
const addresses = {
  issuer: 'https://notes.example/api/auth',
  resource: 'https://notes.convex.site/mcp',
}
const principal: OAuthLiveAccess = {
  ...addresses,
  subject: 'owner-1',
  clientId: 'client-1',
  sessionId: 'session-private',
  grantId: 'consent-private',
  scopes: ['mcp:read'],
}

/** Markdown is an untyped external boundary; callers assert the exported recipe contract here. */
function loadRecipe<T>(path: string, bindings: Record<string, unknown>): T {
  const block = recipe.split('```ts [' + path + ']\n')[1]?.split('\n```')[0]
  if (!block) throw new Error(`Missing executable recipe: ${path}`)
  const source = block.replace(/^import[\s\S]*?from '[^']+'\n/gm, '')
  const compiled = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
    },
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
    ...bindings,
  })
  return exports as T
}

describe('ordinary application MCP recipe', () => {
  it('uses a valid minimal provider profile and one existing auth factory', () => {
    const { mcpProfile } = loadRecipe<{
      mcpProfile: Parameters<typeof validateOAuthProviderProfile>[0]
    }>('convex/mcp/profile.ts', {
      MCP_SCOPES: ['mcp:read'],
      canAdministerMcp: () => false,
    })
    expect(() => validateOAuthProviderProfile(mcpProfile)).not.toThrow()
    expect(recipe).toContain('existing')
    expect(recipe).toContain('createBetterConvexAuth')
  })

  it('discovers and executes pagination without fixture IDs; rechecks live authority before reading', async () => {
    let live = true
    const checked: OAuthLiveAccess[] = []
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
          select({
            eq: (_field, value) => {
              selectedOwner = value
            },
          })
          return { order: () => ({ paginate }) }
        },
      })),
    }
    const authComponent = {
      validateOAuthAccess: async (_ctx: unknown, value: OAuthLiveAccess) => {
        checked.push(value)
        return live
      },
    }
    type ToolArgs = { cursor: string | null; principal: OAuthLiveAccess }
    const { listNotes } = loadRecipe<{
      listNotes: {
        handler: (ctx: { db: typeof db }, args: ToolArgs) => Promise<unknown>
      }
    }>('convex/mcpTools.ts', {
      ConvexError,
      v,
      authComponent,
      mcpAddresses: () => addresses,
      internalQuery: (definition: unknown) => definition,
    })
    const runQuery = vi.fn((_reference: unknown, args: ToolArgs) => listNotes.handler({ db }, args))
    const diagnostics = vi.fn()
    const { handleMcp } = loadRecipe<{
      handleMcp: (ctx: { runQuery: typeof runQuery }, request: Request) => Promise<Response>
    }>('convex/mcp.ts', {
      ConvexError,
      z,
      authComponent,
      handleMcpRequest,
      console: { error: diagnostics },
      MCP_SCOPES: ['mcp:read'],
      mcpAddresses: () => addresses,
      httpAction: (handler: unknown) => handler,
      internal: { mcpTools: { listNotes: 'internal-list-notes' } },
      createBetterAuthMcpAccessVerifier: (options: {
        validateLiveAccess: (value: OAuthLiveAccess) => Promise<boolean>
      }) => ({
        async verifyAccessToken() {
          // Preserve a valid resource token while the later protected transaction denies access.
          if (!(await options.validateLiveAccess(principal))) throw new Error('invalid')
          return {
            access: {
              issuer: principal.issuer,
              resource: principal.resource,
              subject: principal.subject,
              clientId: principal.clientId,
              scopes: [...principal.scopes],
            },
            expiresAt: Math.floor(Date.now() / 1000) + 300,
          }
        },
      }),
    })
    const bodies: string[] = []
    const client = new Client(
      { name: 'ordinary-recipe', version: '1' },
      {
        versionNegotiation: { mode: { pin: '2026-07-28' } },
      },
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
        annotations: { readOnlyHint: true },
        outputSchema: {},
      })
      expect(await client.callTool({ name: 'list_notes', arguments: {} })).toMatchObject({
        structuredContent: {
          notes: [{ id: 'note-1', title: 'A note' }],
          nextCursor: 'opaque-next',
        },
      })
      expect(selectedOwner).toBe('owner-1')
      expect(paginate).toHaveBeenLastCalledWith({ cursor: null, numItems: 20 })
      await client.callTool({
        name: 'list_notes',
        arguments: { cursor: 'opaque-next' },
      })
      expect(paginate).toHaveBeenLastCalledWith({
        cursor: 'opaque-next',
        numItems: 20,
      })
      expect(checked.length).toBeGreaterThanOrEqual(5)
      expect(runQuery.mock.calls[0]?.[1].principal.sessionId).toBe('session-private')
      expect(runQuery.mock.calls[0]?.[1].principal.grantId).toBe('consent-private')
      expect(bodies.join('')).not.toMatch(/session-private|consent-private|private-bearer|owner-1/)

      // Revocation races with the resource check: the internal read must still deny it.
      runQuery.mockImplementationOnce(async (_reference, args) => {
        live = false
        return listNotes.handler({ db }, args)
      })
      const readsBeforeDenial = paginate.mock.calls.length
      expect(await client.callTool({ name: 'list_notes', arguments: {} })).toMatchObject({
        isError: true,
      })
      expect(paginate).toHaveBeenCalledTimes(readsBeforeDenial)
      expect(diagnostics).not.toHaveBeenCalled()

      live = true
      runQuery.mockRejectedValueOnce(new Error('private-db-error'))
      expect(await client.callTool({ name: 'list_notes', arguments: {} })).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'Tool execution failed' }],
      })
      expect(diagnostics).toHaveBeenCalledWith('MCP tool failed', {
        name: 'list_notes',
      })
      expect(bodies.join('')).not.toContain('private-db-error')
    } finally {
      await client.close()
    }
  })

  it('compiles both OAuth pages and their shared form without another UI dependency', () => {
    for (const path of [
      'app/components/OAuthFlow.vue',
      'app/pages/oauth/login.vue',
      'app/pages/oauth/consent.vue',
    ]) {
      const source = recipe.split('```vue [' + path + ']\n')[1]?.split('\n```')[0]
      if (!source) throw new Error(`Missing Vue recipe: ${path}`)
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

  it('verifies transaction display data and rejects untrusted navigation', async () => {
    const fetch = vi.fn().mockResolvedValue({
      client_id: 'client-1',
      client_name: 'Verified client',
    })
    const assign = vi.fn()
    const { loadMcpTransaction, navigateOAuth } = loadRecipe<{
      loadMcpTransaction: (query: string, resource: string) => Promise<{ clientName: string }>
      navigateOAuth: (value: unknown, redirectUri: string) => void
    }>('app/utils/mcp-oauth.ts', {
      $fetch: fetch,
      window: { location: { origin: 'https://notes.example', assign } },
    })
    const query = new URLSearchParams({
      client_id: 'client-1',
      scope: 'mcp:read',
      resource: addresses.resource,
      redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      client_name: 'Attacker name',
    }).toString()
    expect(await loadMcpTransaction(query, addresses.resource)).toMatchObject({
      clientName: 'Verified client',
    })
    await expect(
      loadMcpTransaction(query + '&scope=mcp:write', addresses.resource),
    ).rejects.toThrow()
    await expect(loadMcpTransaction(query, 'https://foreign.example/mcp')).rejects.toThrow()
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
