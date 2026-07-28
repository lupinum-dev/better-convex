import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const fixtureSource = readFileSync(
  fileURLToPath(new URL('../../scripts/mcp-local-fixture.mjs', import.meta.url)),
  'utf8',
)
const runnerSource = readFileSync(
  fileURLToPath(new URL('../../scripts/run-mcp-auth.mjs', import.meta.url)),
  'utf8',
)
const selectorSource = readFileSync(
  fileURLToPath(new URL('../../scripts/mcp-evidence-fixture.mjs', import.meta.url)),
  'utf8',
)
const starterEnvExample = readFileSync(
  fileURLToPath(new URL('../../starters/mcp-oauth-agent/.env.example', import.meta.url)),
  'utf8',
)
const starterReadme = readFileSync(
  fileURLToPath(new URL('../../starters/mcp-oauth-agent/README.md', import.meta.url)),
  'utf8',
)
const starterPackage = readFileSync(
  fileURLToPath(new URL('../../starters/mcp-oauth-agent/package.json', import.meta.url)),
  'utf8',
)

describe('self-contained MCP OAuth fixture contracts', () => {
  it('uses one matching fixture export and cleans its complete disposable root', () => {
    expect(fixtureSource).toContain('export async function startLocalMcpOAuthFixture')
    expect(selectorSource).toContain(
      "import { startLocalMcpOAuthFixture } from './mcp-local-fixture.mjs'",
    )
    expect(selectorSource).toContain('return startLocalMcpOAuthFixture()')
    expect(runnerSource).toContain('startMcpEvidenceFixture')
    expect(runnerSource).toContain("from './mcp-evidence-fixture.mjs'")
    expect(runnerSource).toContain('await startMcpEvidenceFixture()')
    expect(fixtureSource).toContain('await rm(tempRoot, { force: true, recursive: true })')
    expect(fixtureSource).toContain('process.kill(-child.pid, signal)')
    expect(fixtureSource).toContain('retireCurrentAuthSecretForTest')
    expect(fixtureSource).toContain('secrets.push(replacement)')
    expect(starterReadme).toContain('replace its final command with:')
    expect(starterReadme).toContain('pnpm test:mcp-conformance')
    expect(starterReadme).not.toContain('BCN_MCP_CONFORMANCE_BEARER=')
    expect(starterReadme).toContain(
      "pnpm exec better-convex-nuxt-convex run auth:rotateSigningKey '{}'",
    )
    expect(starterReadme).toContain('require `previousKids` to be empty')
    expect(starterReadme).toContain('contains the exact recorded `newKid`')
    expect(starterReadme).toContain('/api/auth/jwks')
    expect(starterReadme).toContain('openssl rand -base64 24')
    expect(starterReadme).toContain(
      '${BCN_LOCAL_ADMIN_PASSWORD:?set the generated disposable-admin password}',
    )
    expect(starterReadme).toContain('--data-binary @-')
    expect(starterReadme).not.toContain('-d "{\\"name\\"')
    expect(starterReadme).toContain('It remains valid until you change the password')
    expect(starterReadme).not.toContain('local-test-password')
    expect(starterReadme).not.toContain('one-time-test-password')
    expect(starterReadme).toContain(
      'printf \'%s\' "$BCN_AUTH_PROXY_IP_SECRET" | pnpm exec better-convex-nuxt-convex env set BCN_AUTH_PROXY_IP_SECRET',
    )
    expect(starterReadme).not.toContain('YOUR-SEPARATE-RANDOM-SECRET')
    expect(starterReadme).toContain('set -eu')
    expect(starterReadme).toContain('if [ -e .env.local ]; then')
    expect(starterReadme).toContain('Refusing to replace existing .env.local')
    expect(starterReadme).toContain('umask 077')
    expect(starterPackage.match(/--dotenv \.env\.local/g)).toHaveLength(6)
    expect(starterPackage).toContain('better-convex-nuxt-convex dev')
  })

  it('prepares generated root types before the standalone MCP contract suite', () => {
    const prepare = runnerSource.indexOf("['exec', 'nuxt-module-build', 'prepare']")
    const tests = runnerSource.indexOf("['exec', 'vitest', 'run', '--project=mcp']")

    expect(prepare).toBeGreaterThan(-1)
    expect(prepare).toBeLessThan(tests)
  })

  it('consumes immutable release bytes directly and never repacks them', () => {
    expect(fixtureSource).toContain('process.env.BCN_RELEASE_TARBALL')
    expect(fixtureSource).toContain('process.env.BCN_MCP_RELEASE_TARBALL')
    expect(fixtureSource).toContain("['-xzf', releaseTarball, '--strip-components=1'")
    expect(fixtureSource).toContain(
      "['-xzf', mcpReleaseTarball, '--strip-components=1', '-C', installedMcp]",
    )
    expect(fixtureSource).toContain(
      "cp(join(root, 'dist'), join(installedModule, 'dist'), { recursive: true })",
    )
    expect(fixtureSource).toContain(
      "cp(join(root, 'package.json'), join(installedModule, 'package.json'))",
    )
    expect(fixtureSource).not.toContain("await symlink(root, installedModule, 'dir')")
    expect(fixtureSource).toContain("name === '@better-convex/mcp' && mcpReleaseTarball")
    expect(fixtureSource).not.toMatch(/(?:npm|pnpm)[^\n]+\bpack\b/u)
  })

  it('runs tarball auth lifecycle evidence through a production Nitro build', () => {
    expect(fixtureSource).toContain("options.nuxtModeForTest ?? 'development'")
    expect(fixtureSource).toContain(
      "nuxtMode === 'production' ? join(cwd, '.output/server/index.mjs')",
    )
    expect(fixtureSource).toContain("await runCommand(process.execPath, [nuxtCli, 'build']")
    expect(
      readFileSync(
        fileURLToPath(new URL('../../scripts/run-auth-export-sentinels.mjs', import.meta.url)),
        'utf8',
      ),
    ).toContain("nuxtModeForTest: process.env.BCN_RELEASE_TARBALL ? 'production' : 'development'")
  })

  it('separates stateless JWT revoke behavior from live authorization revocation', () => {
    expect(runnerSource).toContain("body?.error !== 'unsupported_token_type'")
    expect(runnerSource).toContain('post-revoke-self-contained-token')
    expect(runnerSource).toContain('runLiveAuthorizationEvidence')
    expect(runnerSource).toContain('verifyDiscoveryDocuments')
    expect(runnerSource).toContain('assertBrowserClean')
  })

  it('derives isolated fixture links from the product and starter manifests', () => {
    expect(fixtureSource).toContain("join(root, 'package.json')")
    expect(fixtureSource).toContain("join(starter, 'package.json')")
    expect(fixtureSource).toContain('productManifest.dependencies')
    expect(fixtureSource).toContain('productManifest.optionalDependencies')
    expect(fixtureSource).toContain('productManifest.peerDependencies')
    expect(fixtureSource).toContain('starterManifest.dependencies')
    expect(fixtureSource).toContain('starterManifest.devDependencies')
    expect(fixtureSource).toContain("dependencyNames.delete('better-convex-nuxt')")
    expect(fixtureSource).toContain('const installedSource = await realpath(source)')
    expect(fixtureSource).toContain("await symlink(installedSource, destination, 'dir')")
    expect(fixtureSource).toContain('await mkdir(dirname(destination),')
    expect(fixtureSource).not.toContain(
      "['better-auth', 'convex', 'kysely', 'nuxt', 'typescript', 'vue', 'vue-tsc']",
    )
  })

  it('builds uncommitted workspace dist before a non-release fixture resolves package exports', () => {
    const vueBuild = fixtureSource.indexOf("['--filter', 'better-convex-vue', 'build']")
    const prepare = fixtureSource.indexOf("['exec', 'nuxt-module-build', 'prepare']")
    const build = fixtureSource.indexOf("['exec', 'nuxt-module-build', 'build']")
    const vueErrorsAccess = fixtureSource.indexOf(
      "access(join(root, 'packages/vue/dist/errors.mjs'))",
    )
    const moduleAccess = fixtureSource.indexOf("access(join(root, 'dist/module.mjs'))")
    const componentAccess = fixtureSource.indexOf(
      "access(join(root, 'dist/runtime/convex-auth/component/convex.config.js'))",
    )
    const installedModule = fixtureSource.indexOf(
      "const installedModule = join(modules, 'better-convex-nuxt')",
    )
    const buildCall = fixtureSource.indexOf('await ensureWorkspacePackageBuild()')
    const workspaceCopy = fixtureSource.indexOf(
      "cp(join(root, 'dist'), join(installedModule, 'dist'), { recursive: true })",
    )

    for (const index of [
      vueBuild,
      prepare,
      build,
      vueErrorsAccess,
      moduleAccess,
      componentAccess,
      installedModule,
      buildCall,
      workspaceCopy,
    ]) {
      expect(index).toBeGreaterThan(-1)
    }
    expect(vueBuild).toBeLessThan(prepare)
    expect(prepare).toBeLessThan(build)
    expect(build).toBeLessThan(vueErrorsAccess)
    expect(build).toBeLessThan(moduleAccess)
    expect(build).toBeLessThan(componentAccess)
    expect(installedModule).toBeLessThan(buildCall)
    expect(buildCall).toBeLessThan(workspaceCopy)
    expect(moduleAccess).toBeLessThan(workspaceCopy)
    expect(componentAccess).toBeLessThan(workspaceCopy)
  })

  it('randomizes concurrent fixture ports and narrowly retries idempotent environment OCC writes', () => {
    expect(fixtureSource).toContain('const START_TIMEOUT_MS = 120_000')
    expect(fixtureSource).toContain('availableRandomPort')
    expect(fixtureSource).toContain('randomInt(12_000, 44_000)')
    expect(fixtureSource).not.toContain('randomBytes(2).readUInt16BE(0)')
    expect(fixtureSource).not.toContain('% 32_000')
    expect(fixtureSource).not.toContain('availablePort(3240)')
    expect(fixtureSource).toContain('/\\b503\\b/u.test(error.message)')
    expect(fixtureSource).toContain(
      '/\\bOptimisticConcurrencyControlFailure\\b/u.test(error.message)',
    )
    expect(fixtureSource).toContain('const maxAttempts = 4')
    expect(fixtureSource).toContain('await setFixtureEnvironment(name, value)')
    expect(fixtureSource).toContain(
      "await setFixtureEnvironment('BETTER_AUTH_SECRETS', replacement)",
    )
  })

  it('uses only the installed package signer for direct-transport client-IP evidence', () => {
    expect(fixtureSource).toContain(
      'node_modules/better-convex-nuxt/dist/runtime/shared/client-ip.js',
    )
    expect(fixtureSource).toContain('installedClientIpModule.normalizeClientIp(ip)')
    expect(fixtureSource).toContain('installedClientIpModule.signClientIp(')
    expect(fixtureSource).toContain('signedClientIpHeadersForTest,')
    expect(fixtureSource).toContain("'x-bcn-client-ip': canonicalIp")
    expect(fixtureSource).toContain("'x-bcn-client-ip-signature':")
    expect(fixtureSource).not.toMatch(/createHmac|subtle\.sign|HMAC/u)
  })

  it('accepts only two bounded printable sentinel overrides and never returns them', () => {
    expect(fixtureSource).toContain('const secretOverrides = options.secretOverridesForTest')
    expect(fixtureSource).toContain(
      "Object.keys(secretOverrides).sort().join(',') !== 'betterAuthSecrets,proxyIpSecret'",
    )
    expect(fixtureSource).toContain('secret.length < 32')
    expect(fixtureSource).toContain('secret.length > 1_024')
    expect(fixtureSource).toContain('const secrets = [password, betterAuthSecrets, proxyIpSecret]')
    expect(starterEnvExample).not.toContain('BETTER_AUTH_SECRETS')
    expect(starterReadme).toContain(
      'pnpm exec better-convex-nuxt-convex env set BETTER_AUTH_SECRETS',
    )
    expect(starterReadme).toContain(
      'Better Auth secret is generated independently and is never copied into Nuxt',
    )
    const returnedFixture = fixtureSource.slice(
      fixtureSource.indexOf('return Object.freeze({\n      convexSiteUrl,'),
    )
    expect(returnedFixture).not.toMatch(/betterAuthSecrets|proxyIpSecret/u)
  })

  it('includes only bounded redacted Nuxt output when startup fails', () => {
    expect(fixtureSource).toContain('`${message}; Nuxt output: ${safeLog(nuxtLog(), secrets)}`')
    expect(fixtureSource).toContain('return redactEvidenceLog(value, secrets).slice(-8_000)')
    expect(fixtureSource).not.toContain('Nuxt output: ${nuxtLog()}')
  })

  it('proves the mounted-provider Convex token with the official verifier and exact token class', () => {
    expect(runnerSource).toContain('/api/auth/convex/token')
    expect(runnerSource).toContain('verifyBearerToken as verifyOfficialJwt')
    expect(runnerSource).toContain('jwksUrl: `${origin}/api/auth/jwks`')
    expect(runnerSource).toContain("audience: 'convex'")
    expect(runnerSource).toContain("claims.token_use !== 'convex-session'")
    expect(runnerSource).toContain(
      "JSON.stringify(Object.keys(header).sort()) !== JSON.stringify(['alg', 'kid'])",
    )
  })
})
