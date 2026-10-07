import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

// The MCP starter and docs samples are copied by users. These cheap static
// checks guard the three trust boundaries a copy must not lose; the runtime
// behaviour is covered by the starter's own tests and the integration suite.
const root = process.cwd()
const starter = join(root, 'starters/mcp-oauth-agent')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const read = (path: string) => readFileSync(join(starter, path), 'utf8')

describe('delegated MCP static trust boundaries', () => {
  it('accepts a principal argument only on internal functions', () => {
    const docs = files(join(root, 'docs/content/docs')).filter((path) => path.endsWith('.md'))
    const sources = [
      ...files(join(starter, 'convex')).filter((path) => path.endsWith('.ts')),
      ...docs,
      join(root, 'packages/agents/README.md'),
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
  })

  it('never puts the raw token or a second MCP secret in function arguments or state', () => {
    const paths = files(join(starter, 'convex')).filter((path) => path.endsWith('.ts'))
    const text = (list: string[]) =>
      list.map((path) => `// ${relative(root, path)}\n${readFileSync(path, 'utf8')}`).join('\n')
    const source = text(paths)
    expect(source).not.toContain('MCP_SERVER_SECRET')
    expect(source).not.toMatch(/bearerToken|rawToken|accessToken\s*:/)
    expect(source).not.toMatch(/principal\s*:\s*v\.any/)
    // Deployed code reaches auth rows only through the auth library. Tests, which Convex does not
    // deploy, may set up and end sessions through the adapter.
    const deployed = text(paths.filter((path) => !/(?:\.test|\/test\.setup)\.ts$/.test(path)))
    expect(deployed).toContain('// starters/mcp-oauth-agent/convex/auth.ts')
    expect(deployed).not.toContain('components.betterAuth.adapter')
  })

  it('binds connection management to the signed-in user and keeps provisioning internal', () => {
    const connections = read('convex/connections.ts')
    expect(connections).toContain('auth.oauthConnections.list(ctx, { userId: user.id })')
    expect(connections).toContain(
      'auth.oauthConnections.revoke(ctx, { userId: user.id, clientId })',
    )
    expect(connections).not.toMatch(/userId: v\./)
    expect(connections).not.toMatch(/export const create\w*Client = (?:mutation|action)\(/)
  })
})
