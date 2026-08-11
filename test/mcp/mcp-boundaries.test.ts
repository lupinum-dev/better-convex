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
  it('has one public HTTP verifier and only tool-specific internal operations', () => {
    const action = readFileSync(join(starter, 'convex/mcp.ts'), 'utf8')
    const tools = readFileSync(join(starter, 'convex/mcpTools.ts'), 'utf8')
    expect(action.match(/createBetterAuthMcpAccessVerifier\(/g)).toHaveLength(1)
    expect(action).toContain('authComponent.validateOAuthAccess(ctx, access)')
    expect(action).toContain("from 'better-convex-mcp'")
    expect(action).toContain("from '@modelcontextprotocol/server'")
    expect(action.match(/server\.registerTool\(/g)).toHaveLength(5)
    expect(action).not.toMatch(/run(?:Query|Mutation|Action)\([^,\n]*(?:message|input)\./)
    expect(tools).not.toMatch(/export const \w+\s*=\s*(?:query|mutation)\s*\(/)
    expect(tools.match(/internalMutation\s*\(/g)).toHaveLength(5)
    expect(tools).not.toMatch(/bearerToken|authorizationHeader|rawToken/)
    expect(tools).not.toMatch(
      /['"]oauth(?:Client(?:Resource)?|Consent|Resource)['"]|['"]session['"]/,
    )
  })

  it('never puts the raw token or a second MCP secret in function arguments or state', () => {
    const sourceFiles = files(join(starter, 'convex')).filter(
      (path) => path.endsWith('.ts') && !path.endsWith('security.ts'),
    )
    const source = sourceFiles
      .map((path) => `// ${relative(root, path)}\n${readFileSync(path, 'utf8')}`)
      .join('\n')
    expect(source).not.toContain('MCP_SERVER_SECRET')
    expect(source).not.toMatch(/bearerToken|rawToken|accessToken\s*:/)
    expect(source).not.toMatch(/principal\s*:\s*v\.any/)
    expect(source).not.toMatch(/functionHandle|callAny|genericBridge/)
  })

  it('keeps OAuth cryptography in the shared package verifier', () => {
    const action = readFileSync(join(starter, 'convex/mcp.ts'), 'utf8')
    expect(action).toContain("from 'better-convex-nuxt/convex-auth'")
    expect(action).toContain('createBetterAuthMcpAccessVerifier')
    expect(action).not.toContain('@better-auth/oauth-provider/resource-client')
    expect(action).not.toMatch(/jose|subtle|createRemoteJWKSet|jwtVerify/)
  })

  it('uses one delegated scope vocabulary across provider, verifier, UI, and transactions', () => {
    const scopeSource = readFileSync(join(starter, 'convex/mcp/scopes.ts'), 'utf8')
    const sourceFiles = files(starter).filter((path) => /\.(?:ts|vue)$/u.test(path))
    const source = sourceFiles.map((path) => readFileSync(path, 'utf8')).join('\n')
    const delegatedScopes = [...source.matchAll(/['"](mcp:[\w:.-]+)['"]/gu)].map(
      (match) => match[1],
    )

    expect(scopeSource).toContain("Object.freeze(['mcp:read', 'mcp:write'] as const)")
    expect(new Set(delegatedScopes)).toEqual(new Set(['mcp:read', 'mcp:write']))
    expect(source.match(/const (?:ALLOWED_)?SCOPES\s*=/gu) ?? []).toHaveLength(0)
  })

  it('provisions only through provider-owned admin endpoints behind live app authorization', () => {
    const auth = readFileSync(join(starter, 'convex/auth.ts'), 'utf8')
    const admin = readFileSync(join(starter, 'convex/mcpAdmin.ts'), 'utf8')
    const providerAdmin = readFileSync(join(starter, 'convex/mcpOAuthAdmin.ts'), 'utf8')

    expect(auth).toContain('clientPrivileges: (identity) => hasOAuthAdminPrivilege')
    expect(auth).toContain('resourcePrivileges: (identity) => hasOAuthAdminPrivilege')
    expect(auth).toContain('allowPublicClientPrelogin: true')
    expect(auth).not.toMatch(/(?:clientPrivileges|resourcePrivileges):\s*\(.*\)\s*=>\s*false/)
    expect(admin).not.toContain('components.betterAuth.adapter')
    expect(admin).not.toMatch(/oauth(?:Client(?:Resource)?|Resource)/)
    expect(providerAdmin).toContain('dispatchAuthEndpoint')
    expect(providerAdmin).toContain('provider.endpoints.adminCreateOAuthClient')
    expect(providerAdmin).toContain('provider.endpoints.adminCreateOAuthResource')
    expect(providerAdmin).toContain('provider.endpoints.adminLinkClientResource')
    expect(providerAdmin).not.toContain('components.betterAuth.adapter')
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

  it('reads display identity from the live projection instead of adding PII to session JWTs', () => {
    const auth = readFileSync(join(starter, 'convex/auth.ts'), 'utf8')
    const users = readFileSync(join(starter, 'convex/users.ts'), 'utf8')
    const index = readFileSync(join(starter, 'app/pages/index.vue'), 'utf8')

    expect(auth).not.toContain('definePayload')
    expect(users).toContain('ctx.auth.getUserIdentity()')
    expect(users).toContain(".withIndex('by_auth_id'")
    expect(users).toContain('if (!user?.active) return null')
    expect(users).toContain('return { email: user.email, name: user.name }')
    expect(index).toContain('useConvexQuery(api.users.getCurrent')
    expect(index).toContain("auth: 'required'")
    expect(index).not.toMatch(/const\s*\{[^}]*\buser\b[^}]*\}\s*=\s*useConvexAuth\(/u)
    expect(index).not.toContain('user?.email')
  })
})
