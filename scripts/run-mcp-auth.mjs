#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client'
import { verifyBearerToken as verifyOfficialJwt } from 'better-auth/oauth2'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { chromium } from 'playwright'

import {
  MCP_FIXTURE_SCOPE,
  MCP_REMOTE_CALLBACK,
  MCP_TOOL_NAMES,
  normalizeEvidenceOrigin,
} from './mcp-auth-contracts.mjs'
import {
  parseMcpEvidenceFixtureConfiguration,
  safeMcpFixtureChildEnvironment,
  startMcpEvidenceFixture,
} from './mcp-evidence-fixture.mjs'

const INSPECTOR_ORIGIN = 'http://localhost:6274'
const AUTH_TIMEOUT_MS = 60_000
const SIGN_IN_RATE_LIMIT_WINDOW_MS = 10_000

function safeChildEnvironment() {
  return safeMcpFixtureChildEnvironment()
}

function monitorBrowserPage(page, applicationOrigin) {
  const failures = []
  const location = (value) => {
    try {
      const url = new URL(value)
      return {
        label: `${url.origin}${url.pathname}`,
        origin: url.origin,
        pathname: url.pathname,
      }
    } catch {
      return { label: '<invalid-url>', origin: '', pathname: '' }
    }
  }
  const isExpectedBootstrapPath = (pathname) =>
    pathname.startsWith('/_nuxt/') ||
    pathname.startsWith('/.well-known/') ||
    pathname === '/api/auth/convex/token'
  page.on('pageerror', () => {
    if (location(page.url()).origin === applicationOrigin) failures.push('pageerror')
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const source = location(message.location().url)
    if (source.origin === applicationOrigin && !isExpectedBootstrapPath(source.pathname)) {
      failures.push(`console:${source.label}`)
    }
  })
  page.on('requestfailed', (request) => {
    if (request.isNavigationRequest() && request.failure()?.errorText === 'net::ERR_ABORTED') return
    const target = location(request.url())
    if (target.origin === applicationOrigin && !isExpectedBootstrapPath(target.pathname)) {
      failures.push(`request:${request.method()}:${target.label}`)
    }
  })
  page.on('response', (response) => {
    if (response.status() < 400) return
    const target = location(response.url())
    if (target.origin === applicationOrigin) {
      failures.push(`response:${response.request().method()}:${response.status()}:${target.label}`)
    }
  })
  return (label) => {
    if (failures.length > 0) {
      throw new Error(`${label} emitted unexpected browser failures: ${failures.join(', ')}`)
    }
  }
}

async function verifyDiscoveryDocuments(context, origin, resource) {
  const issuer = `${origin}/api/auth`
  const resourceOrigin = new URL(resource).origin
  const authorizationResponse = await context.request.get(
    `${origin}/.well-known/oauth-authorization-server/api/auth`,
  )
  if (authorizationResponse.status() !== 200) {
    throw new Error('OAuth authorization-server discovery was unavailable')
  }
  const authorization = await authorizationResponse.json()
  if (
    authorization.issuer !== issuer ||
    authorization.authorization_endpoint !== `${issuer}/oauth2/authorize` ||
    authorization.token_endpoint !== `${issuer}/oauth2/token` ||
    authorization.revocation_endpoint !== `${issuer}/oauth2/revoke` ||
    authorization.jwks_uri !== `${issuer}/jwks` ||
    JSON.stringify(authorization.grant_types_supported) !==
      JSON.stringify(['authorization_code']) ||
    JSON.stringify(authorization.code_challenge_methods_supported) !== JSON.stringify(['S256'])
  ) {
    throw new Error('OAuth authorization-server discovery escaped the fixed profile')
  }

  const resourceResponse = await context.request.get(
    `${resourceOrigin}/.well-known/oauth-protected-resource/mcp`,
  )
  if (resourceResponse.status() !== 200) {
    throw new Error('OAuth protected-resource discovery was unavailable')
  }
  const protectedResource = await resourceResponse.json()
  if (
    protectedResource.resource !== resource ||
    JSON.stringify(protectedResource.authorization_servers) !== JSON.stringify([issuer]) ||
    JSON.stringify(protectedResource.scopes_supported) !== JSON.stringify(['mcp:read', 'mcp:write'])
  ) {
    throw new Error('OAuth protected-resource discovery escaped the fixed profile')
  }
  for (const response of [authorizationResponse, resourceResponse]) {
    if (
      response.headers()['access-control-allow-origin'] !== '*' ||
      response.headers()['set-cookie'] !== undefined
    ) {
      throw new Error('OAuth discovery response exposed credentials or non-public CORS')
    }
  }
}

async function runLocalMcpTests(root) {
  const builtMcp = spawnSync('pnpm', ['exec', 'unbuild', 'packages/mcp'], {
    cwd: root,
    env: safeChildEnvironment(),
    stdio: 'inherit',
  })
  if (builtMcp.error) throw builtMcp.error
  if (builtMcp.status !== 0) {
    throw new Error(`MCP workspace build failed with exit code ${builtMcp.status}`)
  }
  const prepared = spawnSync('pnpm', ['exec', 'nuxt-module-build', 'prepare'], {
    cwd: root,
    env: safeChildEnvironment(),
    stdio: 'inherit',
  })
  if (prepared.error) throw prepared.error
  if (prepared.status !== 0) {
    throw new Error(`MCP workspace preparation failed with exit code ${prepared.status}`)
  }
  const result = spawnSync('pnpm', ['exec', 'vitest', 'run', '--project=mcp'], {
    cwd: root,
    env: safeChildEnvironment(),
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Local MCP security tests failed with exit code ${result.status}`)
  }
}

async function acquirePublicClientToken({
  browser,
  callback,
  clientId,
  email,
  origin,
  password,
  resource,
  scope = MCP_FIXTURE_SCOPE,
}) {
  const context = await browser.newContext({ viewport: { height: 900, width: 1440 } })
  const page = await context.newPage()
  const assertBrowserClean = monitorBrowserPage(page, origin)
  const callbackUrl = new URL(callback)
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(32).toString('base64url')
  let callbackHref
  await page.route(
    (url) => url.origin === callbackUrl.origin && url.pathname === callbackUrl.pathname,
    async (route) => {
      callbackHref = route.request().url()
      await route.fulfill({
        body: '<!doctype html><title>OAuth complete</title>',
        contentType: 'text/html; charset=utf-8',
        status: 200,
      })
    },
  )
  const authorization = new URL(`${origin}/api/auth/oauth2/authorize`)
  for (const [name, value] of [
    ['response_type', 'code'],
    ['client_id', clientId],
    ['redirect_uri', callback],
    ['code_challenge', challenge],
    ['code_challenge_method', 'S256'],
    ['resource', resource],
    ['scope', scope],
    ['state', state],
  ]) {
    authorization.searchParams.set(name, value)
  }

  try {
    await page.goto(authorization.href, { waitUntil: 'domcontentloaded' })
    const deadline = Date.now() + AUTH_TIMEOUT_MS
    let signedIn = false
    let approved = false
    while (!callbackHref && Date.now() < deadline) {
      const current = new URL(page.url())
      if (![origin, callbackUrl.origin].includes(current.origin)) {
        throw new Error(`OAuth browser escaped the fixed fixture origins to ${current.origin}`)
      }
      const emailInput = page.getByTestId('email')
      if (!signedIn && (await emailInput.isVisible().catch(() => false))) {
        await emailInput.fill(email)
        await page.getByTestId('password').fill(password)
        await page.getByTestId('sign-in').click()
        signedIn = true
        continue
      }
      const approve = page.getByTestId('approve-consent')
      if (!approved && (await approve.isVisible().catch(() => false))) {
        await approve.click()
        approved = true
        continue
      }
      const alert = page.getByRole('alert').first()
      if (await alert.isVisible().catch(() => false)) {
        const text = (await alert.textContent())?.trim()
        throw new Error(
          text === 'Sign in failed'
            ? 'Fixture administrator sign-in failed on the OAuth login page'
            : 'Provider-signed OAuth transaction verification failed on the authorization page',
        )
      }
      await page.waitForTimeout(100)
    }
    if (!callbackHref) throw new Error('Timed out completing the direct PKCE authorization')
    const returned = new URL(callbackHref)
    if (
      returned.origin !== callbackUrl.origin ||
      returned.pathname !== callbackUrl.pathname ||
      returned.searchParams.get('state') !== state ||
      returned.searchParams.get('iss') !== `${origin}/api/auth` ||
      returned.searchParams.has('error')
    ) {
      throw new Error('OAuth callback escaped its exact redirect, state, or issuer binding')
    }
    const code = returned.searchParams.get('code')
    if (!code || code.length > 4096) throw new Error('OAuth callback omitted a bounded code')
    const tokenResponse = await context.request.post(`${origin}/api/auth/oauth2/token`, {
      form: {
        client_id: clientId,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: callback,
        resource,
      },
      headers: { origin },
    })
    const tokenBody = await tokenResponse.json().catch(() => null)
    if (!tokenResponse.ok() || typeof tokenBody?.access_token !== 'string') {
      throw new Error(
        `Direct PKCE token exchange failed (${tokenResponse.status()}:${String(tokenBody?.error ?? 'invalid_response')})`,
      )
    }
    verifyPublicClientTokenBindings(tokenBody.access_token, {
      clientId,
      origin,
      resource,
      scope,
    })
    try {
      const verifyBearerToken = oauthProviderResourceClient().getActions().verifyBearerToken
      await verifyBearerToken(tokenBody.access_token, {
        jwksUrl: `${origin}/api/auth/jwks`,
        verifyOptions: {
          algorithms: ['RS256'],
          audience: resource,
          clockTolerance: 0,
          issuer: `${origin}/api/auth`,
          maxTokenAge: '600s',
          typ: 'at+jwt',
        },
      })
    } catch {
      throw new Error('Direct PKCE token failed the official resource verifier')
    }
    assertBrowserClean('direct public-client OAuth journey')
    return { accessToken: tokenBody.access_token, context }
  } catch (error) {
    await context.close().catch(() => {})
    throw error
  } finally {
    await page.close().catch(() => {})
  }
}

function verifyPublicClientTokenBindings(
  accessToken,
  { clientId, origin, resource, scope = MCP_FIXTURE_SCOPE },
) {
  let result
  try {
    const parts = accessToken.split('.')
    if (parts.length !== 3) result = { malformed: false }
    else {
      const header = decodeJwtPart(accessToken, 0)
      const claims = decodeJwtPart(accessToken, 1)
      const now = Math.floor(Date.now() / 1000)
      result = {
        algorithm: header.alg === 'RS256',
        audience: claims.aud === resource,
        claims:
          JSON.stringify(Object.keys(claims ?? {}).sort()) ===
          JSON.stringify([
            'aud',
            'azp',
            'client_id',
            'exp',
            'iat',
            'iss',
            'jti',
            'scope',
            'sid',
            'sub',
            'token_use',
          ]),
        client: claims.client_id === clientId && claims.azp === clientId,
        current:
          Number.isSafeInteger(claims.iat) &&
          Number.isSafeInteger(claims.exp) &&
          claims.iat <= now + 60 &&
          claims.exp > now &&
          claims.exp - claims.iat <= 600,
        issuer: claims.iss === `${origin}/api/auth`,
        noDpop: claims.cnf === undefined,
        scope: claims.scope === scope,
        session: typeof claims.sid === 'string' && claims.sid.length > 0,
        subject: typeof claims.sub === 'string' && claims.sub.length > 0,
        tokenClass: claims.token_use === 'oauth-access',
        type: header.typ === 'at+jwt',
      }
    }
  } catch {
    result = { malformed: false }
  }
  const failures = Object.entries(result)
    .filter(([, valid]) => valid !== true)
    .map(([name]) => name)
  if (failures.length > 0) {
    throw new Error(
      `Public OAuth client received a token with invalid ${failures.join(', ')} binding`,
    )
  }
}

function decodeJwtPart(token, index) {
  const part = token.split('.')[index]
  if (!part) throw new Error('Convex session-token response was not a compact JWT')
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Convex session-token response was not a compact JWT')
  }
}

async function postMcpJson(context, url, accessToken, message) {
  const requestBody = {
    ...message,
    params: {
      ...message.params,
      _meta: {
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': {
          name: 'better-convex-live-evidence',
          version: '1.0.0',
        },
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      },
    },
  }
  const operationName = typeof message.params?.name === 'string' ? message.params.name : undefined
  const response = await context.request.post(url, {
    data: requestBody,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      'mcp-method': message.method,
      ...(operationName === undefined ? {} : { 'mcp-name': operationName }),
      'mcp-protocol-version': '2026-07-28',
    },
  })
  const text = await response.text()
  if (text.length > 128 * 1024) throw new Error('MCP evidence response exceeded its bound')
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`MCP evidence response was not JSON (${response.status()})`)
  }
  return {
    allow: response.headers().allow ?? null,
    body,
    challenge: response.headers()['www-authenticate'] ?? null,
    status: response.status(),
  }
}

function requireExactToolNames(snapshot, description) {
  const names = snapshot.body?.result?.tools?.map((tool) => tool?.name)
  if (
    snapshot.status !== 200 ||
    !Array.isArray(names) ||
    JSON.stringify(names) !== JSON.stringify(MCP_TOOL_NAMES)
  ) {
    const errorCode = snapshot.body?.code ?? snapshot.body?.error
    const code = typeof errorCode === 'string' ? `:${errorCode}` : ''
    throw new Error(
      `${description} did not return the exact fixed MCP tool surface (${snapshot.status}${code})`,
    )
  }
}

function requireApplicationFailure(snapshot, code, description) {
  const content = snapshot.body?.result?.content
  let projected
  try {
    projected =
      Array.isArray(content) &&
      content.length === 1 &&
      content[0]?.type === 'text' &&
      typeof content[0].text === 'string'
        ? JSON.parse(content[0].text)
        : undefined
  } catch {
    projected = undefined
  }
  if (
    snapshot.status !== 200 ||
    snapshot.challenge !== null ||
    snapshot.body?.result?.resultType !== 'complete' ||
    snapshot.body?.result?.isError !== true ||
    JSON.stringify(projected) !== JSON.stringify({ code })
  ) {
    throw new Error(`${description} did not fail with ${code}`)
  }
}

function requireInvalidToken(snapshot, description) {
  if (
    snapshot.status !== 401 ||
    snapshot.body?.error !== 'invalid_token' ||
    snapshot.body?.result !== undefined ||
    typeof snapshot.challenge !== 'string' ||
    !snapshot.challenge.startsWith('Bearer ')
  ) {
    throw new Error(`${description} did not fail with 401/invalid_token`)
  }
}

function toolCall(id, name, args) {
  return {
    id,
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { arguments: args, name },
  }
}

function structuredToolResult(snapshot, description) {
  const value = snapshot.body?.result?.structuredContent
  if (snapshot.status !== 200 || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${description} did not return a structured MCP tool result`)
  }
  return value
}

async function runWithFixtureState(set, restore, verify) {
  await set()
  try {
    await verify()
  } finally {
    await restore()
  }
}

async function assertConvexSessionToken(token, origin, convexSiteUrl) {
  if (
    typeof token !== 'string' ||
    token.length > 8192 ||
    !/^[\w-]+\.[\w-]+\.[\w-]+$/u.test(token)
  ) {
    throw new Error('Convex session-token response was not a compact JWT')
  }
  const header = decodeJwtPart(token, 0)
  const claims = decodeJwtPart(token, 1)
  const approvedClaims = ['aud', 'exp', 'iat', 'iss', 'sid', 'sub', 'token_use']
  if (
    header?.alg !== 'RS256' ||
    typeof header?.kid !== 'string' ||
    header.kid.length === 0 ||
    JSON.stringify(Object.keys(header).sort()) !== JSON.stringify(['alg', 'kid']) ||
    JSON.stringify(Object.keys(claims ?? {}).sort()) !== JSON.stringify(approvedClaims) ||
    claims.aud !== 'convex' ||
    claims.iss !== convexSiteUrl ||
    claims.token_use !== 'convex-session' ||
    typeof claims.sid !== 'string' ||
    claims.sid.length === 0 ||
    typeof claims.sub !== 'string' ||
    claims.sub.length === 0 ||
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > 15 * 60
  ) {
    throw new Error('Convex session-token response had an invalid header or claim binding')
  }
  try {
    await verifyOfficialJwt(token, {
      jwksUrl: `${origin}/api/auth/jwks`,
      verifyOptions: {
        algorithms: ['RS256'],
        audience: 'convex',
        clockTolerance: 0,
        issuer: convexSiteUrl,
        maxTokenAge: '900s',
      },
    })
  } catch {
    throw new Error('Convex session-token signature did not verify against the published JWKS')
  }
}

async function provisionInteropProfile(
  context,
  origin,
  resource,
  convexSiteUrl,
  fixtureEmail,
  fixturePassword,
) {
  const requestOptions = { headers: { origin } }
  const signIn = await context.request.post(`${origin}/api/auth/sign-in/email`, {
    ...requestOptions,
    data: {
      email: fixtureEmail,
      password: fixturePassword,
    },
  })
  if (!signIn.ok()) throw new Error('MCP fixture administrator sign-in failed')

  const convexTokenResponse = await context.request.get(`${origin}/api/auth/convex/token`, {
    headers: { origin },
  })
  if (!convexTokenResponse.ok()) {
    throw new Error('Mounted OAuth provider broke authenticated Convex session-token issuance')
  }
  const convexTokenBody = await convexTokenResponse.json()
  await assertConvexSessionToken(convexTokenBody?.token, origin, convexSiteUrl)

  const response = await context.request.post(`${origin}/api/auth/mcp/admin/provision`, {
    ...requestOptions,
    data: {},
  })
  if (!response.ok()) throw new Error('MCP provider-owned interoperability provisioning failed')
  const profile = await response.json()
  const inspector = profile?.clients?.inspector
  const mcpRemote = profile?.clients?.mcpRemote
  const organizationId = profile?.organizationId
  if (
    profile?.resource !== resource ||
    typeof inspector !== 'string' ||
    inspector.length === 0 ||
    typeof mcpRemote !== 'string' ||
    mcpRemote.length === 0 ||
    inspector === mcpRemote ||
    typeof organizationId !== 'string' ||
    organizationId.length === 0
  ) {
    throw new Error('MCP interoperability profile response was invalid')
  }

  const signOut = await context.request.post(`${origin}/api/auth/sign-out`, {
    ...requestOptions,
    data: {},
  })
  if (!signOut.ok()) throw new Error('MCP fixture administrator session cleanup failed')
  await context.clearCookies()
  return { inspector, mcpRemote, organizationId }
}

async function provisionTerminalEvidence(context, origin, resource, organizationId, excludedIds) {
  const response = await context.request.post(
    `${origin}/api/auth/mcp/admin/provision-terminal-evidence`,
    { data: {}, headers: { origin } },
  )
  if (!response.ok()) throw new Error('MCP terminal evidence provisioning failed')
  const profile = await response.json()
  const clients = profile?.clients
  const keys = ['clientDelete', 'clientDisable', 'conformance', 'consentDelete', 'sessionDelete']
  const ids = keys.map((key) => clients?.[key])
  if (
    profile?.resource !== resource ||
    profile?.organizationId !== organizationId ||
    Object.keys(clients ?? {})
      .sort()
      .join(',') !== keys.sort().join(',') ||
    ids.some((id) => typeof id !== 'string' || id.length === 0) ||
    new Set([...excludedIds, ...ids]).size !== excludedIds.length + ids.length
  ) {
    throw new Error('MCP terminal evidence profile response was invalid')
  }
  return clients
}

async function verifyRevocationProtocol(context, accessToken, clientId, origin, resource) {
  const response = await fetch(`${origin}/api/auth/oauth2/revoke`, {
    body: new URLSearchParams({
      client_id: clientId,
      token: accessToken,
      token_type_hint: 'access_token',
    }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin,
    },
    method: 'POST',
    redirect: 'manual',
  })
  const body = await response.json().catch(() => null)
  if (
    response.status !== 400 ||
    body?.error !== 'unsupported_token_type' ||
    typeof body.error_description !== 'string'
  ) {
    throw new Error(
      `OAuth JWT revocation returned an unexpected response (${response.status}, ${body?.error ?? 'no error code'})`,
    )
  }

  const stillAuthorized = await postMcpJson(context, resource, accessToken, {
    id: 'post-revoke-self-contained-token',
    jsonrpc: '2.0',
    method: 'tools/list',
    params: {},
  })
  if (stillAuthorized.status !== 200) {
    throw new Error(
      'Individual-token revocation was incorrectly treated as an immediate JWT blacklist',
    )
  }
}

async function requireProviderOperation(response, description) {
  await response.body().catch(() => undefined)
  if (!response.ok()) throw new Error(`${description} failed with ${response.status()}`)
}

async function runLiveAuthorizationEvidence({
  accessToken,
  clientId,
  context,
  convexUrl,
  fixture,
  organizationId,
  origin,
  resource,
}) {
  const convexSiteUrl = new URL(resource).origin
  const claims = decodeJwtPart(accessToken, 1)
  const authUserId = claims.sub
  if (typeof authUserId !== 'string' || authUserId.length === 0) {
    throw new Error('Live MCP evidence token had no subject')
  }
  const list = (id = 'bcn-live-list') => toolCall(id, 'projects.list', { organizationId })
  const create = (id, name = 'MCP authorization project') =>
    toolCall(id, 'projects.create', { name, organizationId })
  const expectDenied = async (message, code, description) => {
    const snapshot = await postMcpJson(context, resource, accessToken, message)
    requireApplicationFailure(snapshot, code, description)
  }
  const baseline = await postMcpJson(context, resource, accessToken, list())
  if (baseline.status !== 200) throw new Error('Baseline live MCP authorization failed')

  const alternateOrganizationId = await fixture.runConvex(
    'mcpAdmin:createFixtureAlternateOrganization',
    { authUserId },
  )
  if (typeof alternateOrganizationId !== 'string' || alternateOrganizationId.length === 0) {
    throw new Error('Alternate MCP fixture tenant was invalid')
  }

  const activeMembership = {
    authUserId,
    organizationId,
    role: 'owner',
    status: 'active',
  }
  await runWithFixtureState(
    () =>
      fixture.runConvex('mcpAdmin:setFixtureMembership', {
        ...activeMembership,
        status: 'removed',
      }),
    () => fixture.runConvex('mcpAdmin:setFixtureMembership', activeMembership),
    () => expectDenied(list('membership-removed'), 'MCP_ACCESS_REVOKED', 'membership removal'),
  )
  await runWithFixtureState(
    () =>
      fixture.runConvex('mcpAdmin:setFixtureMembership', {
        ...activeMembership,
        role: 'viewer',
      }),
    () => fixture.runConvex('mcpAdmin:setFixtureMembership', activeMembership),
    () => expectDenied(create('role-lowered'), 'MCP_ACCESS_REVOKED', 'role reduction'),
  )

  const activeDelegation = {
    authUserId,
    clientId,
    organizationId,
    scopes: ['mcp:read', 'mcp:write'],
    status: 'active',
  }
  await runWithFixtureState(
    () =>
      fixture.runConvex('mcpAdmin:setFixtureDelegation', {
        ...activeDelegation,
        status: 'revoked',
      }),
    () => fixture.runConvex('mcpAdmin:setFixtureDelegation', activeDelegation),
    () => expectDenied(list('delegation-revoked'), 'MCP_ACCESS_REVOKED', 'delegation revocation'),
  )
  await runWithFixtureState(
    () =>
      fixture.runConvex('mcpAdmin:setFixtureDelegation', {
        ...activeDelegation,
        scopes: ['mcp:read'],
      }),
    () => fixture.runConvex('mcpAdmin:setFixtureDelegation', activeDelegation),
    () =>
      expectDenied(create('delegation-scope'), 'MCP_SCOPE_REQUIRED', 'delegation scope removal'),
  )
  await runWithFixtureState(
    () =>
      fixture.runConvex('mcpAdmin:setFixtureDelegation', {
        ...activeDelegation,
        organizationId: alternateOrganizationId,
      }),
    () => fixture.runConvex('mcpAdmin:setFixtureDelegation', activeDelegation),
    () => expectDenied(list('tenant-changed'), 'MCP_ACCESS_REVOKED', 'delegation tenant change'),
  )
  await runWithFixtureState(
    () =>
      fixture.runConvex('mcpAdmin:setFixtureUserActive', {
        active: false,
        authUserId,
      }),
    () =>
      fixture.runConvex('mcpAdmin:setFixtureUserActive', {
        active: true,
        authUserId,
      }),
    () => expectDenied(list('user-disabled'), 'MCP_ACCESS_REVOKED', 'product capability removal'),
  )

  await runWithFixtureState(
    async () => {
      const response = await context.request.post(
        `${origin}/api/auth/mcp/admin/disable-resource-fixture`,
        { data: {}, headers: { origin } },
      )
      await requireProviderOperation(response, 'Provider resource disable')
    },
    async () => {
      const response = await context.request.post(
        `${origin}/api/auth/mcp/admin/enable-resource-fixture`,
        { data: {}, headers: { origin } },
      )
      await requireProviderOperation(response, 'Provider resource restore')
    },
    async () => {
      const snapshot = await postMcpJson(context, resource, accessToken, list('resource-disabled'))
      if (
        snapshot.status !== 200 ||
        snapshot.challenge !== null ||
        snapshot.body?.result?.resultType !== 'complete' ||
        snapshot.body?.result?.isError === true
      ) {
        throw new Error('Provider resource disable revoked an already-issued token')
      }
    },
  )

  await runWithFixtureState(
    async () => {
      const response = await context.request.post(
        `${origin}/api/auth/mcp/admin/unlink-inspector-resource-fixture`,
        { data: {}, headers: { origin } },
      )
      await requireProviderOperation(response, 'Provider client-resource unlink')
    },
    async () => {
      const response = await context.request.post(
        `${origin}/api/auth/mcp/admin/link-inspector-resource-fixture`,
        { data: {}, headers: { origin } },
      )
      await requireProviderOperation(response, 'Provider client-resource relink')
    },
    async () =>
      requireInvalidToken(
        await postMcpJson(context, resource, accessToken, list('resource-unlinked')),
        'resource ownership unlink',
      ),
  )

  const projectName = 'MCP destructive fixture'
  const createResponse = await postMcpJson(
    context,
    resource,
    accessToken,
    create('create-project', projectName),
  )
  const project = structuredToolResult(createResponse, 'Convex project create')
  if (typeof project.id !== 'string' || project.name !== projectName) {
    throw new Error('Convex project creation evidence was invalid')
  }

  await runWithFixtureState(
    () =>
      fixture.runConvex('mcpAdmin:setFixtureProjectOrganization', {
        authUserId,
        organizationId: alternateOrganizationId,
        projectId: project.id,
      }),
    () =>
      fixture.runConvex('mcpAdmin:setFixtureProjectOrganization', {
        authUserId,
        organizationId,
        projectId: project.id,
      }),
    () =>
      expectDenied(
        toolCall('project-owner-changed', 'projects.delete.preview', {
          organizationId,
          projectId: project.id,
        }),
        'MCP_RESOURCE_NOT_FOUND',
        'project resource ownership change',
      ),
  )

  const previewResponse = await postMcpJson(
    context,
    resource,
    accessToken,
    toolCall('preview', 'projects.delete.preview', {
      organizationId,
      projectId: project.id,
    }),
  )
  const preview = structuredToolResult(previewResponse, 'Convex deletion preview')
  if (
    preview.project?.name !== projectName ||
    preview.operation !== 'projects.delete' ||
    preview.requiresApproval !== true ||
    preview.reversible !== true
  ) {
    throw new Error('Convex destructive preview evidence was invalid')
  }

  const approvalResponse = await postMcpJson(
    context,
    resource,
    accessToken,
    toolCall('approval', 'projects.delete.requestApproval', {
      organizationId,
      projectId: project.id,
    }),
  )
  const approval = structuredToolResult(approvalResponse, 'Convex approval request')
  if (typeof approval.approvalId !== 'string' || approval.status !== 'waiting_for_approval') {
    throw new Error('Convex approval-request evidence was invalid')
  }

  const execute = (id, projectId, approvalId) =>
    toolCall(id, 'projects.delete.execute', {
      approvalId,
      organizationId,
      projectId,
    })
  const blocked = await postMcpJson(
    context,
    resource,
    accessToken,
    execute('execute-unapproved', project.id, approval.approvalId),
  )
  requireApplicationFailure(blocked, 'MCP_APPROVAL_REQUIRED', 'unapproved destructive operation')

  const convexTokenResponse = await context.request.get(`${origin}/api/auth/convex/token`, {
    headers: { origin },
  })
  if (!convexTokenResponse.ok()) throw new Error('Human approval session-token issuance failed')
  const convexToken = (await convexTokenResponse.json())?.token
  await assertConvexSessionToken(convexToken, origin, convexSiteUrl)
  const convex = new ConvexHttpClient(convexUrl)
  convex.setAuth(convexToken)
  const approve = makeFunctionReference('approvals:approveProjectDelete')
  await convex.mutation(approve, { approvalId: approval.approvalId })

  const executed = await postMcpJson(
    context,
    resource,
    accessToken,
    execute('execute-approved', project.id, approval.approvalId),
  )
  const execution = structuredToolResult(executed, 'Convex approved deletion')
  if (execution.status !== 'deleted') {
    throw new Error('Convex approved deletion evidence was invalid')
  }

  const state = await fixture.runConvex('mcpAdmin:readFixtureDestructiveState', {
    approvalIds: [approval.approvalId],
    projectIds: [project.id],
  })
  const expectedProjects = [{ exists: true, hasDeletedAt: true, status: 'deleted' }]
  const expectedApprovals = [{ exists: true, hasUsedAt: true, status: 'used' }]
  if (
    JSON.stringify(state?.projects) !== JSON.stringify(expectedProjects) ||
    JSON.stringify(state?.approvals) !== JSON.stringify(expectedApprovals)
  ) {
    throw new Error('Soft-delete reversibility or single-use approval evidence was invalid')
  }
}

async function runTerminalRevocationEvidence({
  browser,
  callback,
  clients,
  email,
  organizationId,
  origin,
  password,
  resource,
}) {
  const seenTokens = new Set()
  const seenSessions = new Set()
  const seenTokenIds = new Set()
  const acquire = async (clientId, scope = MCP_FIXTURE_SCOPE) => {
    let evidence
    try {
      evidence = await acquirePublicClientToken({
        browser,
        callback,
        clientId,
        email,
        origin,
        password,
        resource,
        scope,
      })
      const { accessToken, context } = evidence
      const claims = decodeJwtPart(accessToken, 1)
      if (
        claims.client_id !== clientId ||
        typeof claims.sid !== 'string' ||
        typeof claims.jti !== 'string' ||
        seenTokens.has(accessToken) ||
        seenSessions.has(claims.sid) ||
        seenTokenIds.has(claims.jti)
      ) {
        throw new Error('Terminal evidence reused an OAuth token, session, or transaction result')
      }
      seenTokens.add(accessToken)
      seenSessions.add(claims.sid)
      seenTokenIds.add(claims.jti)
      const baseline = await postMcpJson(
        context,
        resource,
        accessToken,
        toolCall(`terminal-baseline-${seenTokens.size}`, 'projects.list', {
          organizationId,
        }),
      )
      if (baseline.status !== 200) {
        throw new Error('Fresh terminal-case OAuth transaction was not live-authorized')
      }
      return { accessToken, context }
    } catch (error) {
      await evidence?.context.close().catch(() => {})
      throw error
    }
  }
  const requireRevoked = async (evidence, description) => {
    const snapshot = await postMcpJson(
      evidence.context,
      resource,
      evidence.accessToken,
      toolCall(`terminal-${description}`, 'projects.list', { organizationId }),
    )
    requireInvalidToken(snapshot, description)
  }
  const postAdminTransition = async (context, path, description) => {
    const response = await context.request.post(`${origin}/api/auth/mcp/admin/${path}`, {
      data: {},
      headers: { origin },
    })
    await requireProviderOperation(response, description)
  }

  const session = await acquire(clients.sessionDelete)
  try {
    const signOut = await session.context.request.post(`${origin}/api/auth/sign-out`, {
      data: {},
      headers: { origin },
    })
    await requireProviderOperation(signOut, 'Persisted Better Auth session deletion')
    await requireRevoked(session, 'session deletion')
  } finally {
    await session.context.close().catch(() => {})
  }

  const disabledClient = await acquire(clients.clientDisable)
  try {
    await postAdminTransition(
      disabledClient.context,
      'disable-client-fixture',
      'Persisted OAuth client disable',
    )
    await requireRevoked(disabledClient, 'client disable')
  } finally {
    await disabledClient.context.close().catch(() => {})
  }

  const deletedClient = await acquire(clients.clientDelete)
  try {
    await postAdminTransition(
      deletedClient.context,
      'delete-client-fixture',
      'Persisted OAuth client deletion',
    )
    await requireRevoked(deletedClient, 'client deletion')
  } finally {
    await deletedClient.context.close().catch(() => {})
  }

  // The pinned Better Auth rule permits three sign-ins per 10-second window.
  // Keep the canonical limiter enabled and pace the remaining fresh sessions.
  await new Promise((ready) => setTimeout(ready, SIGN_IN_RATE_LIMIT_WINDOW_MS + 100))

  const deletedConsent = await acquire(clients.consentDelete)
  try {
    await postAdminTransition(
      deletedConsent.context,
      'delete-consent-fixture',
      'Persisted OAuth consent/grant deletion',
    )
    await requireRevoked(deletedConsent, 'consent deletion')
  } finally {
    await deletedConsent.context.close().catch(() => {})
  }

  return await acquire(clients.conformance, 'mcp:read')
}

export async function runMcpEvidence({ conformanceRunner, includeConformance = false } = {}) {
  if (includeConformance && typeof conformanceRunner !== 'function') {
    throw new Error('Self-contained MCP conformance requires the dedicated conformance runner')
  }
  const root = process.cwd()
  parseMcpEvidenceFixtureConfiguration()
  await runLocalMcpTests(root)
  const fixture = await startMcpEvidenceFixture()
  try {
    const origin = normalizeEvidenceOrigin(fixture.origin)
    const convexSiteUrl = normalizeEvidenceOrigin(fixture.convexSiteUrl)
    const resource = `${convexSiteUrl}/mcp`
    let browser
    try {
      browser = await chromium.launch({ headless: true })
      const setupContext = await browser.newContext({
        viewport: { height: 900, width: 1440 },
      })
      let clients
      try {
        await verifyDiscoveryDocuments(setupContext, origin, resource)
        clients = await provisionInteropProfile(
          setupContext,
          origin,
          resource,
          convexSiteUrl,
          fixture.email,
          fixture.password,
        )
      } finally {
        await setupContext.close().catch(() => {})
      }
      const primary = await acquirePublicClientToken({
        browser,
        callback: `${INSPECTOR_ORIGIN}/oauth/callback`,
        clientId: clients.inspector,
        email: fixture.email,
        origin,
        password: fixture.password,
        resource,
      })
      try {
        const secondary = await acquirePublicClientToken({
          browser,
          callback: MCP_REMOTE_CALLBACK,
          clientId: clients.mcpRemote,
          email: fixture.email,
          origin,
          password: fixture.password,
          resource,
        })
        try {
          requireExactToolNames(
            await postMcpJson(secondary.context, resource, secondary.accessToken, {
              id: 'secondary-public-client-tools',
              jsonrpc: '2.0',
              method: 'tools/list',
              params: {},
            }),
            'second public-client tools/list',
          )
        } finally {
          await secondary.context.close().catch(() => {})
        }
        await runLiveAuthorizationEvidence({
          accessToken: primary.accessToken,
          clientId: clients.inspector,
          context: primary.context,
          convexUrl: fixture.convexUrl,
          fixture,
          organizationId: clients.organizationId,
          origin,
          resource,
        })
        await verifyRevocationProtocol(
          primary.context,
          primary.accessToken,
          clients.inspector,
          origin,
          resource,
        )
        const terminalClients = await provisionTerminalEvidence(
          primary.context,
          origin,
          resource,
          clients.organizationId,
          [clients.inspector, clients.mcpRemote],
        )
        // The two interoperability transactions above consume two of the
        // provider's three sign-ins per ten-second fixed window. Start the
        // terminal-revocation matrix in a fresh canonical window.
        await new Promise((ready) => setTimeout(ready, SIGN_IN_RATE_LIMIT_WINDOW_MS + 100))
        const conformance = await runTerminalRevocationEvidence({
          browser,
          callback: `${INSPECTOR_ORIGIN}/oauth/callback`,
          clients: terminalClients,
          email: fixture.email,
          organizationId: clients.organizationId,
          origin,
          password: fixture.password,
          resource,
        })
        try {
          if (includeConformance) {
            await conformanceRunner({
              bearer: conformance.accessToken,
              origin: convexSiteUrl,
              root,
            })
          }
        } finally {
          await conformance.context.close().catch(() => {})
        }
        console.log(
          `MCP direct PKCE interoperability, live Convex authorization, and terminal revocation passed${includeConformance ? ' with server conformance' : ''}.`,
        )
      } finally {
        await primary.context.close().catch(() => {})
      }
    } finally {
      await browser?.close().catch(() => {})
    }
  } finally {
    await fixture.release()
  }
}

export async function main() {
  await runMcpEvidence()
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
