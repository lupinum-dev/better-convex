import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

import { runMcpTool, type McpAccessContext } from '../../packages/mcp/src/index'

const root = process.cwd()
const packageReadme = readFileSync(join(root, 'packages/mcp/README.md'), 'utf8')
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
    expect(guide).toContain('`@lupinum/better-convex-mcp`')
    expect(guide).toContain(`\`${mcpManifest.version}\``)
    expect(guide).toContain(
      `\`@modelcontextprotocol/server@${mcpManifest.dependencies['@modelcontextprotocol/server']}\``,
    )
    expect(normalizedGuide).toContain(
      'final MCP `2026-07-28` contract through exact `@modelcontextprotocol/server@2.0.0`',
    )
    expect(normalizedGuide).toContain('The protocol is stable; this integration remains prerelease')
    expect(guide).toContain(
      `@lupinum/better-convex-mcp@${mcpManifest.version} @modelcontextprotocol/server@2.0.0 zod@4.4.3`,
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
    expect(normalizedGuide).toContain('client entry lives in `@lupinum/better-convex-mcp/vue`')
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

describe('documented MCP authorization examples', () => {
  it('requires an application verifier instead of inventing token identity', () => {
    expect(packageReadme).toContain("import { applicationTokenVerifier } from './mcp/verify'")
    expect(packageReadme).toContain('verifier: applicationTokenVerifier')
    expect(packageReadme).toContain('actual expiry in Unix seconds')
    expect(packageReadme).not.toContain('async verifyAccessToken(')
  })

  it.each([
    { scopes: ['mcp:read'], allowed: false },
    { scopes: ['mcp:read', 'mcp:write'], allowed: true },
  ])(
    'enforces the write scope before the documented mutation: $allowed',
    async ({ scopes, allowed }) => {
      const access: McpAccessContext = {
        clientId: 'client-1',
        issuer: 'https://accounts.example.com',
        resource: 'https://deployment.convex.site/mcp',
        scopes,
        subject: 'user-1',
      }
      const runMutation = vi.fn().mockResolvedValue({ title: 'Updated' })
      // Execute the actual Markdown callback, so changes to the example affect this test.
      const callback = guide.match(/(async \(args\) =>[\s\S]*?),\n {8}\)/u)?.[1]
      expect(callback).toBeDefined()
      const rename = runInNewContext(`(${callback})`, {
        access,
        ctx: { runMutation },
        internal: { notes: { renameFromMcp: 'notes.renameFromMcp' } },
        runMcpTool,
      }) as (args: { noteId: string; title: string }) => Promise<{ isError?: boolean }>
      const args = { noteId: 'note-1', title: 'Updated' }
      const result = await rename(args)
      if (allowed) {
        expect(result.isError).not.toBe(true)
        expect(runMutation).toHaveBeenCalledExactlyOnceWith('notes.renameFromMcp', {
          ...args,
          access,
        })
      } else {
        expect(result.isError).toBe(true)
        expect(runMutation).not.toHaveBeenCalled()
      }
    },
  )
})
