import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import {
  McpUiResourceMetaSchema,
  McpUiToolMetaSchema,
} from '@modelcontextprotocol/ext-apps/app-bridge'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { proveNotesDashboardBrowserBoundary } from '../../internal/labs/mcp-topology/apps/notes-dashboard/browser-proof'
import { buildNotesDashboard } from '../../internal/labs/mcp-topology/apps/notes-dashboard/build'
import {
  interactionLocatorFromPath,
  interactionPath,
  interactionUrl,
  isInteractionLocator,
} from '../../internal/labs/mcp-topology/convex/fixture/convex/interaction_page_contract'
import { NeutralNotesApplication } from '../../internal/labs/mcp-topology/neutral/notes-application'
import { noteSchema } from '../../internal/labs/mcp-topology/neutral/notes-schemas'
import { createConvexMcpHandler } from '../../packages/mcp/src/handler'

const RESOURCE = new URL('https://mcp-apps.invalid/mcp')
const ISSUER = 'https://mcp-apps.invalid/credentials/'
const TOKEN = 'convex-apps-token-must-not-escape'
const NOTES_DASHBOARD_RESOURCE_URI = 'ui://notes/dashboard.html'
const NOTES_DASHBOARD_RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app'
const ACTOR = Object.freeze({ role: 'owner' as const, subject: 'alice', tenantId: 'tenant-a' })
const notesDashboardResourceMeta = Object.freeze({
  ui: Object.freeze({
    csp: Object.freeze({
      baseUriDomains: Object.freeze([]),
      connectDomains: Object.freeze([]),
      frameDomains: Object.freeze([]),
      resourceDomains: Object.freeze([]),
    }),
    permissions: Object.freeze({}),
    prefersBorder: true,
  }),
})

function createApplication(): NeutralNotesApplication {
  return new NeutralNotesApplication(
    {
      notes: [
        {
          body: 'Alpha body',
          id: 'note-a',
          title: 'Alpha',
          workspaceId: 'workspace-a',
        },
        {
          body: 'Cross-tenant body must not escape',
          id: 'note-b',
          title: 'CROSS TENANT SECRET',
          workspaceId: 'workspace-b',
        },
      ],
      workspaces: [
        { id: 'workspace-a', name: 'Workspace A', tenantId: 'tenant-a' },
        { id: 'workspace-b', name: 'Workspace B', tenantId: 'tenant-b' },
      ],
    },
    () => 1_800_000_000_000,
  )
}

function connectClient(
  handler: ReturnType<typeof createConvexMcpHandler<NeutralNotesApplication>>,
  supportsApps: boolean,
): { client: Client; connect: Promise<void>; requestBodies: string[]; responseBodies: string[] } {
  const requestBodies: string[] = []
  const responseBodies: string[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    requestBodies.push(await request.clone().text())
    const headers = new Headers(request.headers)
    headers.set('authorization', `Bearer ${TOKEN}`)
    const response = await handler.fetch(createApplication(), new Request(request, { headers }))
    responseBodies.push(await response.clone().text())
    return response
  }
  const transport = new StreamableHTTPClientTransport(RESOURCE, {
    fetch,
  })
  const client = new Client(
    { name: supportsApps ? 'apps-capable-client' : 'baseline-client', version: '0.0.0' },
    {
      ...(supportsApps
        ? {
            capabilities: {
              extensions: {
                'io.modelcontextprotocol/ui': {
                  mimeTypes: [NOTES_DASHBOARD_RESOURCE_MIME_TYPE],
                },
              },
            },
          }
        : {}),
      versionNegotiation: { mode: { pin: '2026-07-28' as const } },
    },
  )
  return { client, connect: client.connect(transport), requestBodies, responseBodies }
}

function createHandler(appHtml: string, isRevoked: () => boolean, onSearch: () => void) {
  return createConvexMcpHandler<NeutralNotesApplication>({
    serverInfo: { name: 'better-convex-apps-probe', version: '0.0.0' },
    resource: RESOURCE,
    authorization: { mode: 'preconfigured-bearer', issuer: ISSUER },
    verifier: {
      async verifyAccessToken(token, expectedResource) {
        if (token !== TOKEN || expectedResource.href !== RESOURCE.href || isRevoked()) {
          throw new Error('invalid')
        }
        return {
          access: {
            clientId: 'apps-client',
            issuer: ISSUER,
            resource: RESOURCE.href,
            scopes: ['notes:read', 'notes:write'],
            subject: ACTOR.subject,
          },
          expiresAt: Math.floor(Date.now() / 1_000) + 300,
        }
      },
    },
    configureServer(application, _access, server) {
      server.registerTool(
        'search_notes',
        {
          inputSchema: z
            .object({
              limit: z.number().int().min(1).max(50).optional(),
              query: z.string().max(200),
              workspaceId: z.string(),
            })
            .strict(),
          outputSchema: z.object({ matches: z.array(noteSchema) }),
          _meta: {
            ui: {
              resourceUri: NOTES_DASHBOARD_RESOURCE_URI,
              visibility: ['model', 'app'],
            },
          },
        },
        async (input) => {
          onSearch()
          const output = { matches: await application.searchNotes(ACTOR, input) }
          return {
            content: [{ type: 'text', text: `${output.matches.length} note matched.` }],
            structuredContent: output,
          }
        },
      )
      server.registerResource(
        'notes-dashboard',
        NOTES_DASHBOARD_RESOURCE_URI,
        {
          _meta: notesDashboardResourceMeta,
          mimeType: NOTES_DASHBOARD_RESOURCE_MIME_TYPE,
        },
        async (uri) => ({
          contents: [
            {
              _meta: notesDashboardResourceMeta,
              mimeType: NOTES_DASHBOARD_RESOURCE_MIME_TYPE,
              text: appHtml,
              uri: uri.href,
            },
          ],
        }),
      )
    },
  })
}

describe('vNext MCP Apps private topology probe', () => {
  it('derives interaction paths, URLs, and locator validation from one contract', () => {
    const locator = 'a'.repeat(32)
    expect(isInteractionLocator(locator)).toBe(true)
    expect(interactionPath(locator)).toBe(`/interactions/${locator}`)
    expect(interactionUrl(locator)).toBe(`https://notes.example.invalid/interactions/${locator}`)
    expect(interactionLocatorFromPath(interactionPath(locator))).toBe(locator)
    expect(interactionLocatorFromPath(`/interactions/${'a'.repeat(31)}`)).toBeNull()
    expect(() => interactionPath('../outside')).toThrow('INTERACTION_LOCATOR_INVALID')
  })

  it('serves one credential-free Vue App with useful fallback through the selected package', async () => {
    const build = await buildNotesDashboard()
    let revoked = false
    let searchExecutions = 0
    const handler = createHandler(
      build.appHtml,
      () => revoked,
      () => {
        searchExecutions += 1
      },
    )
    const supported = connectClient(handler, true)
    const unsupported = connectClient(handler, false)

    try {
      await Promise.all([supported.connect, unsupported.connect])

      const [supportedTools, unsupportedTools] = await Promise.all([
        supported.client.listTools(),
        unsupported.client.listTools(),
      ])
      const supportedSearch = supportedTools.tools.find((tool) => tool.name === 'search_notes')
      const unsupportedSearch = unsupportedTools.tools.find((tool) => tool.name === 'search_notes')
      expect(supportedSearch?._meta).toEqual({
        ui: {
          resourceUri: NOTES_DASHBOARD_RESOURCE_URI,
          visibility: ['model', 'app'],
        },
      })
      expect(unsupportedSearch?._meta).toEqual(supportedSearch?._meta)
      expect(
        McpUiToolMetaSchema.parse((supportedSearch?._meta as { ui?: unknown } | undefined)?.ui),
      ).toEqual(supportedSearch?._meta?.ui)

      const [dashboard, baselineDashboard, listedResources] = await Promise.all([
        supported.client.readResource({ uri: NOTES_DASHBOARD_RESOURCE_URI }),
        unsupported.client.readResource({ uri: NOTES_DASHBOARD_RESOURCE_URI }),
        supported.client.listResources(),
      ])
      expect(baselineDashboard).toEqual(dashboard)
      expect(listedResources.resources).toContainEqual({
        _meta: notesDashboardResourceMeta,
        mimeType: NOTES_DASHBOARD_RESOURCE_MIME_TYPE,
        name: 'notes-dashboard',
        uri: NOTES_DASHBOARD_RESOURCE_URI,
      })
      expect(dashboard.contents).toHaveLength(1)
      const dashboardContent = dashboard.contents[0]!
      expect(dashboardContent).toEqual({
        _meta: {
          ui: {
            csp: {
              baseUriDomains: [],
              connectDomains: [],
              frameDomains: [],
              resourceDomains: [],
            },
            permissions: {},
            prefersBorder: true,
          },
        },
        mimeType: NOTES_DASHBOARD_RESOURCE_MIME_TYPE,
        text: build.appHtml,
        uri: NOTES_DASHBOARD_RESOURCE_URI,
      })
      expect(
        McpUiResourceMetaSchema.parse((dashboardContent._meta as { ui?: unknown } | undefined)?.ui),
      ).toEqual(dashboardContent._meta?.ui)
      await expect(
        unsupported.client.readResource({ uri: 'ui://notes/not-registered.html' }),
      ).rejects.toThrow()

      const fallback = await unsupported.client.callTool({
        arguments: { query: 'alpha', workspaceId: 'workspace-a' },
        name: 'search_notes',
      })
      expect(fallback).toEqual({
        _meta: {
          'io.modelcontextprotocol/serverInfo': {
            name: 'better-convex-apps-probe',
            version: '0.0.0',
          },
        },
        content: [{ type: 'text', text: '1 note matched.' }],
        structuredContent: {
          matches: [
            {
              body: 'Alpha body',
              id: 'note-a',
              revision: 1,
              title: 'Alpha',
              uri: 'note://note-a',
              workspaceId: 'workspace-a',
            },
          ],
        },
      })
      searchExecutions = 0
      const proof = await proveNotesDashboardBrowserBoundary({
        build,
        callTool: async (call) => {
          if (call.arguments?.query === 'revoked') revoked = true
          try {
            return await supported.client.callTool(call)
          } catch {
            return {
              content: [{ type: 'text', text: 'Authentication failed.' }],
              isError: true,
            }
          }
        },
      })
      expect(proof.appHtmlBytes).toBeGreaterThan(0)
      expect(proof.appHtmlBytes).toBeLessThanOrEqual(288 * 1024)
      expect(proof.toolCalls).toEqual([
        {
          arguments: { limit: 5, query: 'alpha', workspaceId: 'workspace-a' },
          name: 'search_notes',
        },
        {
          arguments: { limit: 5, query: '', workspaceId: 'workspace-b' },
          name: 'search_notes',
        },
        {
          arguments: { limit: 5, query: 'revoked', workspaceId: 'workspace-a' },
          name: 'search_notes',
        },
      ])
      expect(searchExecutions).toBe(2)

      const appModules = build.appModules.join('\n')
      expect(appModules).toMatch(/node_modules\/\.pnpm\/@vue\+/u)
      expect(appModules).toContain('@modelcontextprotocol/ext-apps')
      expect(build.appModules.filter((moduleId) => moduleId.includes('/zod/v4/locales/'))).toEqual([
        expect.stringMatching(/\/zod\/v4\/locales\/en\.js$/u),
      ])
      expect(build.appHtml).toContain(
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'",
      )
      expect(build.appHtml).not.toContain('unsafe-eval')
      expect(build.appHtml).not.toContain('allow-same-origin')
      expect(build.appHtml).not.toContain('allow-popups')
      expect(build.appHtml).not.toContain('allow-forms')
      for (const moduleId of build.appModules) {
        expect(moduleId).not.toContain('/src/runtime/')
        expect(moduleId).not.toContain('@modelcontextprotocol/sdk/dist/esm/client/')
        expect(moduleId).not.toMatch(
          /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:@modelcontextprotocol\/(?:client|server)|better-auth|convex|h3|nitro|nuxt)(?:\/|$)/u,
        )
      }
      for (const moduleId of build.hostModules) {
        expect(moduleId).not.toContain('/src/runtime/')
        expect(moduleId).not.toMatch(
          /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:@modelcontextprotocol\/(?:client|server)|better-auth|convex|h3|nitro|nuxt)(?:\/|$)/u,
        )
      }
      expect(build.appHtml).not.toContain(TOKEN)
      expect(JSON.stringify(dashboard)).not.toContain(TOKEN)
      expect([...supported.responseBodies, ...unsupported.responseBodies].join('\n')).not.toContain(
        TOKEN,
      )

      const supportedDiscover = supported.requestBodies
        .map((body) => JSON.parse(body) as { method?: string })
        .find((request) => request.method === 'server/discover')
      const unsupportedDiscover = unsupported.requestBodies
        .map((body) => JSON.parse(body) as { method?: string })
        .find((request) => request.method === 'server/discover')
      expect(supportedDiscover).toMatchObject({
        method: 'server/discover',
        params: {
          _meta: {
            'io.modelcontextprotocol/clientCapabilities': {
              extensions: {
                'io.modelcontextprotocol/ui': {
                  mimeTypes: [NOTES_DASHBOARD_RESOURCE_MIME_TYPE],
                },
              },
            },
          },
        },
      })
      expect(unsupportedDiscover).toMatchObject({
        method: 'server/discover',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          },
        },
      })
      expect(JSON.stringify(unsupportedDiscover)).not.toContain('io.modelcontextprotocol/ui')
    } finally {
      await Promise.allSettled([supported.client.close(), unsupported.client.close()])
    }
  }, 120_000)
})
