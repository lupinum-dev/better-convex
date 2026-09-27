import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CLAUDE_MCP_REDIRECT_URI,
  resolveMcpHostRedirectUri,
} from '../../src/runtime/convex-auth/mcp-profile'

const root = process.cwd()
const agentsDirectory = join(root, 'docs/content/docs/3.build/7.agents')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const packageReadme = read('packages/mcp/README.md')
const guide = read('docs/content/docs/3.build/7.agents/1.mcp.md')
const recipe = read('docs/content/docs/3.build/7.agents/2.mcp-application.md')
const hostsGuide = read('docs/content/docs/3.build/7.agents/3.connect-chatgpt-and-claude.md')
const appsGuide = read('docs/content/docs/3.build/7.agents/4.mcp-apps.md')
const delegatedGuide = read(
  'docs/content/docs/3.build/3.authentication/10.delegated-oauth-and-mcp.md',
)
const starterReadme = read('starters/mcp-oauth-agent/README.md')
const mcpManifest = JSON.parse(read('packages/mcp/package.json')) as {
  version: string
  peerDependencies: Record<string, string>
}
const normalizedGuide = guide.replace(/\s+/gu, ' ')

describe('MCP package documentation', () => {
  it('states the exact prerelease package and final protocol authority', () => {
    expect(guide).toContain('`@lupinum/better-convex-mcp`')
    expect(guide).toContain(`\`${mcpManifest.version}\``)
    expect(guide).toContain(
      `\`@modelcontextprotocol/server@${mcpManifest.peerDependencies['@modelcontextprotocol/server']}\``,
    )
    expect(normalizedGuide).toContain(
      'final MCP `2026-07-28` contract through exact `@modelcontextprotocol/server@2.1.0`',
    )
    expect(normalizedGuide).toContain('The protocol is stable; this integration remains prerelease')
    expect(guide).toContain(
      `@lupinum/better-convex-mcp@${mcpManifest.version} @modelcontextprotocol/server@2.1.0 zod@4.6.5`,
    )
    // The SDK is an exact peer: every install command must name it.
    expect(normalizedGuide).toContain('is an exact peer dependency')
    expect(packageReadme).toContain('is an exact peer dependency')
    for (const source of [guide, packageReadme, recipe]) {
      for (const [command] of source.matchAll(/pnpm add @lupinum\/better-convex-mcp[^\n]*/gu)) {
        expect(command).toContain('@modelcontextprotocol/server@2.1.0')
      }
    }
  })

  it('teaches one golden path: profile, routes, verifier, tools, in-function check, connections', () => {
    for (const source of [guide, recipe]) {
      expect(source).toContain('auth.createMcpAccessVerifier(ctx)')
      expect(source).toContain('registerMcpTool(server, tools, {')
      expect(source).toContain('auth.requireMcpPrincipal(ctx, principal, { scope:')
      expect(source).toContain('auth.oauthConnections')
      expect(source).toContain('auth.mcp.resource()')
    }
    expect(guide).toContain('`oauth: { mcp: { scopes } }`')
    expect(recipe).toContain('oauth: {\n  mcp: {')
    expect(delegatedGuide).toContain('auth.createMcpAccessVerifier(ctx)')
    expect(delegatedGuide).toContain('auth.requireMcpPrincipal(ctx, principal, { scope })')
    expect(delegatedGuide).toContain('auth.oauthConnections.revoke(ctx, { userId, clientId })')
  })

  it('removes the hand-built verifier, closure principal, and positional configureServer', () => {
    const pages = readdirSync(agentsDirectory).map((name) =>
      read(join('docs/content/docs/3.build/7.agents', name)),
    )
    for (const source of [...pages, delegatedGuide, packageReadme, starterReadme]) {
      expect(source).not.toMatch(
        /jwksUrl|validateLiveAccess|validateOAuthAccess|createBetterAuthMcpAccessVerifier|OAuthLiveAccess|configureServer\(access/,
      )
    }
  })

  it('documents MCP Apps as a recipe on the official Apps SDK with defineMcpTool', () => {
    expect(appsGuide).toContain('pnpm add @modelcontextprotocol/ext-apps@2.0.0')
    expect(appsGuide).toContain("from '@modelcontextprotocol/ext-apps/server'")
    expect(appsGuide).toContain('registerAppResource(server,')
    expect(appsGuide).toContain('defineMcpTool(tools, {')
    expect(appsGuide).toContain(
      'registerAppTool(server, showNotes.name, showNotes.config, showNotes.handler)',
    )
    expect(appsGuide).toContain('ui: { resourceUri: NOTES_CARD_URI }')
    expect(appsGuide).toContain("import { App } from '@modelcontextprotocol/ext-apps'")
    expect(appsGuide).toContain('{ autoResize: true }')
    expect(appsGuide).toContain('viteSingleFile()')
    expect(appsGuide).toContain('**Keep `ui://` URIs stable.**')
  })

  it('keeps provider and application authorization ownership explicit', () => {
    expect(normalizedGuide).toContain('does not depend on Nuxt, Nitro, Better Auth')
    expect(guide).toContain('Token scopes and OAuth consent are ceilings')
    expect(guide).toContain('application reloads it for every effect')
    expect(guide).toContain('Better Auth is optional')
    expect(guide).not.toContain('MCP_SERVER_SECRET')
  })

  it('documents one explicit official-SDK topology and the unsupported surface', () => {
    expect(normalizedGuide).toContain(
      'Register as tools only the application operations you have checked',
    )
    expect(normalizedGuide).toContain('never turns Convex functions into tools automatically')
    expect(guide).toContain('one stateless Convex HTTP Action')
    expect(normalizedGuide).toContain('OAuth mode has five explicit Convex route registrations')
    expect(guide).toContain("for (const method of ['GET', 'OPTIONS'] as const)")
    expect(normalizedGuide).toContain(
      'Register only the three `/mcp` transport methods and omit both protected-resource metadata registrations',
    )
    expect(guide).toContain('automatic Convex-function exposure')
    expect(guide).toContain('prompts, Tasks, or a URL approval workflow')
    expect(guide).toContain('a second MCP server in Nitro')
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

describe('host connection guide', () => {
  it('documents exactly the callbacks that the host presets admit', () => {
    expect(hostsGuide).toContain(CLAUDE_MCP_REDIRECT_URI)
    expect(resolveMcpHostRedirectUri('claude', undefined)).toBe(CLAUDE_MCP_REDIRECT_URI)
    for (const callback of [
      'https://chatgpt.com/connector_platform_oauth_redirect',
      'https://chatgpt.com/connector/oauth/example-callback',
    ]) {
      expect(resolveMcpHostRedirectUri('chatgpt', callback)).toBe(callback)
    }
    expect(hostsGuide).toContain('https://chatgpt.com/connector_platform_oauth_redirect')
    expect(hostsGuide).toContain('https://chatgpt.com/connector/oauth/<callback-id>')
  })

  it('covers host settings, scopes and consent, Inspector testing, and common failures', () => {
    for (const heading of [
      '## What each host needs',
      '## Connect Claude',
      '## Connect ChatGPT',
      '## Scopes and consent',
      '## Test with MCP Inspector',
      '## Common failures',
    ]) {
      expect(hostsGuide).toContain(heading)
    }
    expect(hostsGuide).toContain('connections:createHostClient \'{"host":"claude"}\'')
    expect(hostsGuide).toContain('`offline_access` in **Base scopes**')
    expect(hostsGuide).toContain('http://localhost:6274/oauth/callback')
    expect(hostsGuide).toContain('AUTH_OAUTH_CLIENT_HOST_NOT_ENABLED')
    expect(hostsGuide).toContain('AUTH_OAUTH_CLIENT_REDIRECT_URI_INVALID')
  })
})

describe('documented MCP authorization examples', () => {
  it('requires an application verifier instead of inventing token identity', () => {
    expect(packageReadme).toContain("import { applicationTokenVerifier } from './mcp/verify'")
    expect(packageReadme).toContain('verifier: applicationTokenVerifier')
    expect(packageReadme).toContain('actual expiry in Unix seconds')
    expect(packageReadme).toContain('verifier: auth.createMcpAccessVerifier(ctx)')
    expect(packageReadme).not.toContain('async verifyAccessToken(')
  })

  it('links the copyable application recipe, host setup, and complete starter', () => {
    expect(guide).toContain('/docs/build/agents/mcp-application')
    expect(guide).toContain('/docs/build/agents/connect-chatgpt-and-claude')
    expect(delegatedGuide).toContain('/docs/build/agents/mcp-application')
    expect(recipe).toContain('/docs/build/agents/connect-chatgpt-and-claude')
    expect(guide).toContain('`starters/mcp-oauth-agent`')
  })
})
