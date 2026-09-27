import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()
const starter = join(root, 'starters/mcp-oauth-agent')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

describe('delegated MCP static trust boundaries', () => {
  const read = (path: string) => readFileSync(join(starter, path), 'utf8')

  it('has one public HTTP handler, the library verifier, and tool-specific internal operations', () => {
    const action = read('convex/mcp.ts')
    const tools = read('convex/projects.ts')
    expect(action.match(/handleMcpRequest\(/g)).toHaveLength(1)
    expect(action.match(/auth\.createMcpAccessVerifier\(ctx\)/g)).toHaveLength(1)
    expect(action).toContain("from '@lupinum/better-convex-mcp'")
    expect(action.match(/registerMcpTool\(server, tools, \{/g)).toHaveLength(5)
    expect(action.match(/\{\s*(?:\.\.\.input,\s*)?principal,?\s*\}\)/g)).toHaveLength(5)
    // The principal comes from the verifier through configureServer, never a closure.
    expect(action).not.toMatch(/\blet\b|validateOAuthAccess|verifiedPrincipal/)
    expect(action).not.toMatch(/run(?:Query|Mutation|Action)\([^,\n]*(?:message|input)\./)
    expect(tools).not.toMatch(/export const \w+\s*=\s*(?:query|mutation|action)\s*\(/)
    expect(tools.match(/internalMutation\s*\(/g)).toHaveLength(5)
    expect(tools.match(/principal: mcpPrincipalValidator/g)).toHaveLength(2)
    expect(tools.match(/auth\.requireMcpPrincipal\(ctx, principal/g)).toHaveLength(1)
    // Every exported operation authorizes before it reads or writes application data.
    for (const operation of tools
      .split('export const ')
      .filter((block) => block.includes('internalMutation('))) {
      const body = operation.slice(operation.indexOf('handler:'))
      expect(body.trimStart()).toMatch(
        /^handler: async \(ctx, (?:\w+|\{ principal \})\) => \{\s+const .+ = await authorize(?:User)?\(ctx, /,
      )
    }
    expect(tools).not.toMatch(/bearerToken|authorizationHeader|rawToken/)
    expect(tools).not.toMatch(
      /['"]oauth(?:Client(?:Resource)?|Consent|Resource)['"]|['"]session['"]/,
    )
  })

  it('accepts a principal argument only on internal functions that re-check it live', () => {
    const docs = files(join(root, 'docs/content/docs')).filter((path) => path.endsWith('.md'))
    const sources = [
      ...files(join(starter, 'convex')).filter((path) => path.endsWith('.ts')),
      ...docs,
      join(root, 'packages/mcp/README.md'),
    ].map((path) => readFileSync(path, 'utf8'))
    const principalFunctions = sources.flatMap((source) =>
      source
        .split(/export const /)
        .slice(1)
        .filter((block) =>
          /args:[^\n]*\bmcpPrincipalValidator\b|\bprincipal: mcpPrincipalValidator\b/.test(
            block.split('handler:')[0]!,
          ),
        ),
    )
    expect(principalFunctions.length).toBeGreaterThan(0)
    for (const block of principalFunctions) {
      expect(block).toMatch(/^\w+\s*=\s*internal(?:Query|Mutation|Action)\s*\(/)
    }
    const security = readFileSync(join(root, 'SECURITY.md'), 'utf8').replace(/\s+/g, ' ')
    expect(security).toContain('`mcpPrincipalValidator` must never be used on a public query')
    expect(security).toContain('never exceeds the live consent, client, and resource scopes')
  })

  it('never puts the raw token or a second MCP secret in function arguments or state', () => {
    const sourceFiles = files(join(starter, 'convex')).filter((path) => path.endsWith('.ts'))
    const source = sourceFiles
      .map((path) => `// ${relative(root, path)}\n${readFileSync(path, 'utf8')}`)
      .join('\n')
    expect(source).not.toContain('MCP_SERVER_SECRET')
    expect(source).not.toMatch(/bearerToken|rawToken|accessToken\s*:/)
    expect(source).not.toMatch(/principal\s*:\s*v\.any/)
    expect(source).not.toMatch(/functionHandle|callAny|genericBridge/)
    // Grants are read and revoked through the library, never raw component adapter calls.
    expect(source).not.toContain('components.betterAuth.adapter')
  })

  it('keeps OAuth cryptography and the OAuth profile in the library', () => {
    const action = read('convex/mcp.ts')
    const auth = read('convex/auth.ts')
    expect(action).not.toMatch(/jose|subtle|createRemoteJWKSet|jwtVerify|jwksUrl|requireAuthOrigin/)
    expect(action).not.toContain('@better-auth/oauth-provider')
    expect(auth).toContain('createBetterConvexAuth<DataModel>(components.betterAuth')
    expect(auth).toContain("oauth: { mcp: { scopes: MCP_SCOPES, hosts: ['chatgpt', 'claude'] } }")
    expect(auth).not.toMatch(/oauthProvider|clientPrivileges|resourcePrivileges|@better-auth\//)
    expect(read('convex/http.ts')).toContain('auth.registerRoutes(http)')
  })

  it('uses one delegated scope vocabulary across profile, tools, and consent UI', () => {
    const scopeSource = read('convex/scopes.ts')
    const sourceFiles = files(starter).filter((path) => /\.(?:ts|vue)$/u.test(path))
    const source = sourceFiles.map((path) => readFileSync(path, 'utf8')).join('\n')
    const delegatedScopes = [...source.matchAll(/['"](mcp:[\w:.-]+)['"]/gu)].map(
      (match) => match[1],
    )

    expect(scopeSource).toContain("'mcp:read':")
    expect(scopeSource).toContain("'mcp:write':")
    expect(new Set(delegatedScopes)).toEqual(new Set(['mcp:read', 'mcp:write']))
    expect(source.match(/const (?:ALLOWED_)?SCOPES\s*=/gu) ?? []).toHaveLength(0)
  })

  it('binds connection management to the signed-in user and keeps provisioning internal', () => {
    const connections = read('convex/connections.ts')
    expect(connections.match(/await auth\.requireUser\(ctx\)/g)).toHaveLength(2)
    expect(connections).toContain('auth.oauthConnections.list(ctx, { userId: user.id })')
    expect(connections).toContain(
      'auth.oauthConnections.revoke(ctx, { userId: user.id, clientId })',
    )
    expect(connections).not.toMatch(/userId: v\./)
    expect(connections).toContain('export const createHostClient = internalMutation(')
    expect(connections).toContain('export const createInspectorClient = internalMutation(')
    expect(connections).not.toMatch(/export const create\w*Client = (?:mutation|action)\(/)
  })

  it('renders only provider-verified authorization transaction data on hardened pages', () => {
    const transaction = readFileSync(
      join(starter, 'app/composables/useVerifiedOAuthTransaction.ts'),
      'utf8',
    )
    const login = readFileSync(join(starter, 'app/pages/login.vue'), 'utf8')
    const consent = readFileSync(join(starter, 'app/pages/oauth/consent.vue'), 'utf8')
    const nuxtConfig = readFileSync(join(starter, 'nuxt.config.ts'), 'utf8')

    expect(transaction).toContain('/api/auth/oauth2/public-client-prelogin')
    expect(transaction).toContain('oauth_query: signedQuery')
    expect(transaction).toContain('resource !== `${runtimeConfig.public.convex.siteUrl}/mcp`')
    expect(transaction).not.toMatch(/parameters\.get(?:All)?\(['"]client_name['"]\)/)
    expect(login).toContain('transaction.clientName')
    expect(consent).toContain("transaction.value.scopes.join(' ')")
    expect(nuxtConfig.match(/'cache-control': 'no-store'/g)).toHaveLength(2)
    expect(nuxtConfig.match(/'x-frame-options': 'DENY'/g)).toHaveLength(2)
    expect(nuxtConfig.match(/frame-ancestors 'none'/g)).toHaveLength(2)
  })

  it('shows and revokes the signed-in user’s connections on the index page', () => {
    const index = read('app/pages/index.vue')
    expect(index).toContain('useConvexQuery(api.connections.list')
    expect(index).toContain('useConvexMutation(api.connections.revoke)')
    expect(index).toContain("auth: 'required'")
  })
})
