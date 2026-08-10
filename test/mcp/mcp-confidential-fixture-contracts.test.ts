import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const providerSource = readFileSync(
  fileURLToPath(new URL('../../starters/mcp-oauth-agent/convex/mcpOAuthAdmin.ts', import.meta.url)),
  'utf8',
)
const fixtureSource = readFileSync(
  fileURLToPath(new URL('../../scripts/mcp-local-fixture.mjs', import.meta.url)),
  'utf8',
)
const evidenceSource = readFileSync(
  fileURLToPath(
    new URL('../../starters/mcp-oauth-agent/convex/mcpOAuthEvidence.ts', import.meta.url),
  ),
  'utf8',
)

describe('confidential OAuth code fixture contracts', () => {
  it('keeps confidential provisioning on one dedicated admin-only no-store endpoint', () => {
    expect(providerSource).toContain("'/mcp/admin/provision-confidential'")
    expect(providerSource).toMatch(
      /provisionMcpConfidentialFixture:[\s\S]+metadata: \{ noStore: true \}[\s\S]+use: \[sessionMiddleware\]/u,
    )
    expect(providerSource).not.toContain('x-bcn-confidential-fixture')
    expect(providerSource).toContain('const client = await provisionConfidentialClient(')
    expect(providerSource).toContain('return ctx.json({ client, resource })')
    expect(providerSource).toContain(
      'clients: { inspector: clientIds[0], mcpRemote: clientIds[1] },',
    )
  })

  it('pins the client to the existing callback, resource, scopes, PKCE, and Basic auth', () => {
    expect(providerSource).toContain('callback: CLIENTS[0].callback')
    expect(providerSource).toContain("value.type !== 'web'")
    expect(providerSource).toContain("value.token_endpoint_auth_method !== 'client_secret_basic'")
    expect(providerSource).toContain('value.require_pkce !== true')
    expect(providerSource).toContain("scope: MCP_SCOPES.join(' ')")
    expect(providerSource).toContain('provider.endpoints.adminLinkClientResource')
    expect(providerSource).toContain('provider.endpoints.rotateClientSecret')
    expect(providerSource).not.toMatch(/console\.(?:debug|error|info|log|warn)/u)
  })

  it('registers the one-time secret with the in-memory fixture redactor', () => {
    expect(fixtureSource).toContain('registerConfidentialClientSecretForRedaction')
    expect(fixtureSource).toContain('if (!secrets.includes(secret)) secrets.push(secret)')
    expect(fixtureSource).toContain('registerConfidentialClientSecretForRedaction,')
    expect(fixtureSource).not.toMatch(/writeFile\([^\n]*secret/u)
  })

  it('exposes only bounded credential counts through the deployment-admin fixture seam', () => {
    expect(providerSource).not.toContain('oauth-token-counts')
    expect(evidenceSource).toContain("model: 'oauthAccessToken'")
    expect(evidenceSource).toContain("model: 'oauthRefreshToken'")
    expect(evidenceSource).toContain("model: 'account'")
    expect(evidenceSource.match(/components\.betterAuth\.adapter\.count/gu)).toHaveLength(3)
    expect(evidenceSource).toContain("where: [{ field: 'idToken', operator: 'ne', value: null }]")
    expect(evidenceSource).toContain('count > 100')
    expect(evidenceSource).not.toContain('findMany')
    expect(fixtureSource).toContain('readOAuthCredentialCountsForTest')
    expect(fixtureSource).toContain("runConvex('mcpOAuthEvidence:countCredentialRows')")
  })
})
