import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8')
const evidenceSource = read('scripts/fixtures/mcp-oauth-agent-evidence.ts')
const fixtureSource = read('scripts/mcp-local-fixture.mjs')
const concurrencySource = read('scripts/run-oauth-code-concurrency.mjs')

describe('MCP evidence fixture contracts', () => {
  it('installs evidence functions only into the disposable starter copy', () => {
    expect(fixtureSource).toContain(
      "const evidenceFunctions = join(root, 'scripts/fixtures/mcp-oauth-agent-evidence.ts')",
    )
    expect(fixtureSource).toContain(
      "await copyFile(evidenceFunctions, join(cwd, 'convex/evidence.ts'))",
    )
    expect(
      readdirSync(fileURLToPath(new URL('../../starters/mcp-oauth-agent/convex', import.meta.url))),
    ).not.toContain('evidence.ts')
  })

  it('exposes only internal operator functions and no HTTP route', () => {
    expect(evidenceSource).not.toMatch(
      /export const \w+\s*=\s*(?:query|mutation|action|httpAction)\(/,
    )
    expect(evidenceSource).not.toMatch(/HttpRouter|http\.route|sessionHttpAction/)
    expect(evidenceSource.match(/export const \w+ = internal(?:Mutation|Query)\(/g)?.length).toBe(
      evidenceSource.match(/export const /g)?.length,
    )
  })

  it('provisions public clients through the operator and the confidential client with a hashed secret', () => {
    expect(evidenceSource).toContain('auth.oauthOperator.createPublicClient(ctx, {')
    expect(evidenceSource).toContain("tokenEndpointAuthMethod: 'client_secret_basic'")
    expect(evidenceSource).toContain("applicationType: 'web'")
    expect(evidenceSource).toContain('requirePKCE: true')
    expect(evidenceSource).toContain("crypto.subtle.digest('SHA-256'")
    expect(evidenceSource).toContain('clientSecret: hashedSecret')
    expect(evidenceSource).not.toMatch(/clientSecret: secret\b/)
    expect(evidenceSource).not.toMatch(/console\.(?:debug|error|info|log|warn)/u)
  })

  it('registers the one-time secret with the in-memory fixture redactor', () => {
    expect(fixtureSource).toContain('registerConfidentialClientSecretForRedaction')
    expect(fixtureSource).toContain('if (!secrets.includes(secret)) secrets.push(secret)')
    expect(fixtureSource).toContain('registerConfidentialClientSecretForRedaction,')
    expect(fixtureSource).not.toMatch(/writeFile\([^\n]*secret/u)
    expect(concurrencySource).toContain(
      'fixture.registerConfidentialClientSecretForRedaction(confidentialClient.secret)',
    )
  })

  it('revokes and disables through the same library calls the starter uses', () => {
    expect(evidenceSource).toContain('auth.oauthConnections.revoke(ctx, {')
    expect(evidenceSource).toContain('auth.oauthOperator.setClientDisabled(ctx, args)')
    expect(evidenceSource).toContain('auth.oauthOperator.deleteClient(ctx, args)')
  })

  it('exposes only bounded credential counts through the deployment-admin fixture seam', () => {
    expect(evidenceSource).toContain("model: 'oauthAccessToken'")
    expect(evidenceSource).toContain("model: 'oauthRefreshToken'")
    expect(evidenceSource).toContain("model: 'account'")
    expect(evidenceSource.match(/components\.betterAuth\.adapter\.count/gu)).toHaveLength(3)
    expect(evidenceSource).toContain("where: [{ field: 'idToken', operator: 'ne', value: null }]")
    expect(evidenceSource).toContain('count > 100')
    expect(evidenceSource).not.toContain('findMany')
    expect(fixtureSource).toContain('readOAuthCredentialCountsForTest')
    expect(fixtureSource).toContain("runConvex('evidence:countCredentialRows')")
  })
})
