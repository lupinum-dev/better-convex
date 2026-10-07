// The cloud smoke (`pnpm test:live`): the MCP OAuth starter on a real Convex deployment. It checks
// what the local backend cannot: the cloud runtime, the edge in front of `.convex.site`, and that
// the built packages deploy. The full journeys run in test/integration/mcp-auth.
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { chromium, type Browser, type BrowserContext } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  accessTokenProblems,
  authorizeInBrowser,
  INSPECTOR_CALLBACK,
  isRecord,
  postMcp,
  provisionClients,
  redeemCode,
  toolCall,
  toolsList,
  type JsonRecord,
  type McpResponse,
} from '../integration/harness'
import { startLiveFixture, type LiveFixture } from './fixture'

const TOOL_NAMES = [
  'archive_project',
  'check_approval',
  'create_project',
  'list_organizations',
  'rename_project',
  'search_projects',
]

/** A tool's structured result. */
function structured(response: McpResponse): JsonRecord {
  expect(response.status).toBe(200)
  const result = isRecord(response.body.result) ? response.body.result : {}
  return result.structuredContent as JsonRecord
}

describe('the MCP OAuth starter on a Convex deployment', () => {
  let fixture: LiveFixture
  let browser: Browser
  let context: BrowserContext

  beforeAll(async () => {
    fixture = await startLiveFixture()
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext()
  })

  afterAll(async () => {
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
    await fixture?.release()
  })

  it('connects an agent, runs a retried call once, waits for approval, and ends on sign-out', async () => {
    const clients = await provisionClients(fixture)
    const resource = `${fixture.convexSiteUrl}/mcp`
    expect(clients.resource).toBe(resource)
    const { organizationId } = clients

    // Sign in and consent in the browser, then redeem the code with PKCE.
    const page = await context.newPage()
    const grant = await authorizeInBrowser(page, fixture, {
      clientId: clients.inspector,
      redirectUri: INSPECTOR_CALLBACK,
      resource,
    })
    await page.close()
    const token = await redeemCode(fixture.origin, {
      client_id: clients.inspector,
      code: grant.code,
      code_verifier: grant.verifier,
      grant_type: 'authorization_code',
      redirect_uri: INSPECTOR_CALLBACK,
      resource,
    })
    expect(token.status).toBe(200)
    const accessToken = (token.body as JsonRecord).access_token as string
    expect(
      accessTokenProblems(accessToken, {
        clientId: clients.inspector,
        origin: fixture.origin,
        resource,
      }),
    ).toEqual([])
    const call = (message: JsonRecord) => postMcp(resource, accessToken, message)

    const listed = await call(toolsList('live-tools'))
    expect(listed.status).toBe(200)
    const tools = (listed.body.result as JsonRecord).tools as JsonRecord[]
    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOL_NAMES)

    // A host that retries with the same request_id gets the first result; one row exists.
    const name = 'Live smoke project'
    const create = toolCall('live-create', 'create_project', {
      name,
      organizationId,
      request_id: 'live-create-1',
    })
    const created = structured(await call(create))
    const retried = structured(await call(create))
    expect(created.status).toBe('done')
    expect(retried).toEqual(created)
    const found = structured(
      await call(toolCall('live-search', 'search_projects', { organizationId })),
    )
    expect(JSON.stringify(found.result).split(`"${name}"`).length - 1).toBe(1)

    // Archiving waits for a person, who approves with their own session.
    const projectId = (created.result as JsonRecord).id as string
    const asked = structured(await call(toolCall('live-archive', 'archive_project', { projectId })))
    expect(asked.status).toBe('needs_approval')
    const session = await context.request.get(`${fixture.origin}/api/auth/convex/token`, {
      headers: { origin: fixture.origin },
    })
    expect(session.status()).toBe(200)
    const convex = new ConvexHttpClient(fixture.convexUrl)
    convex.setAuth(((await session.json()) as JsonRecord).token as string)
    await expect(
      convex.mutation(makeFunctionReference<'mutation'>('agents:approve'), {
        approvalId: asked.approvalId,
      }),
    ).resolves.toEqual({ status: 'approved' })
    // The approved work ran once, in the cloud runtime (its follow-up token uses crypto.randomUUID).
    expect(
      await fixture.runConvex('evidence:readApprovalState', {
        approvalId: asked.approvalId as string,
        projectId,
      }),
    ).toEqual({ approval: 'approved', project: { status: 'archived', archived: true } })

    // Bodies over the 64 KiB limit get 413, from the door or the edge, never a 5xx.
    for (const bytes of [64 * 1024 + 1, 3 * 1024 * 1024]) {
      const response = await fetch(resource, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: 'x'.repeat(bytes),
      })
      await response.body?.cancel().catch(() => {})
      expect(response.status, `${bytes} bytes`).toBe(413)
    }

    // Signing out ends the session the grant is bound to, so the token stops working.
    const signOut = await context.request.post(`${fixture.origin}/api/auth/sign-out`, {
      data: {},
      headers: { origin: fixture.origin },
    })
    expect(signOut.ok()).toBe(true)
    const after = await call(toolsList('live-after-sign-out'))
    expect(after.status).toBe(401)
    expect(after.body.error).toBe('invalid_token')
  })
})
