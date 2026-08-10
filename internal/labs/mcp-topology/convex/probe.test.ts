import { execFileSync } from 'node:child_process'
import {
  copyFile,
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  Client,
  SERVER_INFO_META_KEY,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import {
  McpUiResourceMetaSchema,
  McpUiToolMetaSchema,
} from '@modelcontextprotocol/ext-apps/app-bridge'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { inspectConsumerCandidate } from '../../../../scripts/package-consumer-candidate.mjs'
import {
  ensureLocalConvex,
  type EnsureLocalConvexResult,
} from '../../../../test/helpers/local-convex'
import { proveNotesDashboardBrowserBoundary } from '../apps/notes-dashboard/browser-proof'
import { buildNotesDashboard } from '../apps/notes-dashboard/build'
import { topologyConformanceVectors } from '../conformance-vectors'
import {
  abortRawHttp,
  chunkedBody,
  exchangeRawHttp,
  rawHttpRequest,
  rcDiscoverBody,
} from '../http-adversarial'
import { formatLatencySummary, measureSequentialLatency } from '../latency-measure'
import {
  LAB_OAUTH_ISSUER,
  LAB_OAUTH_SCOPES,
  LAB_OAUTH_TOKENS,
  labOAuthResourceMetadataUrl,
} from '../oauth-fixture'
import { runOfficialMcpToolProbe } from '../official-tools'
import {
  interactionLocatorFromPath,
  interactionUrl,
  INTERACTION_LAB_SESSIONS,
  INTERACTION_ORIGIN,
  INTERACTION_PATH_PREFIX,
  INTERACTION_SESSION_COOKIE,
} from './fixture/convex/interaction_page_contract'
import { proveInteractionBrowserBoundary } from './interaction-browser-proof'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const sourceFixture = fileURLToPath(new URL('./fixture', import.meta.url))
const sharedOAuthFixture = fileURLToPath(new URL('../oauth-fixture.ts', import.meta.url))
const OWNER_TOKEN = LAB_OAUTH_TOKENS.alice
const EDITOR_TOKEN = LAB_OAUTH_TOKENS.bob
const managedEnvironmentNames = [
  'CONVEX_DEPLOYMENT',
  'CONVEX_E2E_AUTO_START',
  'CONVEX_SITE_URL',
  'CONVEX_URL',
  'NUXT_PUBLIC_CONVEX_SITE_URL',
  'NUXT_PUBLIC_CONVEX_URL',
] as const

let fixtureDirectory = ''
let local: EnsureLocalConvexResult | undefined
let notesDashboardHtml = ''
let packedCandidate: ReturnType<typeof inspectConsumerCandidate> | undefined
const savedEnvironment = new Map<string, string | undefined>()

function saveAndSetLabEnvironment(): void {
  for (const name of managedEnvironmentNames) {
    savedEnvironment.set(name, process.env[name])
    Reflect.deleteProperty(process.env, name)
  }
  process.env.CONVEX_E2E_AUTO_START = 'true'
}

function restoreEnvironment(): void {
  for (const [name, value] of savedEnvironment) {
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
}

async function materializeFixture(appHtml: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'better-convex-vnext-mcp-'))
  await cp(sourceFixture, directory, { recursive: true })
  await cp(sharedOAuthFixture, path.join(directory, 'convex', 'oauth_fixture.ts'))
  await writeFile(
    path.join(directory, 'convex', 'notes_dashboard.ts'),
    `export const NOTES_DASHBOARD_HTML = ${JSON.stringify(appHtml)}\n`,
  )
  const suppliedTarball = process.env.BCN_MCP_RELEASE_TARBALL
  if (suppliedTarball) {
    const tarballPath = await realpath(path.resolve(root, suppliedTarball))
    if (!(await stat(tarballPath)).isFile() || !tarballPath.endsWith('.tgz')) {
      throw new Error('BCN_MCP_RELEASE_TARBALL must reference one existing .tgz file')
    }
    const localTarball = path.join(directory, 'better-convex-mcp.tgz')
    await copyFile(tarballPath, localTarball)
    const manifestPath = path.join(directory, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies: Record<string, string>
    }
    manifest.dependencies['better-convex-mcp'] = 'file:./better-convex-mcp.tgz'
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    execFileSync('pnpm', ['install', '--no-frozen-lockfile', '--ignore-scripts'], {
      cwd: directory,
      stdio: 'inherit',
    })
    const lock = await readFile(path.join(directory, 'pnpm-lock.yaml'), 'utf8')
    if (!lock.includes('better-convex-mcp.tgz')) {
      throw new Error('External Convex consumer lock omitted the exact MCP tarball')
    }
    packedCandidate = inspectConsumerCandidate({
      packageId: 'mcp',
      packageName: 'better-convex-mcp',
      tarballPath,
    })
    packedCandidate.assertInstalled(path.join(directory, 'node_modules/better-convex-mcp'))
  } else {
    await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir')
  }
  return directory
}

function connectClient(
  siteUrl: string,
  token: string,
  name: string,
  responseBodies: string[],
  supportsApps: boolean,
  supportsUrlInteraction = false,
): { client: Client; connect: Promise<void>; requestBodies: string[] } {
  const requestBodies: string[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    requestBodies.push(await request.clone().text())
    const response = await globalThis.fetch(request)
    responseBodies.push(await response.clone().text())
    return response
  }
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', siteUrl), {
    authProvider: { token: async () => token },
    fetch,
  })
  const client = new Client(
    { name, version: '0.0.0' },
    {
      ...((supportsApps || supportsUrlInteraction) && {
        capabilities: {
          ...(supportsUrlInteraction ? { elicitation: { url: {} } } : {}),
          ...(supportsApps
            ? {
                extensions: {
                  'io.modelcontextprotocol/ui': {
                    mimeTypes: ['text/html;profile=mcp-app'],
                  },
                },
              }
            : {}),
        },
      }),
      versionNegotiation: { mode: { pin: '2026-07-28' as const } },
    },
  )
  return { client, connect: client.connect(transport), requestBodies }
}

beforeAll(async () => {
  saveAndSetLabEnvironment()
  notesDashboardHtml = (await buildNotesDashboard()).appHtml
  fixtureDirectory = await materializeFixture(notesDashboardHtml)
  local = await ensureLocalConvex({
    cwd: fixtureDirectory,
    requireAuthDeployment: false,
    timeoutMs: 90_000,
  })

  const convex = new ConvexHttpClient(local.env.CONVEX_URL!)
  const seed = makeFunctionReference<'mutation', { resource: string }, { seeded: boolean }>(
    'fixture:seed',
  )
  expect(
    await convex.mutation(seed, {
      resource: new URL('/mcp', local.env.CONVEX_SITE_URL!).href,
    }),
  ).toEqual({ seeded: true })
})

afterAll(async () => {
  try {
    await local?.release()
  } finally {
    packedCandidate?.cleanup()
    restoreEnvironment()
    if (fixtureDirectory) await rm(fixtureDirectory, { force: true, recursive: true })
  }
})

describe('vNext Convex-native MCP topology probe', () => {
  it('executes the official SDK in a Convex HTTP action with current database authority', async () => {
    if (!local) throw new Error('Local Convex fixture is not ready')
    const fixtureManifest = JSON.parse(
      await readFile(path.join(sourceFixture, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    const mcpManifest = JSON.parse(
      await readFile(path.join(root, 'packages/mcp/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> }
    const rootManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>
    }
    expect(fixtureManifest.dependencies).toEqual({
      'better-convex-mcp': '0.1.0-beta.19',
      '@modelcontextprotocol/server': mcpManifest.dependencies['@modelcontextprotocol/server'],
      convex: rootManifest.peerDependencies.convex,
      zod: '4.3.6',
    })
    const sources = await Promise.all(
      ['fixture.ts', 'http.ts', 'mcp.ts', 'operations.ts', 'schema.ts', 'notes_dashboard.ts'].map(
        (file) => readFile(path.join(sourceFixture, 'convex', file), 'utf8'),
      ),
    )
    const httpSource = sources[1]!
    const mcpSource = sources[2]!
    const operationsSource = sources[3]!
    const notesDashboardSource = sources[5]!
    const fixtureSource = sources.join('\n') + (await readFile(sharedOAuthFixture, 'utf8'))
    expect(fixtureSource.includes("from 'node:")).toBe(false)
    expect(fixtureSource.includes('@modelcontextprotocol/client')).toBe(false)
    expect(fixtureSource.includes('polyfill')).toBe(false)
    expect(httpSource).not.toContain('/api/auth/get-session')
    expect(httpSource.match(/handler: handleMcp/gu)).toHaveLength(3)
    expect(httpSource.match(/handler: handleOAuthMetadata/gu)).toHaveLength(3)
    expect(httpSource).toContain(
      "method: 'OPTIONS',\n  path: '/.well-known/oauth-protected-resource/mcp'",
    )
    expect(mcpSource.match(/handleMcpRequest/gu)).toHaveLength(2)
    expect(mcpSource).not.toContain('createMcpHandler')
    expect(mcpSource).not.toContain('requireLabOAuthAccess')
    expect(operationsSource).not.toMatch(/\b(?:AuthInfo|Request|authorization|bearer|token)\b/iu)
    expect(notesDashboardSource).toContain(
      "export const NOTES_DASHBOARD_HTML = '__BCN_NOTES_DASHBOARD_BUILD_REQUIRED__'",
    )
    expect(notesDashboardSource).not.toContain('<!doctype html>')

    const responsesA: string[] = []
    const responsesB: string[] = []
    const responsesReadOnly: string[] = []
    const responsesModern: string[] = []
    const connectionA = connectClient(
      local.env.CONVEX_SITE_URL!,
      OWNER_TOKEN,
      'convex-owner-client',
      responsesA,
      true,
      true,
    )
    const connectionB = connectClient(
      local.env.CONVEX_SITE_URL!,
      EDITOR_TOKEN,
      'convex-editor-client',
      responsesB,
      false,
    )
    const connectionReadOnly = connectClient(
      local.env.CONVEX_SITE_URL!,
      LAB_OAUTH_TOKENS.readOnly,
      'convex-read-only-client',
      responsesReadOnly,
      false,
    )
    const connectionModern = connectClient(
      local.env.CONVEX_SITE_URL!,
      OWNER_TOKEN,
      'convex-modern-client',
      responsesModern,
      false,
    )

    try {
      await Promise.all([
        connectionA.connect,
        connectionB.connect,
        connectionReadOnly.connect,
        connectionModern.connect,
      ])

      const mcpUrl = new URL('/mcp', local.env.CONVEX_SITE_URL!)
      const bearerBoundaryHeader = 'x-bcn-lab-bearer-boundary'
      const protectedMetadataUrl = new URL(labOAuthResourceMetadataUrl(mcpUrl))
      const protectedMetadataResponse = await fetch(protectedMetadataUrl)
      expect(protectedMetadataResponse.status).toBe(200)
      await expect(protectedMetadataResponse.json()).resolves.toMatchObject({
        authorization_servers: [LAB_OAUTH_ISSUER],
        resource: mcpUrl.href,
        scopes_supported: LAB_OAUTH_SCOPES,
      })
      const metadataWithBearer = await fetch(protectedMetadataUrl, {
        headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      })
      expect(metadataWithBearer.status).toBe(200)
      expect(metadataWithBearer.headers.get(bearerBoundaryHeader)).toBeNull()
      const authorizationServerMetadata = await fetch(
        new URL('/.well-known/oauth-authorization-server', local.env.CONVEX_SITE_URL!),
      )
      expect(authorizationServerMetadata.status).toBe(404)

      const missingToken = await fetch(mcpUrl, {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      expect(missingToken.status).toBe(401)
      expect(missingToken.headers.get(bearerBoundaryHeader)).toBe('canonical-mcp')
      expect(missingToken.headers.get('www-authenticate')).toContain(
        `resource_metadata="${protectedMetadataUrl.href}"`,
      )
      for (const token of [
        LAB_OAUTH_TOKENS.expired,
        LAB_OAUTH_TOKENS.revoked,
        LAB_OAUTH_TOKENS.sessionClass,
        LAB_OAUTH_TOKENS.wrongClient,
        LAB_OAUTH_TOKENS.wrongIssuer,
        LAB_OAUTH_TOKENS.wrongResource,
      ]) {
        const invalid = await fetch(mcpUrl, {
          body: '{}',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          method: 'POST',
        })
        expect(invalid.status).toBe(401)
        expect(invalid.headers.get(bearerBoundaryHeader)).toBe('canonical-mcp')
        expect(await invalid.text()).not.toContain(token)
      }
      const insufficientScope = await fetch(mcpUrl, {
        body: '{}',
        headers: {
          authorization: `Bearer ${LAB_OAUTH_TOKENS.insufficientScope}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      })
      expect(insufficientScope.status).toBe(403)
      expect(insufficientScope.headers.get('www-authenticate')).toContain('scope="notes:read"')

      const queryTokenUrl = new URL(mcpUrl)
      queryTokenUrl.searchParams.set('access_token', OWNER_TOKEN)
      const queryToken = await fetch(queryTokenUrl, {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      expect(queryToken.status).toBe(404)
      expect(await queryToken.text()).not.toContain(OWNER_TOKEN)
      const bodyToken = await fetch(mcpUrl, {
        body: JSON.stringify({ access_token: OWNER_TOKEN }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      expect(bodyToken.status).toBe(401)
      expect(await bodyToken.text()).not.toContain(OWNER_TOKEN)

      const hostileOrigin = await fetch(mcpUrl, {
        body: '{}',
        headers: {
          authorization: `Bearer ${OWNER_TOKEN}`,
          'content-type': 'application/json',
          origin: 'https://attacker.invalid',
        },
        method: 'POST',
      })
      expect(hostileOrigin.status).toBe(403)
      expect(hostileOrigin.headers.get('cache-control')).toBe('no-store')
      expect(hostileOrigin.headers.get(bearerBoundaryHeader)).toBeNull()

      const encoded = await fetch(mcpUrl, {
        body: '{}',
        headers: {
          authorization: `Bearer ${OWNER_TOKEN}`,
          'content-encoding': 'gzip',
          'content-type': 'application/json',
        },
        method: 'POST',
      })
      expect(encoded.status).toBe(415)
      expect(encoded.headers.get('cache-control')).toBe('no-store')
      await expect(encoded.text()).resolves.toBe('')

      const wrongContentType = await fetch(mcpUrl, {
        body: '{}',
        headers: {
          authorization: `Bearer ${OWNER_TOKEN}`,
          'content-type': 'text/plain',
        },
        method: 'POST',
      })
      expect(wrongContentType.status).toBe(415)

      const oversized = await fetch(mcpUrl, {
        body: 'x'.repeat(64 * 1024 + 1),
        headers: {
          authorization: `Bearer ${OWNER_TOKEN}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      })
      expect(oversized.status).toBe(413)

      const wrongPath = await fetch(new URL('/mcp/extra', local.env.CONVEX_SITE_URL!), {
        body: '{}',
        headers: {
          authorization: `Bearer ${OWNER_TOKEN}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      })
      expect(wrongPath.status).toBe(404)
      expect(wrongPath.headers.get(bearerBoundaryHeader)).toBeNull()
      const formerAuthProbe = await fetch(
        new URL('/api/auth/get-session', local.env.CONVEX_SITE_URL!),
        { headers: { authorization: `Bearer ${OWNER_TOKEN}` } },
      )
      expect(formerAuthProbe.status).toBe(404)
      expect(formerAuthProbe.headers.get(bearerBoundaryHeader)).toBeNull()
      const queryDisagreementUrl = new URL(mcpUrl)
      queryDisagreementUrl.searchParams.set('unexpected', '1')
      const queryDisagreement = await fetch(queryDisagreementUrl, {
        body: '{}',
        headers: {
          authorization: `Bearer ${OWNER_TOKEN}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      })
      expect(queryDisagreement.status).toBe(404)
      const wrongMethod = await fetch(mcpUrl, {
        headers: { authorization: `Bearer ${OWNER_TOKEN}` },
        method: 'GET',
      })
      expect([404, 405]).toContain(wrongMethod.status)

      const rawHeaders = [
        ['Accept', 'application/json, text/event-stream'],
        ['Authorization', `Bearer ${OWNER_TOKEN}`],
        ['Content-Type', 'application/json'],
        ['Connection', 'close'],
      ] as const
      const duplicateLength = await exchangeRawHttp(
        mcpUrl,
        rawHttpRequest(mcpUrl, {
          body: '{}',
          headers: [...rawHeaders, ['Content-Length', '2'], ['Content-Length', '2']],
        }),
      )
      expect(duplicateLength.status).toBeNull()
      expect(duplicateLength.responseText).toBe('')
      const conflictingFraming = await exchangeRawHttp(
        mcpUrl,
        rawHttpRequest(mcpUrl, {
          body: chunkedBody(['{}']),
          headers: [...rawHeaders, ['Content-Length', '2'], ['Transfer-Encoding', 'chunked']],
        }),
      )
      expect(conflictingFraming.status).toBeNull()
      expect(conflictingFraming.responseText).toBe('')

      const discovery = rcDiscoverBody('chunked-discovery')
      const split = Math.floor(discovery.length / 2)
      const rcDiscoveryHeaders = [
        ...rawHeaders.slice(0, -1),
        ['Mcp-Method', 'server/discover'],
        ['Mcp-Protocol-Version', '2026-07-28'],
      ] as const
      const streamed = await exchangeRawHttp(
        mcpUrl,
        rawHttpRequest(mcpUrl, {
          body: chunkedBody([discovery.slice(0, split), discovery.slice(split)]),
          headers: [...rcDiscoveryHeaders, ['Transfer-Encoding', 'chunked']],
        }),
        { keepWriteOpen: true },
      )
      expect(streamed.status, streamed.responseText).toBe(200)

      const tracedInitialize = await fetch(mcpUrl, {
        body: rcDiscoverBody('bearer-boundary-trace'),
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${OWNER_TOKEN}`,
          'content-type': 'application/json',
          'mcp-method': 'server/discover',
          'mcp-protocol-version': '2026-07-28',
        },
        method: 'POST',
      })
      expect(tracedInitialize.status).toBe(200)
      expect(tracedInitialize.headers.get(bearerBoundaryHeader)).toBe('canonical-mcp')
      expect(await tracedInitialize.text()).not.toContain(OWNER_TOKEN)

      const oversizedStream = await exchangeRawHttp(
        mcpUrl,
        rawHttpRequest(mcpUrl, {
          body: chunkedBody(['x'.repeat(64 * 1024 + 1)]),
          headers: [...rawHeaders.slice(0, -1), ['Transfer-Encoding', 'chunked']],
        }),
        { keepWriteOpen: true },
      )
      expect(oversizedStream.status).toBe(413)

      const incompleteChunk = rawHttpRequest(mcpUrl, {
        body: '10\r\n{',
        headers: [...rawHeaders.slice(0, -1), ['Transfer-Encoding', 'chunked']],
      })
      await abortRawHttp(mcpUrl, incompleteChunk)
      const recoveredAfterAbort = await fetch(mcpUrl, {
        body: rcDiscoverBody('after-abort'),
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${OWNER_TOKEN}`,
          'content-type': 'application/json',
          'mcp-method': 'server/discover',
          'mcp-protocol-version': '2026-07-28',
        },
        method: 'POST',
      })
      expect(recoveredAfterAbort.status).toBe(200)

      console.info(
        `[vnext-convex-http] origin=${hostileOrigin.status} encoding=${encoded.status} contentType=${wrongContentType.status} oversized=${oversized.status} path=${wrongPath.status} query=${queryDisagreement.status} method=${wrongMethod.status} duplicateLength=${duplicateLength.status} conflictingFraming=${conflictingFraming.status} streamed=${streamed.status} streamedOversized=${oversizedStream.status} abortRecovery=${recoveredAfterAbort.status}`,
      )

      const [toolsA, toolsB, toolsModern] = await Promise.all([
        connectionA.client.listTools(),
        connectionB.client.listTools(),
        connectionModern.client.listTools(),
      ])
      expect(toolsA.tools.map((tool) => tool.name).sort()).toEqual(
        topologyConformanceVectors.expectedTools,
      )
      expect(toolsB.tools.map((tool) => tool.name).sort()).toEqual(
        topologyConformanceVectors.expectedTools,
      )
      expect(toolsModern.tools.map((tool) => tool.name).sort()).toEqual(
        topologyConformanceVectors.expectedTools,
      )
      const modernSearch = await connectionModern.client.callTool(
        topologyConformanceVectors.search.allowed,
      )
      expect(modernSearch.structuredContent).toMatchObject({
        matches: [{ id: 'note-a' }],
      })
      const modernResource = await connectionModern.client.readResource(
        topologyConformanceVectors.resource,
      )
      expect(modernResource.contents).toHaveLength(1)
      expect(responsesModern).toHaveLength(4)
      expect(responsesModern.every((body) => body.includes(SERVER_INFO_META_KEY))).toBe(true)
      expect(connectionModern.requestBodies.some((body) => body.includes('server/discover'))).toBe(
        true,
      )
      expect(JSON.stringify(toolsA.tools)).not.toContain('subject')
      const supportedSearch = toolsA.tools.find((tool) => tool.name === 'search_notes')
      const unsupportedSearch = toolsB.tools.find((tool) => tool.name === 'search_notes')
      expect(supportedSearch?._meta).toEqual({
        ui: {
          resourceUri: 'ui://notes/dashboard.html',
          visibility: ['model', 'app'],
        },
      })
      expect(unsupportedSearch?._meta).toEqual(supportedSearch?._meta)
      expect(
        McpUiToolMetaSchema.parse((supportedSearch?._meta as { ui?: unknown } | undefined)?.ui),
      ).toEqual(supportedSearch?._meta?.ui)

      const supportedRequests = connectionA.requestBodies.filter(Boolean).map(
        (body) =>
          JSON.parse(body) as {
            method?: string
            params?: Record<string, unknown>
          },
      )
      const unsupportedRequests = connectionB.requestBodies.filter(Boolean).map(
        (body) =>
          JSON.parse(body) as {
            method?: string
            params?: Record<string, unknown>
          },
      )
      expect(supportedRequests[0]).toMatchObject({
        method: 'server/discover',
        params: {
          _meta: {
            'io.modelcontextprotocol/clientCapabilities': {
              extensions: {
                'io.modelcontextprotocol/ui': {
                  mimeTypes: ['text/html;profile=mcp-app'],
                },
              },
            },
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          },
        },
      })
      expect(unsupportedRequests[0]).toMatchObject({
        method: 'server/discover',
        params: {
          _meta: {
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          },
        },
      })

      const dashboard = await connectionA.client.readResource({
        uri: 'ui://notes/dashboard.html',
      })
      expect(dashboard.contents).toEqual([
        {
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
          mimeType: 'text/html;profile=mcp-app',
          text: notesDashboardHtml,
          uri: 'ui://notes/dashboard.html',
        },
      ])
      expect(
        McpUiResourceMetaSchema.parse(
          (dashboard.contents[0]!._meta as { ui?: unknown } | undefined)?.ui,
        ),
      ).toEqual(dashboard.contents[0]!._meta?.ui)
      const unsupportedFallback = await connectionB.client.callTool({
        arguments: { query: 'beta', workspaceId: 'workspace-b' },
        name: 'search_notes',
      })
      expect(unsupportedFallback).toMatchObject({
        content: [{ type: 'text' }],
        structuredContent: {
          matches: [{ id: 'note-b', title: 'Beta' }],
        },
      })
      let appRevocationChecks = 0
      const appsProof = await proveNotesDashboardBrowserBoundary({
        build: await buildNotesDashboard(),
        async callTool(call) {
          if (call.arguments?.query !== 'revoked') {
            return await connectionA.client.callTool(call)
          }
          appRevocationChecks += 1
          const revoked = await fetch(mcpUrl, {
            body: JSON.stringify({
              id: 'app-revoked-access',
              jsonrpc: '2.0',
              method: 'tools/call',
              params: {
                _meta: {
                  'io.modelcontextprotocol/clientCapabilities': {},
                  'io.modelcontextprotocol/clientInfo': {
                    name: 'better-convex-app-revocation-proof',
                    version: '0.0.0',
                  },
                  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                },
                ...call,
              },
            }),
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${LAB_OAUTH_TOKENS.revoked}`,
              'content-type': 'application/json',
              'mcp-method': 'tools/call',
              'mcp-name': call.name,
              'mcp-protocol-version': '2026-07-28',
            },
            method: 'POST',
          })
          expect(revoked.status).toBe(401)
          return {
            content: [{ text: 'Access denied.', type: 'text' }],
            isError: true,
          }
        },
      })
      expect(appRevocationChecks).toBe(1)
      expect(appsProof.toolCalls).toEqual([
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

      const concurrentSearches = await Promise.all(
        Array.from({ length: 16 }, (_, index) =>
          (index % 2 === 0 ? connectionA.client : connectionB.client).callTool({
            arguments: {
              query: '',
              workspaceId: index % 2 === 0 ? 'workspace-a' : 'workspace-b',
            },
            name: 'search_notes',
          }),
        ),
      )
      expect(
        concurrentSearches.every(
          (result) =>
            Array.isArray(
              (result.structuredContent as { matches?: unknown[] } | undefined)?.matches,
            ) && (result.structuredContent as { matches: unknown[] }).matches.length === 1,
        ),
      ).toBe(true)

      const [searchA, searchB] = await Promise.all([
        connectionA.client.callTool(topologyConformanceVectors.search.allowed),
        connectionB.client.callTool({
          arguments: { query: '', workspaceId: 'workspace-b' },
          name: 'search_notes',
        }),
      ])
      expect(searchA.structuredContent).toMatchObject({
        matches: [{ id: 'note-a' }],
      })
      expect(searchA.content).toEqual([{ text: '1 note matched.', type: 'text' }])
      expect(searchB.structuredContent).toMatchObject({
        matches: [{ id: 'note-b' }],
      })

      const readOnlySearch = await connectionReadOnly.client.callTool({
        arguments: { query: 'alpha', workspaceId: 'workspace-a' },
        name: 'search_notes',
      })
      expect(readOnlySearch.structuredContent).toMatchObject({
        matches: [{ id: 'note-a' }],
      })
      const readOnlyRename = await connectionReadOnly.client.callTool({
        arguments: {
          noteId: 'note-a',
          requestKey: 'scope-denied',
          title: 'Denied',
        },
        name: 'rename_note',
      })
      expect(readOnlyRename).toMatchObject({
        content: [{ text: JSON.stringify({ code: 'ACCESS_DENIED' }), type: 'text' }],
        isError: true,
      })
      const latency = await measureSequentialLatency(() =>
        connectionA.client.callTool({
          arguments: { query: 'alpha', workspaceId: 'workspace-a' },
          name: 'search_notes',
        }),
      )
      console.info(formatLatencySummary('vnext-convex-native-latency', latency))

      if (process.env.BCN_VNEXT_MCP_OFFICIAL_TOOLS === 'true') {
        const officialTools = await runOfficialMcpToolProbe({
          endpoint: new URL('/mcp', local.env.CONVEX_SITE_URL!),
          label: 'Convex-native',
          repositoryRoot: root,
          token: OWNER_TOKEN,
        })
        expect(officialTools.inspectorMethods).toEqual([
          'tools/list',
          'tools/call',
          'resources/templates/list',
          'resources/read',
        ])
        expect(officialTools.conformanceScenarios).toEqual([
          'tools-list',
          'resources-list',
          'http-header-validation',
        ])
      }

      const [renameA, renameB] = await Promise.all([
        connectionA.client.callTool(topologyConformanceVectors.rename.first),
        connectionB.client.callTool({
          arguments: {
            noteId: 'note-b',
            requestKey: 'rename-b',
            title: 'Beta renamed',
          },
          name: 'rename_note',
        }),
      ])
      expect(renameA.structuredContent).toMatchObject({
        noteId: 'note-a',
        title: 'Alpha renamed',
      })
      expect(renameA.content).toEqual([{ text: 'Renamed note-a.', type: 'text' }])
      expect(renameB.structuredContent).toMatchObject({
        noteId: 'note-b',
        title: 'Beta renamed',
      })

      const renameReplay = await connectionA.client.callTool(
        topologyConformanceVectors.rename.first,
      )
      expect(renameReplay.structuredContent).toEqual(renameA.structuredContent)
      const renameConflict = await connectionA.client.callTool(
        topologyConformanceVectors.rename.conflicting,
      )
      expect(renameConflict).toMatchObject({
        content: [
          {
            text: JSON.stringify({ code: 'IDEMPOTENCY_CONFLICT' }),
            type: 'text',
          },
        ],
        isError: true,
      })

      const [resourceA, resourceB] = await Promise.all([
        connectionA.client.readResource(topologyConformanceVectors.resource),
        connectionB.client.readResource({ uri: 'note://note-b' }),
      ])
      expect(resourceA.contents[0]).toMatchObject({ uri: 'note://note-a' })
      expect(resourceB.contents[0]).toMatchObject({ uri: 'note://note-b' })

      const crossTenant = await connectionA.client.callTool(
        topologyConformanceVectors.search.crossTenant,
      )
      expect(crossTenant).toMatchObject({
        content: [{ text: JSON.stringify({ code: 'ACCESS_DENIED' }), type: 'text' }],
        isError: true,
      })

      const forgedIdentity = await connectionA.client.callTool(
        topologyConformanceVectors.malformedSearch,
      )
      expect(forgedIdentity.isError).toBe(true)

      const [report, deniedDelete] = await Promise.all([
        connectionA.client.callTool({
          arguments: { workspaceId: 'workspace-a' },
          name: 'generate_report',
        }),
        connectionB.client.callTool({
          arguments: {
            operationKey: 'delete-workspace-b-0000000000000001',
            workspaceId: 'workspace-b',
          },
          name: 'delete_workspace',
        }),
      ])
      expect(report.structuredContent).toMatchObject({
        noteCount: 1,
        workspaceId: 'workspace-a',
      })
      expect(deniedDelete).toMatchObject({
        structuredContent: {
          code: 'CLIENT_INTERACTION_UNSUPPORTED',
          status: 'interaction_unsupported',
        },
      })

      const convex = new ConvexHttpClient(local.env.CONVEX_URL!)
      const inaccessibleOperation = makeFunctionReference<
        'query',
        { principal: { subject: string }; query: string; workspaceId: string },
        unknown
      >('operations:searchNotes')
      await expect(
        convex.query(inaccessibleOperation, {
          principal: { subject: 'alice' },
          query: '',
          workspaceId: 'workspace-a',
        }),
      ).rejects.toThrow(/public function/iu)
      const inaccessibleHttpAction = makeFunctionReference<
        'action',
        Record<string, never>,
        unknown
      >('mcp:handleMcp')
      await expect(convex.action(inaccessibleHttpAction, {})).rejects.toThrow(/public function/iu)
      const setMember = makeFunctionReference<
        'mutation',
        {
          role: 'editor' | 'owner'
          status: 'active' | 'removed'
          subject: string
        },
        {
          role: 'editor' | 'owner'
          status: 'active' | 'removed'
          subject: string
        }
      >('fixture:setMember')
      const setMemberWithBearer = makeFunctionReference<
        'mutation',
        {
          authorization: string
          role: 'editor' | 'owner'
          status: 'active' | 'removed'
          subject: string
        },
        unknown
      >('fixture:setMember')
      await expect(
        convex.mutation(setMemberWithBearer, {
          authorization: `Bearer ${OWNER_TOKEN}`,
          role: 'owner',
          status: 'active',
          subject: 'bob',
        }),
      ).rejects.toThrow(/extra field.*authorization/iu)
      await expect(
        convex.mutation(setMember, {
          role: 'owner',
          status: 'active',
          subject: 'bob',
        }),
      ).resolves.toEqual({ role: 'owner', status: 'active', subject: 'bob' })
      const allowedAfterLiveRoleChange = await connectionB.client.callTool({
        arguments: {
          operationKey: 'delete-workspace-b-0000000000000002',
          workspaceId: 'workspace-b',
        },
        name: 'delete_workspace',
      })
      expect(allowedAfterLiveRoleChange.structuredContent).toEqual({
        code: 'CLIENT_INTERACTION_UNSUPPORTED',
        status: 'interaction_unsupported',
      })
      const countWorkspaceDeletionInteractions = makeFunctionReference<
        'query',
        Record<string, never>,
        { count: number }
      >('fixture:countWorkspaceDeletionInteractionsForTest')
      expect(await convex.query(countWorkspaceDeletionInteractions, {})).toEqual({ count: 0 })

      const tamperedOperationKey = 'delete-workspace-a-tamper-00000000001'
      const rawToolCall = async (
        id: string,
        retry?: {
          inputResponses: Record<string, unknown>
          requestState: string
        },
      ) =>
        await fetch(mcpUrl, {
          body: JSON.stringify({
            id,
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
              _meta: {
                'io.modelcontextprotocol/clientCapabilities': {
                  elicitation: { url: {} },
                },
                'io.modelcontextprotocol/clientInfo': {
                  name: 'better-convex-request-state-adversary',
                  version: '0.0.0',
                },
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              },
              arguments: {
                operationKey: tamperedOperationKey,
                workspaceId: 'workspace-a',
              },
              name: 'delete_workspace',
              ...(retry ?? {}),
            },
          }),
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${OWNER_TOKEN}`,
            'content-type': 'application/json',
            'mcp-method': 'tools/call',
            'mcp-name': 'delete_workspace',
            'mcp-protocol-version': '2026-07-28',
          },
          method: 'POST',
        })
      const rawPendingResponse = await rawToolCall('request-state-original')
      expect(rawPendingResponse.status).toBe(200)
      await expect(rawPendingResponse.json()).resolves.toMatchObject({
        result: {
          requestState: tamperedOperationKey,
          resultType: 'input_required',
        },
      })
      const rawAcceptedButUnconfirmedResponse = await rawToolCall('request-state-unconfirmed', {
        inputResponses: { review: { action: 'accept' } },
        requestState: tamperedOperationKey,
      })
      expect(rawAcceptedButUnconfirmedResponse.status).toBe(200)
      await expect(rawAcceptedButUnconfirmedResponse.json()).resolves.toMatchObject({
        result: {
          structuredContent: { status: 'pending' },
        },
      })
      for (const action of ['decline', 'cancel'] as const) {
        const response = await rawToolCall(`request-state-${action}`, {
          inputResponses: { review: { action } },
          requestState: tamperedOperationKey,
        })
        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toMatchObject({
          result: {
            structuredContent: { status: 'pending' },
          },
        })
      }
      const rawTamperedResponse = await rawToolCall('request-state-tampered', {
        inputResponses: { review: { action: 'accept' } },
        requestState: 'forged-request-state-000000000000001',
      })
      expect(rawTamperedResponse.status).toBe(200)
      await expect(rawTamperedResponse.json()).resolves.toMatchObject({
        result: {
          content: [
            {
              text: JSON.stringify({ code: 'INPUT_INVALID' }),
              type: 'text',
            },
          ],
          isError: true,
        },
      })
      const reseed = makeFunctionReference<'mutation', { resource: string }, { seeded: boolean }>(
        'fixture:seed',
      )
      expect(await convex.mutation(reseed, { resource: mcpUrl.href })).toEqual({
        seeded: true,
      })

      const deleteCall = {
        arguments: {
          operationKey: 'delete-workspace-a-0000000000000001',
          workspaceId: 'workspace-a',
        },
        name: 'delete_workspace',
      } as const
      const confirmWorkspaceDeletion = makeFunctionReference<
        'action',
        {
          actor: { issuer: string; subject: string }
          locator: string
        },
        unknown
      >('fixture:confirmWorkspaceDeletionForTest')
      let observedReviewUrl: URL | undefined
      let confirmed:
        | {
            ok: true
            value: {
              receipt: {
                deletedNoteCount: number
                revision: number
                workspaceId: string
              }
              status: 'applied'
            }
          }
        | undefined
      connectionA.client.setRequestHandler('elicitation/create', async (request) => {
        expect(request.params).toMatchObject({
          message: 'Review this workspace deletion in the application.',
          mode: 'url',
        })
        if (request.params.mode !== 'url') {
          throw new Error('Expected URL interaction')
        }
        observedReviewUrl = new URL(request.params.url)
        expect(observedReviewUrl.origin).toBe(INTERACTION_ORIGIN)
        expect(interactionLocatorFromPath(observedReviewUrl.pathname)).not.toBeNull()
        expect(observedReviewUrl.search).toBe('')
        expect(observedReviewUrl.hash).toBe('')
        const locator = interactionLocatorFromPath(observedReviewUrl.pathname)!
        confirmed = (await convex.action(confirmWorkspaceDeletion, {
          actor: { issuer: LAB_OAUTH_ISSUER, subject: 'alice' },
          locator,
        })) as typeof confirmed
        return { action: 'accept' }
      })
      const completed = await connectionA.client.callTool(deleteCall)
      expect(observedReviewUrl).toBeDefined()
      expect(confirmed).toMatchObject({
        ok: true,
        value: {
          receipt: {
            deletedNoteCount: 1,
            revision: 2,
            workspaceId: 'workspace-a',
          },
          status: 'applied',
        },
      })
      expect(responsesA.some((body) => body.includes('"resultType":"input_required"'))).toBe(true)
      const retryRequest = connectionA.requestBodies
        .map(
          (body) =>
            JSON.parse(body) as {
              params?: {
                inputResponses?: Record<string, unknown>
                requestState?: string
              }
            },
        )
        .find((request) => request.params?.requestState !== undefined)
      expect(retryRequest?.params).toMatchObject({
        inputResponses: { review: { action: 'accept' } },
        requestState: deleteCall.arguments.operationKey,
      })
      expect(completed.structuredContent).toEqual({
        receipt: expect.objectContaining({
          deletedNoteCount: 1,
          revision: 2,
          workspaceId: 'workspace-a',
        }),
        status: 'applied',
      })
      const recovered = await connectionA.client.callTool({
        arguments: { operationKey: deleteCall.arguments.operationKey },
        name: 'get_workspace_deletion_status',
      })
      expect(recovered.structuredContent).toEqual(completed.structuredContent)

      const responseText = [
        ...responsesA,
        ...responsesB,
        ...responsesReadOnly,
        ...responsesModern,
      ].join('\n')
      for (const token of Object.values(LAB_OAUTH_TOKENS)) {
        expect(responseText).not.toContain(token)
      }
    } finally {
      await Promise.allSettled([
        connectionA.client.close(),
        connectionB.client.close(),
        connectionReadOnly.client.close(),
        connectionModern.client.close(),
      ])
    }
  })

  it('keeps high-impact application state current, subject-bound, stale-safe, and replay-safe', async () => {
    if (!local) throw new Error('Local Convex fixture is not ready')
    const convex = new ConvexHttpClient(local.env.CONVEX_URL!)
    const seed = makeFunctionReference<'mutation', { resource: string }, { seeded: boolean }>(
      'fixture:seed',
    )
    const prepare = makeFunctionReference<
      'action',
      {
        access: {
          clientId: string
          issuer: string
          resource: string
          subject: string
        }
        workspaceId: string
      },
      unknown
    >('fixture:prepareWorkspaceDeletionForTest')
    const review = makeFunctionReference<
      'action',
      {
        actor: { issuer: string; subject: string }
        locator: string
      },
      unknown
    >('fixture:getWorkspaceDeletionReviewForTest')
    const confirm = makeFunctionReference<
      'action',
      {
        actor: { issuer: string; subject: string }
        locator: string
      },
      unknown
    >('fixture:confirmWorkspaceDeletionForTest')
    const status = makeFunctionReference<
      'action',
      {
        access: {
          clientId: string
          issuer: string
          resource: string
          subject: string
        }
        operationKey: string
      },
      unknown
    >('fixture:getWorkspaceDeletionStatusForTest')
    const setMember = makeFunctionReference<
      'mutation',
      {
        role: 'editor' | 'owner'
        status: 'active' | 'removed'
        subject: string
      },
      unknown
    >('fixture:setMember')
    const setMcpGrant = makeFunctionReference<
      'mutation',
      {
        active: boolean
        clientId: string
        issuer: string
        resource: string
        subject: string
      },
      { active: boolean }
    >('fixture:setMcpGrantStatusForTest')
    const addNote = makeFunctionReference<
      'mutation',
      { externalId: string; workspaceId: string },
      unknown
    >('fixture:addNoteForTest')
    const deleteWorkspace = makeFunctionReference<
      'mutation',
      { workspaceId: string },
      { deleted: boolean; workspaceId: string }
    >('fixture:deleteWorkspaceForTest')
    const expire = makeFunctionReference<'mutation', { locator: string }, unknown>(
      'fixture:expireWorkspaceDeletionForTest',
    )
    const count = makeFunctionReference<'query', Record<string, never>, { count: number }>(
      'fixture:countWorkspaceDeletionInteractionsForTest',
    )
    const access = {
      clientId: 'client-a',
      issuer: LAB_OAUTH_ISSUER,
      resource: new URL('/mcp', local.env.CONVEX_SITE_URL!).href,
      subject: 'alice',
    }
    const actor = { issuer: LAB_OAUTH_ISSUER, subject: 'alice' }

    await convex.mutation(seed, { resource: access.resource })
    const prepared = (await convex.action(prepare, {
      access,
      workspaceId: 'workspace-a',
    })) as {
      ok: true
      value: {
        locator: string
        operationKey: string
        review: {
          effects: Array<{ noteCount: number; workspaceId: string }>
          warnings: Array<{ code: string; count: number }>
        }
        status: 'pending'
      }
    }
    expect(prepared.value).toMatchObject({
      review: {
        effects: [{ noteCount: 1, workspaceId: 'workspace-a' }],
        warnings: [{ code: 'NOTES_WILL_BE_DELETED', count: 1 }],
      },
      status: 'pending',
    })
    expect(await convex.query(count, {})).toEqual({ count: 1 })
    await expect(
      convex.action(review, {
        actor: {
          issuer: 'https://other-issuer.example/api/auth',
          subject: 'alice',
        },
        locator: prepared.value.locator,
      }),
    ).resolves.toEqual({ code: 'INTERACTION_NOT_FOUND', ok: false })
    await expect(
      convex.action(review, {
        actor: { issuer: LAB_OAUTH_ISSUER, subject: 'bob' },
        locator: prepared.value.locator,
      }),
    ).resolves.toEqual({ code: 'INTERACTION_NOT_FOUND', ok: false })
    await expect(
      convex.action(status, {
        access: { ...access, clientId: 'different-client' },
        operationKey: prepared.value.operationKey,
      }),
    ).resolves.toEqual({ code: 'INTERACTION_NOT_FOUND', ok: false })
    for (const foreignAccess of [
      { ...access, issuer: 'https://other-issuer.example.invalid' },
      { ...access, resource: 'https://other-resource.example.invalid/mcp' },
      { ...access, subject: 'bob' },
    ]) {
      await expect(
        convex.action(status, {
          access: foreignAccess,
          operationKey: prepared.value.operationKey,
        }),
      ).resolves.toEqual({ code: 'INTERACTION_NOT_FOUND', ok: false })
    }

    await expect(convex.mutation(setMcpGrant, { ...access, active: false })).resolves.toEqual({
      active: false,
    })
    await expect(
      convex.action(review, { actor, locator: prepared.value.locator }),
    ).resolves.toEqual({ code: 'ACCESS_DENIED', ok: false })
    await expect(
      convex.action(confirm, { actor, locator: prepared.value.locator }),
    ).resolves.toEqual({ code: 'ACCESS_DENIED', ok: false })
    await expect(
      convex.action(status, {
        access,
        operationKey: prepared.value.operationKey,
      }),
    ).resolves.toEqual({ code: 'INTERACTION_NOT_FOUND', ok: false })
    const revokedMcpRequest = await fetch(new URL('/mcp', local.env.CONVEX_SITE_URL!), {
      body: JSON.stringify({
        id: 'revoked-live-grant',
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/clientInfo': {
              name: 'revoked-live-grant-proof',
              version: '0.0.0',
            },
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          },
        },
      }),
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${OWNER_TOKEN}`,
        'content-type': 'application/json',
        'mcp-method': 'tools/list',
        'mcp-protocol-version': '2026-07-28',
      },
      method: 'POST',
    })
    expect(revokedMcpRequest.status).toBe(401)
    expect(await revokedMcpRequest.text()).not.toContain(OWNER_TOKEN)
    await expect(convex.mutation(setMcpGrant, { ...access, active: true })).resolves.toEqual({
      active: true,
    })

    await convex.mutation(setMember, {
      role: 'owner',
      status: 'removed',
      subject: 'alice',
    })
    await expect(
      convex.action(confirm, { actor, locator: prepared.value.locator }),
    ).resolves.toEqual({ code: 'ACCESS_DENIED', ok: false })
    await convex.mutation(setMember, {
      role: 'editor',
      status: 'active',
      subject: 'alice',
    })
    await expect(
      convex.action(confirm, { actor, locator: prepared.value.locator }),
    ).resolves.toEqual({ code: 'ACCESS_DENIED', ok: false })
    await convex.mutation(setMember, {
      role: 'owner',
      status: 'active',
      subject: 'alice',
    })
    await convex.mutation(addNote, {
      externalId: 'note-added-after-review',
      workspaceId: 'workspace-a',
    })
    await expect(
      convex.action(confirm, { actor, locator: prepared.value.locator }),
    ).resolves.toEqual({ ok: true, value: { status: 'stale' } })
    await expect(
      convex.action(confirm, { actor, locator: prepared.value.locator }),
    ).resolves.toEqual({ ok: true, value: { status: 'stale' } })

    await convex.mutation(seed, { resource: access.resource })
    const expiring = (await convex.action(prepare, {
      access,
      workspaceId: 'workspace-a',
    })) as typeof prepared
    await convex.mutation(expire, { locator: expiring.value.locator })
    await expect(
      convex.action(review, { actor, locator: expiring.value.locator }),
    ).resolves.toMatchObject({ ok: true, value: { status: 'expired' } })
    await expect(
      convex.action(confirm, { actor, locator: expiring.value.locator }),
    ).resolves.toEqual({ ok: true, value: { status: 'expired' } })

    await convex.mutation(seed, { resource: access.resource })
    const missingTarget = (await convex.action(prepare, {
      access,
      workspaceId: 'workspace-a',
    })) as typeof prepared
    await expect(convex.mutation(deleteWorkspace, { workspaceId: 'workspace-a' })).resolves.toEqual(
      { deleted: true, workspaceId: 'workspace-a' },
    )
    await expect(
      convex.action(confirm, { actor, locator: missingTarget.value.locator }),
    ).resolves.toEqual({ code: 'WORKSPACE_NOT_FOUND', ok: false })

    await convex.mutation(seed, { resource: access.resource })
    const concurrent = (await convex.action(prepare, {
      access,
      workspaceId: 'workspace-a',
    })) as typeof prepared
    const confirmations = (await Promise.all([
      convex.action(confirm, { actor, locator: concurrent.value.locator }),
      convex.action(confirm, { actor, locator: concurrent.value.locator }),
    ])) as Array<{
      ok: true
      value: {
        receipt: {
          deletedAt: number
          deletedNoteCount: number
          revision: number
          workspaceId: string
        }
        status: 'applied'
      }
    }>
    expect(confirmations).toHaveLength(2)
    expect(confirmations[0]).toEqual(confirmations[1])
    expect(confirmations[0]?.value).toMatchObject({
      receipt: {
        deletedNoteCount: 1,
        revision: 2,
        workspaceId: 'workspace-a',
      },
      status: 'applied',
    })
    await expect(
      convex.action(status, {
        access,
        operationKey: concurrent.value.operationKey,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        receipt: confirmations[0]?.value.receipt,
        status: 'applied',
      },
    })
    expect(await convex.query(count, {})).toEqual({ count: 1 })
  })

  it('serves an inert, identity-bound interaction page and confirms only by explicit POST', async () => {
    if (!local) throw new Error('Local Convex fixture is not ready')
    const convex = new ConvexHttpClient(local.env.CONVEX_URL!)
    const seed = makeFunctionReference<'mutation', { resource: string }, { seeded: boolean }>(
      'fixture:seed',
    )
    const prepare = makeFunctionReference<
      'action',
      {
        access: {
          clientId: string
          issuer: string
          resource: string
          subject: string
        }
        workspaceId: string
      },
      {
        ok: true
        value: {
          locator: string
          operationKey: string
          status: 'pending'
        }
      }
    >('fixture:prepareWorkspaceDeletionForTest')
    const status = makeFunctionReference<
      'action',
      {
        access: {
          clientId: string
          issuer: string
          resource: string
          subject: string
        }
        operationKey: string
      },
      unknown
    >('fixture:getWorkspaceDeletionStatusForTest')
    const addNote = makeFunctionReference<
      'mutation',
      { externalId: string; workspaceId: string },
      unknown
    >('fixture:addNoteForTest')
    const expire = makeFunctionReference<'mutation', { locator: string }, unknown>(
      'fixture:expireWorkspaceDeletionForTest',
    )
    const access = {
      clientId: 'client-a',
      issuer: LAB_OAUTH_ISSUER,
      resource: new URL('/mcp', local.env.CONVEX_SITE_URL!).href,
      subject: 'alice',
    }
    const cookie = (session: string) =>
      `${INTERACTION_SESSION_COOKIE}=${encodeURIComponent(session)}`
    const request = async (
      locator: string,
      options: {
        body?: string
        headers?: Record<string, string>
        method?: 'GET' | 'POST'
        origin?: string
        session?: string
      } = {},
    ) => {
      const headers = new Headers(options.headers)
      if (options.session) headers.set('cookie', cookie(options.session))
      if (options.origin) headers.set('origin', options.origin)
      return await fetch(
        new URL(`${INTERACTION_PATH_PREFIX}${locator}`, local!.env.CONVEX_SITE_URL!),
        {
          ...(options.body === undefined ? {} : { body: options.body }),
          headers,
          method: options.method ?? 'GET',
          redirect: 'manual',
        },
      )
    }

    await convex.mutation(seed, { resource: access.resource })
    const prepared = await convex.action(prepare, {
      access,
      workspaceId: 'workspace-a',
    })
    const { locator, operationKey } = prepared.value

    const anonymous = await request(locator)
    expect(anonymous.status).toBe(401)
    await expect(anonymous.text()).resolves.toBe('Sign in required')

    for (const invalidLocator of ['short', '../foreign', 'x'.repeat(129)]) {
      const invalid = await request(invalidLocator, {
        session: INTERACTION_LAB_SESSIONS.alice,
      })
      expect(invalid.status).toBe(404)
      await expect(invalid.text()).resolves.not.toContain('Delete workspace')
    }
    const guessed = await request('guessed-interaction-locator-0000000000001', {
      session: INTERACTION_LAB_SESSIONS.alice,
    })
    expect(guessed.status).toBe(404)
    await expect(guessed.text()).resolves.toBe('Interaction unavailable')

    for (const session of [
      INTERACTION_LAB_SESSIONS.bob,
      INTERACTION_LAB_SESSIONS.sameSubjectOtherIssuer,
    ]) {
      const wrongActor = await request(locator, { session })
      expect(wrongActor.status).toBe(404)
      await expect(wrongActor.text()).resolves.toBe('Interaction unavailable')
    }

    const inertRequests = await Promise.all([
      request(locator, { session: INTERACTION_LAB_SESSIONS.alice }),
      request(locator, {
        headers: { purpose: 'prefetch' },
        session: INTERACTION_LAB_SESSIONS.alice,
      }),
      request(locator, {
        headers: { 'user-agent': 'NeutralCrawler/1.0' },
        session: INTERACTION_LAB_SESSIONS.alice,
      }),
    ])
    for (const response of inertRequests) {
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
      expect(response.headers.get('referrer-policy')).toBe('strict-origin')
      expect(response.headers.get('x-frame-options')).toBe('DENY')
      const html = await response.text()
      expect(html).toContain('Delete workspace workspace-a')
      expect(html).toContain('NOTES_WILL_BE_DELETED: 1')
      expect(html).toContain('data-testid="confirm"')
      for (const secret of [
        locator,
        operationKey,
        ...Object.values(INTERACTION_LAB_SESSIONS),
        ...Object.values(LAB_OAUTH_TOKENS),
      ]) {
        expect(html).not.toContain(secret)
      }
    }
    await expect(convex.action(status, { access, operationKey })).resolves.toMatchObject({
      ok: true,
      value: { status: 'pending' },
    })

    for (const rejected of [
      await request(locator, {
        method: 'POST',
        session: INTERACTION_LAB_SESSIONS.alice,
      }),
      await request(locator, {
        method: 'POST',
        origin: 'null',
        session: INTERACTION_LAB_SESSIONS.alice,
      }),
      await request(locator, {
        headers: {
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'cross-site',
        },
        method: 'POST',
        origin: 'https://attacker.example.invalid',
        session: INTERACTION_LAB_SESSIONS.alice,
      }),
      await request(locator, {
        method: 'POST',
        origin: INTERACTION_ORIGIN,
        session: INTERACTION_LAB_SESSIONS.bob,
      }),
      await request(locator, {
        body: 'unexpected=body',
        method: 'POST',
        origin: INTERACTION_ORIGIN,
        session: INTERACTION_LAB_SESSIONS.alice,
      }),
    ]) {
      expect([400, 403, 404]).toContain(rejected.status)
      expect(rejected.headers.get('cache-control')).toBe('private, no-store')
    }
    await expect(convex.action(status, { access, operationKey })).resolves.toMatchObject({
      ok: true,
      value: { status: 'pending' },
    })

    const confirmations = await Promise.all([
      request(locator, {
        method: 'POST',
        origin: INTERACTION_ORIGIN,
        session: INTERACTION_LAB_SESSIONS.alice,
      }),
      request(locator, {
        method: 'POST',
        origin: INTERACTION_ORIGIN,
        session: INTERACTION_LAB_SESSIONS.alice,
      }),
    ])
    for (const response of confirmations) {
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe(interactionUrl(locator))
    }
    const recovered = await convex.action(status, { access, operationKey })
    expect(recovered).toMatchObject({
      ok: true,
      value: {
        receipt: {
          deletedNoteCount: 1,
          revision: 2,
          workspaceId: 'workspace-a',
        },
        status: 'applied',
      },
    })

    const replay = await request(locator, {
      method: 'POST',
      origin: INTERACTION_ORIGIN,
      session: INTERACTION_LAB_SESSIONS.alice,
    })
    expect(replay.status).toBe(303)
    await expect(convex.action(status, { access, operationKey })).resolves.toEqual(recovered)

    const appliedPage = await request(locator, {
      session: INTERACTION_LAB_SESSIONS.alice,
    })
    expect(appliedPage.status).toBe(200)
    const appliedHtml = await appliedPage.text()
    expect(appliedHtml).toContain('<p data-testid="status">applied</p>')
    expect(appliedHtml).toContain('<dd>1</dd>')
    expect(appliedHtml).not.toContain('data-testid="confirm"')

    await convex.mutation(seed, { resource: access.resource })
    const stale = await convex.action(prepare, {
      access,
      workspaceId: 'workspace-a',
    })
    await convex.mutation(addNote, {
      externalId: 'note-added-before-page-confirmation',
      workspaceId: 'workspace-a',
    })
    expect(
      (
        await request(stale.value.locator, {
          method: 'POST',
          origin: INTERACTION_ORIGIN,
          session: INTERACTION_LAB_SESSIONS.alice,
        })
      ).status,
    ).toBe(303)
    const stalePage = await request(stale.value.locator, {
      session: INTERACTION_LAB_SESSIONS.alice,
    })
    expect(await stalePage.text()).toContain('<p data-testid="status">stale</p>')

    await convex.mutation(seed, { resource: access.resource })
    const expired = await convex.action(prepare, {
      access,
      workspaceId: 'workspace-a',
    })
    await convex.mutation(expire, { locator: expired.value.locator })
    expect(
      (
        await request(expired.value.locator, {
          method: 'POST',
          origin: INTERACTION_ORIGIN,
          session: INTERACTION_LAB_SESSIONS.alice,
        })
      ).status,
    ).toBe(303)
    const expiredPage = await request(expired.value.locator, {
      session: INTERACTION_LAB_SESSIONS.alice,
    })
    expect(await expiredPage.text()).toContain('<p data-testid="status">expired</p>')
  })

  it('confirms the application-owned operation through a real production browser page', async () => {
    if (!local) throw new Error('Local Convex fixture is not ready')
    const convex = new ConvexHttpClient(local.env.CONVEX_URL!)
    const seed = makeFunctionReference<'mutation', { resource: string }, { seeded: boolean }>(
      'fixture:seed',
    )
    const prepare = makeFunctionReference<
      'action',
      {
        access: {
          clientId: string
          issuer: string
          resource: string
          subject: string
        }
        workspaceId: string
      },
      {
        ok: true
        value: {
          locator: string
          operationKey: string
          status: 'pending'
        }
      }
    >('fixture:prepareWorkspaceDeletionForTest')
    const status = makeFunctionReference<
      'action',
      {
        access: {
          clientId: string
          issuer: string
          resource: string
          subject: string
        }
        operationKey: string
      },
      unknown
    >('fixture:getWorkspaceDeletionStatusForTest')
    const access = {
      clientId: 'client-a',
      issuer: LAB_OAUTH_ISSUER,
      resource: new URL('/mcp', local.env.CONVEX_SITE_URL!).href,
      subject: 'alice',
    }

    await convex.mutation(seed, { resource: access.resource })
    const prepared = await convex.action(prepare, {
      access,
      workspaceId: 'workspace-a',
    })
    const browserProof = await proveInteractionBrowserBoundary({
      additionalSecretSentinels: [
        ...Object.values(LAB_OAUTH_TOKENS),
        prepared.value.operationKey,
        access.clientId,
        access.issuer,
        access.subject,
      ],
      locator: prepared.value.locator,
      siteUrl: local.env.CONVEX_SITE_URL!,
    })
    expect(browserProof).toEqual({
      finalStatus: 'applied',
      requestMethods: ['GET', 'POST', 'GET'],
    })
    await expect(
      convex.action(status, {
        access,
        operationKey: prepared.value.operationKey,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        receipt: {
          deletedNoteCount: 1,
          revision: 2,
          workspaceId: 'workspace-a',
        },
        status: 'applied',
      },
    })
  })
})
