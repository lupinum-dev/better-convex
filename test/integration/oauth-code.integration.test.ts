// Authorization-code single use on the MCP starter: a concurrent double
// redemption has one winner, replay fails, pre-provider guard failures keep the
// code, and every provider-side failure burns it without persisting a token.
import { randomBytes } from 'node:crypto'

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  authorizeInBrowser,
  browserCredentialLeaks,
  CONFIDENTIAL_CALLBACK,
  INSPECTOR_CALLBACK,
  isRecord,
  MCP_REMOTE_CALLBACK,
  provisionClients,
  redeemCode,
  signIn,
  startMcpFixture,
  tokenResponseProblems,
  type AuthorizationGrant,
  type McpFixture,
  type TokenResult,
} from './harness'

describe('OAuth authorization codes on the MCP starter', () => {
  let fixture: McpFixture
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let clients: Awaited<ReturnType<typeof provisionClients>>
  let confidential: { id: string; secret: string }

  const expected = (clientId = clients.inspector) => ({
    clientId,
    origin: fixture.origin,
    resource: clients.resource,
  })
  const authorize = (clientId = clients.inspector) =>
    authorizeInBrowser(page, fixture, {
      clientId,
      redirectUri: clientId === confidential.id ? CONFIDENTIAL_CALLBACK : INSPECTOR_CALLBACK,
      resource: clients.resource,
    })
  const redeem = (grant: AuthorizationGrant, overrides: Record<string, string> = {}) =>
    redeemCode(fixture.origin, {
      client_id: clients.inspector,
      code: grant.code,
      code_verifier: grant.verifier,
      grant_type: 'authorization_code',
      redirect_uri: INSPECTOR_CALLBACK,
      resource: clients.resource,
      ...overrides,
    })
  const redeemConfidential = (grant: AuthorizationGrant, secret: string) =>
    redeemCode(
      fixture.origin,
      {
        code: grant.code,
        code_verifier: grant.verifier,
        grant_type: 'authorization_code',
        redirect_uri: CONFIDENTIAL_CALLBACK,
        resource: clients.resource,
      },
      `Basic ${Buffer.from(`${confidential.id}:${secret}`).toString('base64')}`,
    )
  const expectMinted = (result: TokenResult, code: string, clientId?: string) =>
    expect(tokenResponseProblems(result, expected(clientId)), code).toEqual([])
  const expectRejected = (result: TokenResult, error: string, code: string) => {
    expect(result.status >= 400 && result.status < 600, code).toBe(true)
    expect(result.error, code).toBe(error)
    expect(result.credentialFree, `${code} (credential in error response)`).toBe(true)
  }
  const counts = async () => {
    const value = await fixture.readCredentialCounts()
    expect(value.idTokens, 'OAUTH_CODE_DISABLED_TOKEN_CLASS_PERSISTED').toBe(0)
    expect(value.refreshTokens, 'OAUTH_CODE_DISABLED_TOKEN_CLASS_PERSISTED').toBe(0)
    return value
  }

  beforeAll(async () => {
    fixture = await startMcpFixture()
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext({ viewport: { height: 900, width: 1440 } })
    await signIn(context, fixture)
    clients = await provisionClients(fixture)
    expect(clients.resource).toBe(`${fixture.convexSiteUrl}/mcp`)
    expect(clients.inspector).not.toBe(clients.mcpRemote)
    const profile = await fixture.runConvex('evidence:provisionConfidential')
    const client = isRecord(profile) && isRecord(profile.client) ? profile.client : {}
    confidential = { id: String(client.id), secret: String(client.secret) }
    fixture.registerSecret(confidential.secret)
    expect(confidential.secret.length).toBeGreaterThanOrEqual(16)
    expect([clients.inspector, clients.mcpRemote]).not.toContain(confidential.id)
    expect(isRecord(profile) && profile.resource).toBe(clients.resource)
    page = await context.newPage()
  })

  afterAll(async () => {
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
    await fixture?.release()
  })

  it('starts with no persisted access token', async () => {
    expect(
      (await counts()).accessTokens,
      'OAUTH_CODE_FIXTURE_PERSISTED_ACCESS_TOKEN_NOT_EMPTY',
    ).toBe(0)
  })

  it('gives a concurrent double redemption exactly one winner and denies replay', async () => {
    const grant = await authorize()
    const race = await Promise.all([redeem(grant), redeem(grant)])
    const winners = race.filter((result) => tokenResponseProblems(result, expected()).length === 0)
    expect(winners, 'OAUTH_CODE_RACE_WINNER_COUNT').toHaveLength(1)
    const loser = race.find((result) => !winners.includes(result))
    expect(loser, 'OAUTH_CODE_RACE_REJECTED_COUNT').toBeDefined()
    expectRejected(loser!, 'invalid_grant', 'OAUTH_CODE_RACE_LOSER_INVALID')
    expectRejected(await redeem(grant), 'invalid_grant', 'OAUTH_CODE_REPLAY_ACCEPTED')
  })

  it('keeps the code usable after a wrong resource or redirect is rejected before the provider', async () => {
    const resourceGrant = await authorize()
    const before = await counts()
    expectRejected(
      await redeem(resourceGrant, { resource: `${fixture.origin}/wrong-resource` }),
      'invalid_client',
      'OAUTH_CODE_WRONG_RESOURCE_MINTED',
    )
    expect(await counts(), 'OAUTH_CODE_WRONG_RESOURCE_PERSISTED_TOKEN').toEqual(before)
    expectMinted(await redeem(resourceGrant), 'OAUTH_CODE_RESOURCE_GUARD_BURNED_CODE')

    const redirectGrant = await authorize()
    const beforeRedirect = await counts()
    expectRejected(
      await redeem(redirectGrant, { redirect_uri: 'http://localhost:6274/wrong-callback' }),
      'invalid_request',
      'OAUTH_CODE_WRONG_REDIRECT_MINTED',
    )
    expect(await counts(), 'OAUTH_CODE_WRONG_REDIRECT_PERSISTED_TOKEN').toEqual(beforeRedirect)
    expectMinted(await redeem(redirectGrant), 'OAUTH_CODE_REDIRECT_GUARD_BURNED_CODE')
  })

  it('burns the code on a wrong PKCE verifier or another client, and fresh flows still work', async () => {
    const pkceGrant = await authorize()
    const before = await counts()
    const wrongVerifier = randomBytes(48).toString('base64url')
    expectRejected(
      await redeem(pkceGrant, { code_verifier: wrongVerifier }),
      'invalid_request',
      'OAUTH_CODE_WRONG_PKCE_MINTED',
    )
    expectRejected(await redeem(pkceGrant), 'invalid_grant', 'OAUTH_CODE_WRONG_PKCE_DID_NOT_BURN')
    expect(await counts(), 'OAUTH_CODE_WRONG_PKCE_PERSISTED_TOKEN').toEqual(before)
    expectMinted(await redeem(await authorize()), 'OAUTH_CODE_FRESH_PKCE_FLOW_FAILED')

    const clientGrant = await authorize()
    const beforeClient = await counts()
    expectRejected(
      await redeem(clientGrant, {
        client_id: clients.mcpRemote,
        redirect_uri: MCP_REMOTE_CALLBACK,
      }),
      'invalid_grant',
      'OAUTH_CODE_WRONG_CLIENT_MINTED',
    )
    expectRejected(
      await redeem(clientGrant),
      'invalid_grant',
      'OAUTH_CODE_WRONG_CLIENT_DID_NOT_BURN',
    )
    expect(await counts(), 'OAUTH_CODE_WRONG_CLIENT_PERSISTED_TOKEN').toEqual(beforeClient)
    expectMinted(await redeem(await authorize()), 'OAUTH_CODE_FRESH_FLOW_FAILED')
  })

  it('burns a confidential client code on a wrong Basic secret', async () => {
    const grant = await authorize(confidential.id)
    const before = await counts()
    const wrongSecret = randomBytes(48).toString('base64url')
    expectRejected(
      await redeemConfidential(grant, wrongSecret),
      'invalid_client',
      'OAUTH_CODE_WRONG_BASIC_SECRET_MINTED',
    )
    expectRejected(
      await redeemConfidential(grant, confidential.secret),
      'invalid_grant',
      'OAUTH_CODE_WRONG_BASIC_SECRET_DID_NOT_BURN',
    )
    expect(await counts(), 'OAUTH_CODE_WRONG_BASIC_SECRET_PERSISTED_TOKEN').toEqual(before)
    expectMinted(
      await redeemConfidential(await authorize(confidential.id), confidential.secret),
      'OAUTH_CODE_FRESH_CONFIDENTIAL_FLOW_FAILED',
      confidential.id,
    )
  })

  it('burns the code when signing fails after consumption, and recovers after key rotation', async () => {
    const grant = await authorize()
    const before = await counts()
    await fixture.retireCurrentAuthSecret()
    expectRejected(
      await redeem(grant),
      'server_error',
      'OAUTH_CODE_POST_CONSUME_SIGNING_FAULT_MINTED',
    )
    expectRejected(
      await redeem(grant),
      'invalid_grant',
      'OAUTH_CODE_POST_CONSUME_SIGNING_FAULT_DID_NOT_BURN',
    )
    expect(await counts(), 'OAUTH_CODE_POST_CONSUME_SIGNING_FAULT_PERSISTED_TOKEN').toEqual(before)
    await fixture.runConvex('auth:rotateSigningKey')
    expectMinted(await redeem(await authorize()), 'OAUTH_CODE_POST_SIGNING_FAULT_RECOVERY_FAILED')
  })

  it('leaves no OAuth credential in browser storage or cookies', async () => {
    expect(
      await browserCredentialLeaks(page, context, fixture.origin),
      'OAUTH_CODE_BROWSER_STORAGE_TOKEN_LEAK / CREDENTIAL_LEAK / CONTAINER_PRESENT / COOKIE_TOKEN_LEAK / CREDENTIAL_COOKIE',
    ).toEqual({
      storageJwt: false,
      storageCredential: false,
      storageContainers: 0,
      cookieJwt: false,
      credentialCookie: false,
    })
  })
})
