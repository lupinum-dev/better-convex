// The MCP OAuth starter end to end: OAuth discovery, two public PKCE clients,
// live Convex authorization on every tool call through the agents door, an approval
// decided in the app, terminal revocation (signing out included), least-scope tool
// lists, and the stateless MCP protocol envelope through the official client SDK.
import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { verifyBearerToken } from 'better-auth/oauth2'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { chromium, type Browser, type BrowserContext } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  accessTokenProblems,
  authorizeInBrowser,
  decodeJwtPart,
  INSPECTOR_CALLBACK,
  isRecord,
  MCP_REMOTE_CALLBACK,
  provisionClients,
  redeemCode,
  sleep,
  SCOPE,
  startMcpFixture,
  type JsonRecord,
  type McpFixture,
} from './harness'

const PROTOCOL_VERSION = '2026-07-28'
const TOOL_NAMES = [
  'list_organizations',
  'search_projects',
  'create_project',
  'rename_project',
  'archive_project',
  'check_approval',
]
const READ_TOOL_NAMES = ['list_organizations', 'search_projects', 'check_approval']
// Better Auth allows three sign-ins per ten-second window; fresh sessions are paced, not unlimited.
const SIGN_IN_WINDOW_MS = 10_100

interface McpResponse {
  status: number
  body: JsonRecord
  challenge: string | null
}

async function postMcp(
  resource: string,
  accessToken: string,
  message: JsonRecord,
): Promise<McpResponse> {
  const params = isRecord(message.params) ? message.params : {}
  const response = await fetch(resource, {
    method: 'POST',
    body: JSON.stringify({
      ...message,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': {
            name: 'better-convex-integration',
            version: '1.0.0',
          },
          'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
        },
      },
    }),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'mcp-method': String(message.method),
      ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      'mcp-protocol-version': PROTOCOL_VERSION,
    },
  })
  const body = (await response.json()) as unknown
  return {
    status: response.status,
    body: isRecord(body) ? body : {},
    challenge: response.headers.get('www-authenticate'),
  }
}

const toolCall = (id: string, name: string, args: JsonRecord) => ({
  id,
  jsonrpc: '2.0',
  method: 'tools/call',
  params: { arguments: args, name },
})
const toolsList = (id: string) => ({ id, jsonrpc: '2.0', method: 'tools/list', params: {} })

function structured(response: McpResponse): JsonRecord {
  const result = isRecord(response.body.result) ? response.body.result : {}
  expect(response.status).toBe(200)
  expect(isRecord(result.structuredContent)).toBe(true)
  return result.structuredContent as JsonRecord
}

/** The result of a tool that ran: `{ status: 'done', result }`. */
function done(response: McpResponse): JsonRecord {
  const content = structured(response)
  expect(content.status).toBe('done')
  return content.result as JsonRecord
}

function expectApplicationError(response: McpResponse, code: string, description: string) {
  const result = isRecord(response.body.result) ? response.body.result : {}
  const error = isRecord(result.structuredContent) ? result.structuredContent.error : undefined
  const content = Array.isArray(result.content)
    ? (result.content[0] as JsonRecord | undefined)
    : undefined
  expect(response.status, description).toBe(200)
  expect(response.challenge, description).toBeNull()
  expect(result.resultType, description).toBe('complete')
  expect(result.isError, description).toBe(true)
  expect(error, description).toMatchObject({ code, message: expect.any(String) })
  expect(content?.text, description).toBe((error as JsonRecord).message)
}

function expectInvalidToken(response: McpResponse, description: string) {
  expect(response.status, description).toBe(401)
  expect(response.body.error, description).toBe('invalid_token')
  expect(response.body.result, description).toBeUndefined()
  expect(response.challenge?.startsWith('Bearer '), description).toBe(true)
}

/** A Convex session JWT: library claims only, 15 minutes, signed by the published JWKS. */
async function expectConvexSessionToken(token: unknown, origin: string, convexSiteUrl: string) {
  expect(typeof token === 'string' && /^[\w-]+\.[\w-]+\.[\w-]+$/u.test(token)).toBe(true)
  const header = decodeJwtPart(token as string, 0)
  const claims = decodeJwtPart(token as string, 1)
  expect(Object.keys(header).sort()).toEqual(['alg', 'kid'])
  expect(header.alg).toBe('RS256')
  expect(Object.keys(claims).sort()).toEqual([
    'aud',
    'exp',
    'iat',
    'iss',
    'jti',
    'sid',
    'sub',
    'token_use',
  ])
  expect(claims).toMatchObject({ aud: 'convex', iss: convexSiteUrl, token_use: 'convex-session' })
  const iat = claims.iat as number
  const exp = claims.exp as number
  expect(exp > iat && exp - iat <= 15 * 60).toBe(true)
  await expect(
    verifyBearerToken(token as string, {
      jwksUrl: `${origin}/api/auth/jwks`,
      verifyOptions: {
        algorithms: ['RS256'],
        audience: 'convex',
        clockTolerance: 0,
        issuer: convexSiteUrl,
        maxTokenAge: '900s',
      },
    }),
  ).resolves.toBeDefined()
}

describe('MCP OAuth starter end to end', () => {
  let fixture: McpFixture
  let browser: Browser
  let resource: string
  let clients: Awaited<ReturnType<typeof provisionClients>>
  const contexts: BrowserContext[] = []

  /** A fresh browser session through login, consent and PKCE; checks every token binding. */
  async function publicClientToken(clientId: string, callback: string, scope = SCOPE) {
    const context = await browser.newContext({ viewport: { height: 900, width: 1440 } })
    contexts.push(context)
    const page = await context.newPage()
    const failures: string[] = []
    const expectedPath = (pathname: string) =>
      pathname.startsWith('/_nuxt/') ||
      pathname.startsWith('/.well-known/') ||
      pathname === '/api/auth/convex/token'
    const own = (value: string) => {
      try {
        const url = new URL(value)
        return url.origin === fixture.origin ? url : undefined
      } catch {
        return undefined
      }
    }
    page.on('pageerror', () => {
      if (own(page.url())) failures.push('pageerror')
    })
    page.on('console', (message) => {
      const url = own(message.location().url)
      if (message.type() === 'error' && url && !expectedPath(url.pathname))
        failures.push(`console:${url.pathname}`)
    })
    page.on('requestfailed', (request) => {
      if (request.isNavigationRequest() && request.failure()?.errorText === 'net::ERR_ABORTED')
        return
      const url = own(request.url())
      if (url && !expectedPath(url.pathname))
        failures.push(`request:${request.method()}:${url.pathname}`)
    })
    page.on('response', (response) => {
      const url = own(response.url())
      if (response.status() >= 400 && url)
        failures.push(`response:${response.status()}:${url.pathname}`)
    })

    const grant = await authorizeInBrowser(page, fixture, {
      clientId,
      redirectUri: callback,
      resource,
      scope,
    })
    const token = await redeemCode(fixture.origin, {
      client_id: clientId,
      code: grant.code,
      code_verifier: grant.verifier,
      grant_type: 'authorization_code',
      redirect_uri: callback,
      resource,
    })
    const accessToken = isRecord(token.body) ? token.body.access_token : undefined
    expect(token.status, 'direct PKCE token exchange').toBe(200)
    expect(
      accessTokenProblems(accessToken, { clientId, origin: fixture.origin, resource, scope }),
    ).toEqual([])
    await expect(
      oauthProviderResourceClient()
        .getActions()
        .verifyBearerToken(accessToken as string, {
          jwksUrl: `${fixture.origin}/api/auth/jwks`,
          verifyOptions: {
            algorithms: ['RS256'],
            audience: resource,
            clockTolerance: 0,
            issuer: `${fixture.origin}/api/auth`,
            maxTokenAge: '600s',
            typ: 'at+jwt',
          },
        }),
      'official resource verifier',
    ).resolves.toBeDefined()
    expect(failures, 'unexpected browser failures during the OAuth journey').toEqual([])
    await page.close()
    return { accessToken: accessToken as string, context }
  }

  beforeAll(async () => {
    fixture = await startMcpFixture()
    resource = `${fixture.convexSiteUrl}/mcp`
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    for (const context of contexts) await context.close().catch(() => {})
    await browser?.close().catch(() => {})
    await fixture?.release()
  })

  it('publishes public, cookie-free OAuth discovery for the fixed profile', async () => {
    const issuer = `${fixture.origin}/api/auth`
    const authorization = await fetch(
      `${fixture.origin}/.well-known/oauth-authorization-server/api/auth`,
    )
    expect(authorization.status).toBe(200)
    expect(await authorization.json()).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      token_endpoint: `${issuer}/oauth2/token`,
      revocation_endpoint: `${issuer}/oauth2/revoke`,
      jwks_uri: `${issuer}/jwks`,
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
    })
    const protectedResource = await fetch(
      `${fixture.convexSiteUrl}/.well-known/oauth-protected-resource/mcp`,
    )
    expect(protectedResource.status).toBe(200)
    expect(await protectedResource.json()).toMatchObject({
      resource,
      authorization_servers: [issuer],
      scopes_supported: ['mcp:read', 'mcp:write', 'offline_access'],
    })
    for (const response of [authorization, protectedResource]) {
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(response.headers.get('set-cookie')).toBeNull()
    }
  })

  it('keeps Convex session tokens working next to the OAuth provider', async () => {
    const context = await browser.newContext()
    try {
      const signIn = await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
        data: { email: fixture.email, password: fixture.password },
        headers: { origin: fixture.origin },
      })
      expect(signIn.ok()).toBe(true)
      const token = await context.request.get(`${fixture.origin}/api/auth/convex/token`, {
        headers: { origin: fixture.origin },
      })
      expect(token.ok()).toBe(true)
      await expectConvexSessionToken(
        ((await token.json()) as JsonRecord).token,
        fixture.origin,
        fixture.convexSiteUrl,
      )
      clients = await provisionClients(fixture)
      expect(clients.resource).toBe(resource)
      expect(clients.inspector).not.toBe(clients.mcpRemote)
      const signOut = await context.request.post(`${fixture.origin}/api/auth/sign-out`, {
        data: {},
        headers: { origin: fixture.origin },
      })
      expect(signOut.ok()).toBe(true)
    } finally {
      await context.close()
    }
  })

  it('authorizes every tool call live against Convex state', async () => {
    const primary = await publicClientToken(clients.inspector, INSPECTOR_CALLBACK)
    const secondary = await publicClientToken(clients.mcpRemote, MCP_REMOTE_CALLBACK)
    const listed = await postMcp(
      resource,
      secondary.accessToken,
      toolsList('secondary-public-client-tools'),
    )
    expect(listed.status).toBe(200)
    const result = isRecord(listed.body.result) ? listed.body.result : {}
    expect((result.tools as JsonRecord[]).map((tool) => tool.name)).toEqual(TOOL_NAMES)

    const token = primary.accessToken
    const organizationId = clients.organizationId
    const authUserId = decodeJwtPart(token, 1).sub as string
    const list = (id: string, tenant = organizationId) =>
      toolCall(id, 'search_projects', { organizationId: tenant })
    const create = (id: string, name = 'MCP authorization project') =>
      toolCall(id, 'create_project', { name, organizationId })
    const denied = async (message: JsonRecord, code: string, description: string) =>
      expectApplicationError(await postMcp(resource, token, message), code, description)
    /** Change fixture state for one check, then restore it. */
    const whileState = async (
      set: JsonRecord & { fn: string },
      restore: JsonRecord & { fn: string },
      check: () => Promise<void>,
    ) => {
      const { fn, ...args } = set
      await fixture.runConvex(fn, args)
      try {
        await check()
      } finally {
        const { fn: restoreFn, ...restoreArgs } = restore
        await fixture.runConvex(restoreFn, restoreArgs)
      }
    }

    expect((await postMcp(resource, token, list('baseline'))).status).toBe(200)
    const foreignOrganizationId = await fixture.runConvex('evidence:createAlternateOrganization')
    expect(typeof foreignOrganizationId).toBe('string')
    const membership = { authUserId, organizationId, role: 'owner', status: 'active' }

    await whileState(
      { fn: 'evidence:setMembership', ...membership, status: 'removed' },
      { fn: 'evidence:setMembership', ...membership },
      () => denied(list('membership-removed'), 'NOT_FOUND', 'membership removal'),
    )
    await whileState(
      { fn: 'evidence:setMembership', ...membership, role: 'viewer' },
      { fn: 'evidence:setMembership', ...membership },
      () => denied(create('role-lowered'), 'FORBIDDEN', 'role reduction'),
    )
    await denied(
      list('foreign-tenant', foreignOrganizationId as string),
      'NOT_FOUND',
      'foreign tenant',
    )
    await whileState(
      { fn: 'evidence:setUserActive', active: false, authUserId },
      { fn: 'evidence:setUserActive', active: true, authUserId },
      () => denied(list('user-disabled'), 'ACCOUNT_DISABLED', 'product capability removal'),
    )
    await whileState(
      { fn: 'evidence:setResourceDisabled', disabled: true },
      { fn: 'evidence:setResourceDisabled', disabled: false },
      async () =>
        expectInvalidToken(
          await postMcp(resource, token, list('resource-disabled')),
          'provider resource disable',
        ),
    )
    await whileState(
      { fn: 'evidence:setClientResourceLinked', clientId: clients.inspector, linked: false },
      { fn: 'evidence:setClientResourceLinked', clientId: clients.inspector, linked: true },
      async () =>
        expectInvalidToken(
          await postMcp(resource, token, list('resource-unlinked')),
          'resource ownership unlink',
        ),
    )

    const projectName = 'MCP approval fixture'
    const project = done(await postMcp(resource, token, create('create-project', projectName)))
    expect(project).toMatchObject({ id: expect.any(String), name: projectName })
    const archive = (id: string) => toolCall(id, 'archive_project', { projectId: project.id })
    await whileState(
      {
        fn: 'evidence:setProjectOrganization',
        organizationId: foreignOrganizationId as string,
        projectId: project.id as string,
      },
      { fn: 'evidence:setProjectOrganization', organizationId, projectId: project.id as string },
      () => denied(archive('project-owner-changed'), 'NOT_FOUND', 'project tenant change'),
    )

    // Archiving waits for a person; the tool returns the request and its link.
    const asked = structured(await postMcp(resource, token, archive('approval')))
    expect(asked).toMatchObject({
      status: 'needs_approval',
      approvalId: expect.any(String),
      summary: `Archive the project "${projectName}".`,
      url: `${fixture.origin}/approvals/${String(asked.approvalId)}`,
    })

    // A human approves in the app with their own Convex session.
    const sessionToken = await primary.context.request.get(
      `${fixture.origin}/api/auth/convex/token`,
      {
        headers: { origin: fixture.origin },
      },
    )
    expect(sessionToken.ok()).toBe(true)
    const convexToken = ((await sessionToken.json()) as JsonRecord).token
    await expectConvexSessionToken(convexToken, fixture.origin, fixture.convexSiteUrl)
    const convex = new ConvexHttpClient(fixture.convexUrl)
    convex.setAuth(convexToken as string)
    await expect(
      convex.mutation(makeFunctionReference<'mutation'>('agents:approve'), {
        approvalId: asked.approvalId,
      }),
    ).resolves.toEqual({ status: 'approved' })
    expect(
      done(
        await postMcp(
          resource,
          token,
          toolCall('check-approval', 'check_approval', { approvalId: asked.approvalId }),
        ),
      ),
    ).toMatchObject({ status: 'approved' })
    expect(
      await fixture.runConvex('evidence:readApprovalState', {
        approvalId: asked.approvalId as string,
        projectId: project.id as string,
      }),
      'approved request ran once',
    ).toEqual({ approval: 'approved', project: { status: 'archived', archived: true } })

    // Revoking one JWT is not a blacklist: the self-contained token stays valid until expiry.
    const revoke = await fetch(`${fixture.origin}/api/auth/oauth2/revoke`, {
      body: new URLSearchParams({
        client_id: clients.inspector,
        token,
        token_type_hint: 'access_token',
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: fixture.origin },
      method: 'POST',
      redirect: 'manual',
    })
    expect(revoke.status).toBe(400)
    expect(await revoke.json()).toMatchObject({
      error: 'unsupported_token_type',
      error_description: expect.any(String),
    })
    expect(
      (await postMcp(resource, token, toolsList('post-revoke-self-contained-token'))).status,
    ).toBe(200)
  })

  it('revokes live access on sign-out, client, and consent deletion, and lists only granted tools', async () => {
    const terminal = await fixture.runConvex('evidence:provisionTerminalClients')
    const terminalClients = (
      isRecord(terminal) && isRecord(terminal.clients) ? terminal.clients : {}
    ) as Record<string, string>
    expect(Object.keys(terminalClients).sort()).toEqual([
      'clientDelete',
      'clientDisable',
      'conformance',
      'consentDelete',
      'sessionDelete',
    ])
    expect(isRecord(terminal) && terminal.resource).toBe(resource)
    const ids = new Set([clients.inspector, clients.mcpRemote, ...Object.values(terminalClients)])
    expect(ids.size).toBe(7)

    // The previous test used two of the three sign-ins in the current window.
    await sleep(SIGN_IN_WINDOW_MS)
    const seen = { tokens: new Set<string>(), sessions: new Set<string>(), jtis: new Set<string>() }
    const acquire = async (clientId: string, scope = SCOPE) => {
      const grant = await publicClientToken(clientId, INSPECTOR_CALLBACK, scope)
      const claims = decodeJwtPart(grant.accessToken, 1)
      expect(
        seen.tokens.has(grant.accessToken) ||
          seen.sessions.has(claims.sid as string) ||
          seen.jtis.has(claims.jti as string),
      ).toBe(false)
      seen.tokens.add(grant.accessToken)
      seen.sessions.add(claims.sid as string)
      seen.jtis.add(claims.jti as string)
      const baseline = await postMcp(
        resource,
        grant.accessToken,
        toolCall('terminal-baseline', 'search_projects', {
          organizationId: clients.organizationId,
        }),
      )
      expect(baseline.status, 'fresh terminal-case grant is live').toBe(200)
      return grant
    }
    const expectRevoked = async (grant: { accessToken: string }, description: string) =>
      expectInvalidToken(
        await postMcp(
          resource,
          grant.accessToken,
          toolCall(`terminal-${description}`, 'search_projects', {
            organizationId: clients.organizationId,
          }),
        ),
        description,
      )

    const session = await acquire(terminalClients.sessionDelete!)
    const signOut = await session.context.request.post(`${fixture.origin}/api/auth/sign-out`, {
      data: {},
      headers: { origin: fixture.origin },
    })
    expect(signOut.ok()).toBe(true)
    await expectRevoked(session, 'session deletion')

    const disabled = await acquire(terminalClients.clientDisable!)
    await fixture.runConvex('evidence:setClientDisabled', {
      clientId: terminalClients.clientDisable!,
      disabled: true,
    })
    await expectRevoked(disabled, 'client disable')

    const deleted = await acquire(terminalClients.clientDelete!)
    await fixture.runConvex('evidence:deleteClient', { clientId: terminalClients.clientDelete! })
    await expectRevoked(deleted, 'client deletion')

    await sleep(SIGN_IN_WINDOW_MS)
    const consent = await acquire(terminalClients.consentDelete!)
    // The same library call the starter's connections page makes for the signed-in user.
    await fixture.runConvex('evidence:revokeConnection', {
      authUserId: decodeJwtPart(consent.accessToken, 1).sub as string,
      clientId: terminalClients.consentDelete!,
    })
    await expectRevoked(consent, 'consent deletion')

    // A read-only grant sees only read tools, and a write tool is not there to call.
    const readOnly = await acquire(terminalClients.conformance!, 'mcp:read')
    const readTools = await postMcp(resource, readOnly.accessToken, toolsList('read-only-tools'))
    const readResult = isRecord(readTools.body.result) ? readTools.body.result : {}
    expect((readResult.tools as JsonRecord[]).map((tool) => tool.name)).toEqual(READ_TOOL_NAMES)
    const write = await postMcp(
      resource,
      readOnly.accessToken,
      toolCall('read-only-write', 'create_project', {
        name: 'Read-only evidence',
        organizationId: clients.organizationId,
      }),
    )
    expect(JSON.stringify(write.body)).toMatch(/create_project/)
    expect(JSON.stringify(write.body)).not.toContain('"status":"done"')

    await expectStatelessProtocol(readOnly.accessToken)
  })

  /** The official client SDK against the server: stateless HTTP envelope and the advertised surface only. */
  async function expectStatelessProtocol(bearer: string) {
    const exchanges: Array<{
      method: unknown
      status: number
      request: Headers
      response: Headers
      requestBody: JsonRecord
      responseBody: JsonRecord
    }> = []
    const observed = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      const requestBody = JSON.parse(await request.clone().text()) as JsonRecord
      const response = await fetch(request)
      const responseBody = (await response.clone().json()) as JsonRecord
      exchanges.push({
        method: requestBody.method,
        status: response.status,
        request: request.headers,
        response: response.headers,
        requestBody,
        responseBody,
      })
      return response
    }
    const client = new Client(
      { name: 'better-convex-conformance', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: PROTOCOL_VERSION } } },
    )
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(resource), {
          fetch: observed,
          requestInit: { headers: { authorization: `Bearer ${bearer}` } },
        }),
      )
      await client.listTools()
    } finally {
      await client.close().catch(() => {})
    }

    expect(exchanges.map((exchange) => exchange.method)).toEqual(['server/discover', 'tools/list'])
    for (const exchange of exchanges) {
      expect(exchange.status).toBe(200)
      expect(exchange.request.get('mcp-protocol-version')).toBe(PROTOCOL_VERSION)
      expect(exchange.request.get('mcp-method')).toBe(exchange.method)
      expect(
        exchange.request.has('mcp-session-id') || exchange.response.has('mcp-session-id'),
      ).toBe(false)
      const meta = (exchange.requestBody.params as JsonRecord | undefined)?._meta as
        | JsonRecord
        | undefined
      expect(meta?.['io.modelcontextprotocol/protocolVersion']).toBe(PROTOCOL_VERSION)
      expect(meta?.['io.modelcontextprotocol/clientCapabilities']).toBeDefined()
      const clientInfo = meta?.['io.modelcontextprotocol/clientInfo']
      if (clientInfo !== undefined) expect(typeof (clientInfo as JsonRecord).name).toBe('string')
      const result = exchange.responseBody.result as JsonRecord
      expect(result.resultType).toBe('complete')
      expect(result._meta).toMatchObject({
        'io.modelcontextprotocol/serverInfo': {
          name: expect.any(String),
          version: expect.any(String),
        },
      })
    }
    const discovered = exchanges[0]!.responseBody.result as JsonRecord
    expect(discovered.supportedVersions).toEqual([PROTOCOL_VERSION])
    expect(Object.keys(discovered.capabilities as JsonRecord).sort()).toEqual(['tools'])
    expect(discovered).toMatchObject({ ttlMs: 0, cacheScope: 'private' })
    const listed = exchanges[1]!.responseBody.result as JsonRecord
    expect(listed).toMatchObject({ ttlMs: 0, cacheScope: 'private' })
    const tools = listed.tools as JsonRecord[]
    expect(tools.length).toBeGreaterThan(0)
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({
        type: 'object',
        $schema: 'https://json-schema.org/draft/2020-12/schema',
      })
    }

    const toolsRequest = exchanges[1]!.requestBody
    const raw = async (body: JsonRecord, headers: Record<string, string>) => {
      const response = await fetch(resource, {
        body: JSON.stringify(body),
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
          'mcp-protocol-version': PROTOCOL_VERSION,
          ...headers,
        },
        method: 'POST',
      })
      const text = await response.text()
      expect(text, 'a protocol response echoed the bearer').not.toContain(bearer)
      return { status: response.status, body: JSON.parse(text) as JsonRecord }
    }
    const expectProtocolError = (
      response: { status: number; body: JsonRecord },
      status: number,
      code: number,
      description: string,
    ) => {
      expect(response.status, description).toBe(status)
      expect((response.body.error as JsonRecord | undefined)?.code, description).toBe(code)
      expect(response.body.result, description).toBeUndefined()
    }

    const withoutClientInfo = structuredClone(toolsRequest)
    delete ((withoutClientInfo.params as JsonRecord)._meta as JsonRecord)[
      'io.modelcontextprotocol/clientInfo'
    ]
    const optional = await raw(withoutClientInfo, { 'mcp-method': 'tools/list' })
    expect(optional.status, 'clientInfo is optional').toBe(200)
    expect((optional.body.result as JsonRecord).resultType).toBe('complete')

    expectProtocolError(await raw(toolsRequest, {}), 400, -32020, 'missing method header')
    expectProtocolError(
      await raw(toolsRequest, { 'mcp-method': 'prompts/list' }),
      400,
      -32020,
      'method mismatch',
    )
    for (const method of ['prompts/list', 'resources/list', 'tasks/get']) {
      const unsupported = { ...structuredClone(toolsRequest), method }
      expectProtocolError(
        await raw(unsupported, { 'mcp-method': method }),
        404,
        -32601,
        `unadvertised ${method}`,
      )
    }
    const call = structuredClone(toolsRequest)
    call.method = 'tools/call'
    call.params = { ...(call.params as JsonRecord), name: tools[0]!.name, arguments: {} }
    expectProtocolError(
      await raw(call, { 'mcp-method': 'tools/call', 'mcp-name': 'wrong-tool-name' }),
      400,
      -32020,
      'tool-name mismatch',
    )
  }
})
