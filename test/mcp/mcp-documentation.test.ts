import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()
const guide = readFileSync(join(root, 'docs/content/docs/4.build/7.agents/1.mcp.md'), 'utf8')
const delegatedGuide = readFileSync(
  join(root, 'docs/content/docs/4.build/3.authentication/10.delegated-oauth-and-mcp.md'),
  'utf8',
)
const appsGuide = readFileSync(
  join(root, 'docs/content/docs/4.build/7.agents/2.mcp-apps.md'),
  'utf8',
)
const starterReadme = readFileSync(join(root, 'starters/mcp-oauth-agent/README.md'), 'utf8')
const mcpManifest = JSON.parse(readFileSync(join(root, 'packages/mcp/package.json'), 'utf8')) as {
  name: string
  version: string
  dependencies: Record<string, string>
}
const normalizedGuide = guide.replace(/\s+/gu, ' ')

describe('MCP package documentation', () => {
  it('states the exact prerelease package and final protocol authority', () => {
    expect(guide).toContain('`better-convex-mcp`')
    expect(guide).toContain(`\`${mcpManifest.version}\``)
    expect(guide).toContain(
      `\`@modelcontextprotocol/server@${mcpManifest.dependencies['@modelcontextprotocol/server']}\``,
    )
    expect(normalizedGuide).toContain(
      'final MCP `2026-07-28` contract through exact `@modelcontextprotocol/server@2.0.0`',
    )
    expect(normalizedGuide).toContain('The protocol is stable; this integration remains prerelease')
    expect(guide).toContain(
      'better-convex-mcp@0.1.0-beta.19 @modelcontextprotocol/server@2.0.0 zod@4.4.3',
    )
  })

  it('documents the complete strict MCP App peer set', () => {
    expect(appsGuide).toContain('@modelcontextprotocol/ext-apps@1.7.5')
    expect(appsGuide).toContain('@modelcontextprotocol/sdk@1.30.0')
    expect(appsGuide).toContain('zod@4.4.3')
  })

  it('keeps provider and application authorization ownership explicit', () => {
    expect(normalizedGuide).toContain('does not depend on Nuxt, Nitro, Better Auth')
    expect(guide).toContain('Token scopes and OAuth consent are ceilings')
    expect(guide).toContain('application reloads it for every effect')
    expect(guide).toContain('Better Auth is optional')
    expect(guide).not.toContain('MCP_SERVER_SECRET')
  })

  it('documents one explicit official-SDK topology and the unsupported surface', () => {
    expect(normalizedGuide).toContain('Configure only reviewed application operations')
    expect(guide).toContain('one stateless Convex HTTP Action')
    expect(normalizedGuide).toContain('OAuth mode has five explicit Convex route registrations')
    expect(guide).toContain("method: 'OPTIONS'")
    expect(normalizedGuide).toContain(
      'Register only the three `/mcp` transport methods and omit both protected-resource metadata registrations',
    )
    expect(guide).toContain('automatic Convex-function exposure')
    expect(guide).toContain('prompts, Tasks, or a URL approval workflow')
    expect(normalizedGuide).toContain('client entry lives in `better-convex-vue/mcp-app`')
    expect(normalizedGuide).toContain('adds no server capability or authority')
    expect(guide).toContain('second Nitro MCP topology')
    expect(guide).toContain('hand-written MCP parser')
  })

  it('does not retain Inspector or mcp-remote as release authority', () => {
    const verificationSection = delegatedGuide.slice(
      delegatedGuide.indexOf('## Verify the profile'),
    )
    expect(verificationSection).toContain('Two direct preregistered public-client PKCE flows')
    expect(verificationSection).not.toMatch(/Inspector|mcp-remote/)
    expect(starterReadme).toContain('direct S256 PKCE')
    expect(starterReadme).not.toContain('harness drives the pinned MCP Inspector')
  })
})
