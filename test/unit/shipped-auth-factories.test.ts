import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { escapeEmailHtml } from '../../starters/team/convex/lib/authEmail'

const repoRoot = join(import.meta.dirname, '../..')
const authApps = ['demo', 'playground', 'starters/agency', 'starters/team'] as const
const passwordApps = authApps.filter((app) => app !== 'demo')
const authEnvExamples = [
  'demo/.env.example',
  'starters/agency/.env.example',
  'starters/mcp-oauth-agent/.env.example',
  'starters/team/.env.example',
] as const
const passwordForms = [
  'playground/pages/auth/signup.vue',
  'starters/agency/app/pages/agency.vue',
  'starters/team/app/components/AuthPanel.vue',
] as const
const passwordRecipeDocs = ['docs/content/docs/3.get-started/5.add-authentication.md'] as const
const proxySecretExamples = [
  ...authEnvExamples,
  'docs/content/docs/3.get-started/5.add-authentication.md',
  'docs/content/docs/7.operations/1.environment-variables.md',
] as const
const proxySecretDocs = [
  'docs/content/docs/3.get-started/5.add-authentication.md',
  'docs/content/docs/7.operations/1.environment-variables.md',
] as const
const genericSignInForms = [
  'playground/pages/auth/signin.vue',
  'starters/team/app/components/AuthPanel.vue',
] as const
const convexManagedEnvDocs = [
  'starters/mcp-oauth-agent/README.md',
  'docs/content/docs/3.get-started/5.add-authentication.md',
  'docs/content/docs/4.build/3.authentication/2.better-auth-setup.md',
  'docs/content/docs/7.operations/1.environment-variables.md',
  'docs/content/docs/7.operations/2.deployment.md',
  'docs/content/docs/7.operations/4.troubleshooting.md',
  'RELEASING.md',
  'test/TESTING.md',
] as const
const generatedDirectoryNames = new Set([
  '.audit',
  '.claude',
  '.git',
  '.nuxt',
  '.output',
  '.release-artifacts',
  'coverage',
  'dist',
  'node_modules',
])

function read(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

function maintainedMarkdown(): { path: string; source: string }[] {
  const paths: string[] = []
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name)
      if (entry.isDirectory()) {
        if (!generatedDirectoryNames.has(entry.name)) visit(absolute)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        paths.push(relative(repoRoot, absolute))
      }
    }
  }

  visit(repoRoot)

  return [...new Set(paths)].sort().map((path) => ({ path, source: read(path) }))
}

function shellTokens(line: string): string[] {
  return (line.match(/"[^"]*"|'[^']*'|\S+/gu) ?? []).map((token) => {
    const quote = token[0]
    return (quote === '"' || quote === "'") && token.at(-1) === quote ? token.slice(1, -1) : token
  })
}

function setsConvexManagedSiteUrl(line: string): boolean {
  const tokens = shellTokens(line)
  const after = (index: number, predicate: (token: string) => boolean) =>
    tokens.findIndex((token, candidate) => candidate > index && predicate(token))
  const convex = tokens.findIndex(
    (token) =>
      token === 'convex' ||
      token === 'better-convex-nuxt-convex' ||
      token.endsWith('/convex') ||
      token.endsWith('/convex/bin/main.js'),
  )
  const env = after(convex, (token) => token === 'env')
  const set = after(env, (token) => token === 'set')
  const name = after(set, (token) => token === 'CONVEX_SITE_URL')

  return convex >= 0 && env >= 0 && set >= 0 && name >= 0
}

const RAW_CONVEX_COMMAND =
  /(?:^|\s)(?:pnpm\s+exec\s+)?convex\s+(?:codegen|deploy|deployment|dev|env|import|project|run)\b/u
const RAW_CONVEX_MAIN_COMMAND =
  /(?:^|\s)node(?:\.exe)?\s+--\s+\S*node_modules\/convex\/bin\/main\.js\s+(?:codegen|deploy|deployment|dev|env|import|project|run)\b/u

describe('shipped Better Auth factory invariants', () => {
  it('escapes every user-controlled transactional-email HTML delimiter', () => {
    expect(escapeEmailHtml(`<img src=x onerror="alert('x')"> & invited`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; invited',
    )
  })

  it.each(authApps)('%s fails closed on runtime secret and unsafe application origins', (app) => {
    const auth = read(`${app}/convex/auth.ts`)

    expect(auth).toContain("requireAuthOrigin('SITE_URL')")
    expect(auth).toContain("requireAuthOrigin('CONVEX_SITE_URL')")
    expect(auth).toContain("throw new Error('BETTER_AUTH_SECRETS is required')")
    expect(auth).not.toContain('BETTER_AUTH_SECRET ??')
    expect(auth).not.toContain('secret: process.env')
    expect(auth).toContain('trustedOrigins: [siteUrl]')
    expect(auth).toContain("ipAddressHeaders: ['x-bcn-verified-client-ip']")
    expect(auth).toContain("throw new Error('AUTH_CONFIG_INVALID')")
  })

  it('keeps Better Auth secrets out of Nuxt env examples and clears legacy schema aliases', () => {
    const schemaCli = read('src/runtime/cli/auth-schema.ts')

    for (const path of authEnvExamples) {
      expect(read(path)).not.toMatch(/^BETTER_AUTH_SECRETS=/mu)
    }
    expect(schemaCli).toContain("'AUTH_SECRET'")
    expect(schemaCli).toContain("'BETTER_AUTH_SECRET'")
    expect(schemaCli).toContain("'BETTER_AUTH_SECRETS'")
  })

  it.each(proxySecretExamples)('%s leaves copyable proxy secrets blank', (path) => {
    const source = read(path)

    expect(source).toMatch(/^BCN_AUTH_PROXY_IP_SECRET=$/mu)
    expect(source).not.toMatch(/^BCN_AUTH_PROXY_IP_SECRET=.+$/mu)
  })

  it.each(authApps)('%s wires the required production client-IP boundary', (app) => {
    const config = read(`${app}/nuxt.config.ts`)

    expect(config).toContain('trustedClientIpHeader: process.env.BCN_AUTH_TRUSTED_CLIENT_IP_HEADER')
  })

  it.each(authEnvExamples)('%s documents the ingress header without guessing a default', (path) => {
    const source = read(path)

    expect(source).toMatch(/^BCN_AUTH_TRUSTED_CLIENT_IP_HEADER=$/mu)
    expect(source).not.toMatch(/^BCN_AUTH_TRUSTED_CLIENT_IP_HEADER=.+$/mu)
  })

  it.each(proxySecretDocs)('%s provisions one shared proxy secret without printing it', (path) => {
    const source = read(path)

    expect(source).toContain('export BCN_AUTH_PROXY_IP_SECRET="$(openssl rand -base64 32)"')
    expect(source).toContain(
      'printf \'%s\' "$BCN_AUTH_PROXY_IP_SECRET" | pnpm exec better-convex-nuxt-convex env set BCN_AUTH_PROXY_IP_SECRET',
    )
    expect(source).toContain('same shell')
    expect(source).toContain('Do not print or commit it')
  })

  it.each(convexManagedEnvDocs)(
    '%s does not tell operators to override Convex built-ins',
    (path) => {
      const source = read(path)

      expect(source).not.toMatch(/convex env set CONVEX_SITE_URL/u)
      expect(source).toMatch(
        /CONVEX_SITE_URL[\s\S]{0,160}(built-in|built in)|(built-in|built in)[\s\S]{0,160}CONVEX_SITE_URL/u,
      )
    },
  )

  it('keeps Convex-managed environment names out of every shipped Markdown command', () => {
    const offenders: string[] = []

    for (const { path, source } of maintainedMarkdown()) {
      const logicalLines = source.replace(/\\\r?\n\s*/gu, ' ').split(/\r?\n/u)
      for (const [index, line] of logicalLines.entries()) {
        if (setsConvexManagedSiteUrl(line)) {
          offenders.push(`${path}:${index + 1}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it.each([
    'convex env set CONVEX_SITE_URL https://deployment.convex.site',
    'pnpm exec convex env --prod set --deployment app CONVEX_SITE_URL value',
    '/workspace/node_modules/.bin/convex --verbose env set "CONVEX_SITE_URL" value',
    'node -- node_modules/convex/bin/main.js env set CONVEX_SITE_URL value --env-file .env.local',
  ])('detects forbidden Convex built-in provisioning syntax: %s', (command) => {
    expect(setsConvexManagedSiteUrl(command)).toBe(true)
  })

  it.each([
    'convex env set SITE_URL https://app.example.com',
    'convex env list --names-only',
    'Convex injects the CONVEX_SITE_URL built-in',
  ])('does not reject unrelated setup text: %s', (line) => {
    expect(setsConvexManagedSiteUrl(line)).toBe(false)
  })

  it('keeps raw stateful Convex commands out of supported guides', () => {
    const offenders: string[] = []

    for (const { path, source } of maintainedMarkdown().filter(
      ({ path }) => path !== 'test/TESTING.md',
    )) {
      for (const [index, line] of source
        .replace(/\\\r?\n\s*/gu, ' ')
        .split(/\r?\n/u)
        .entries()) {
        if (RAW_CONVEX_COMMAND.test(line) || RAW_CONVEX_MAIN_COMMAND.test(line)) {
          offenders.push(`${path}:${index + 1}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps starter package scripts on explicit dotenv and deployment authorities', () => {
    for (const starter of ['agency', 'mcp-oauth-agent', 'public', 'team']) {
      const manifest = JSON.parse(read(`starters/${starter}/package.json`)) as {
        scripts?: Record<string, string>
      }
      for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
        if (/\b(?:nuxt|nuxi)\s+(?:build|dev|prepare|preview|typecheck)\b/u.test(command)) {
          expect(command, `${starter}:${name}`).toContain('--dotenv .env.local')
        }
        const convexCommand: string | undefined = (
          {
            'convex:codegen': 'codegen',
            'convex:configure': 'configure',
            'convex:dev': 'dev',
          } as Record<string, string>
        )[name]
        if (convexCommand) {
          expect(command, `${starter}:${name}`).toMatch(
            new RegExp(`(?:^|&& )better-convex-nuxt-convex ${convexCommand}$`, 'u'),
          )
        }
        if (name === 'convex:local:once') {
          expect(command, `${starter}:${name}`).toMatch(
            /^better-convex-nuxt-convex dev --anonymous --once\b/u,
          )
        }
      }
    }
  })

  it('uses one explicit .env.local authority in the generic setup guides', () => {
    for (const path of [
      'README.md',
      'docs/content/docs/3.get-started/2.installation.md',
      'docs/content/docs/3.get-started/3.first-realtime-page.md',
      'docs/content/docs/3.get-started/5.add-authentication.md',
      'docs/content/docs/3.get-started/7.project-structure.md',
      'docs/content/docs/7.operations/1.environment-variables.md',
    ]) {
      const source = read(path)

      expect(source).toContain('.env.local')
      expect(source).not.toContain('[.env]')
      expect(source).not.toMatch(/^├── \.env\s/mu)
    }

    expect(read('docs/content/docs/3.get-started/2.installation.md')).toContain(
      'nuxt prepare --dotenv .env.local',
    )
    expect(read('docs/content/docs/3.get-started/3.first-realtime-page.md')).toContain(
      'nuxt dev --dotenv .env.local',
    )
  })

  it.each(authApps)('%s registers only the lazy Better Auth HTTP ceremony', (app) => {
    const http = read(`${app}/convex/http.ts`)

    expect(http).toContain('authComponent.registerRoutes(http, createAuth)')
    expect(http).not.toContain('registerRoutesLazy')
  })

  it.each(passwordApps)('%s enforces the supported 15-character password floor', (app) => {
    const auth = read(`${app}/convex/auth.ts`)
    expect(auth).toContain('minPasswordLength: 15')
    expect(auth).toContain('autoSignIn: false')
  })

  it.each(passwordForms)('%s matches the backend password floor', (form) => {
    expect(read(form)).toContain('minlength="15"')
    expect(read(form)).not.toContain('minlength="8"')
  })

  it.each(passwordRecipeDocs)('%s keeps copyable password factories hardened', (path) => {
    const source = read(path)
    const factoryCount = source.match(/emailAndPassword:\s*\{/g)?.length ?? 0

    expect(factoryCount).toBeGreaterThan(0)
    expect(source.match(/minPasswordLength:\s*15/g)).toHaveLength(factoryCount)
    expect(source.match(/autoSignIn:\s*false/g)).toHaveLength(factoryCount)
    expect(source.match(/secret\.length < 32/g)).toHaveLength(factoryCount)
    expect(source).not.toContain('estimatedEntropy')
    expect(source.match(/at least 32 random characters/g)).toHaveLength(factoryCount)
  })

  it('keeps canonical signup recipes on the explicit sign-in ceremony', () => {
    const guide = read('docs/content/docs/3.get-started/5.add-authentication.md')
    const operationsGuide = read(
      'docs/content/docs/4.build/3.authentication/4.sign-in-and-sign-out.md',
    )

    expect(guide).toContain('autoSignIn: false')
    expect(guide).toContain('Account created. Sign in next.')
    expect(guide).not.toContain('await refresh()')
    expect(operationsGuide).toContain(
      'email verification and `autoSignIn` determine the next product step',
    )
  })

  it('does not expose Better Auth account-state errors in maintained sign-in UI', () => {
    const genericMessage =
      'Sign in could not be completed. Check your credentials and verify your email if required.'
    const guide = read('docs/content/docs/3.get-started/5.add-authentication.md')
    const operationsGuide = read(
      'docs/content/docs/4.build/3.authentication/4.sign-in-and-sign-out.md',
    )

    for (const path of genericSignInForms) {
      expect(read(path)).toContain(genericMessage)
    }
    expect(guide).toContain("'Sign in failed'")
    expect(guide).not.toContain('result.error.message')
    expect(operationsGuide).toContain('Sign in could not be completed')
    expect(operationsGuide).not.toContain('result.error.message')
    expect(operationsGuide).not.toContain("console.error('Sign in failed:', error.message)")
    expect(read('playground/pages/auth/signin.vue')).not.toContain('result.error.message')
    expect(read('starters/team/app/components/AuthPanel.vue')).not.toContain('result.error.message')
  })

  it('documents password blocklist and distributed abuse-control ownership', () => {
    const security = read('SECURITY.md')

    expect(security).toContain('breached/common-password blocklist')
    expect(security).toContain('process-local defense in depth')
    expect(security).toContain('trusted-ingress per-account and per-IP limiter')
  })

  it('keeps route components on the app-lifetime session observer', () => {
    const authStateGuide = read(
      'docs/content/docs/4.build/3.authentication/3.auth-state-and-user.md',
    )

    expect(authStateGuide).toContain('do not mount `client.useSession()` in route components')
    expect(authStateGuide).not.toContain('typed `client.useSession()` fields')
  })

  it('keeps plugin guidance from becoming a second auth-factory source', () => {
    const pluginGuide = read('docs/content/docs/4.build/3.authentication/7.better-auth-plugins.md')

    expect(pluginGuide).toContain("Use the repository's `starters/team/convex/betterAuth`")
    expect(pluginGuide).not.toContain('export function createAuthOptions')
  })

  it('keeps schema-changing plugin docs on the maintained factory source', () => {
    const setupGuide = read('docs/content/docs/4.build/3.authentication/2.better-auth-setup.md')
    const pluginGuide = read('docs/content/docs/4.build/3.authentication/7.better-auth-plugins.md')

    expect(setupGuide).toContain('complete minimal versions are in [Add authentication]')
    expect(pluginGuide).not.toContain('export function createAuthOptions')
    expect(pluginGuide).not.toContain('createAuth({} as never)')
  })

  it('does not trust wildcard origins in the runnable playground', () => {
    const auth = read('playground/convex/auth.ts')

    expect(auth).toContain('trustedOrigins: [siteUrl]')
    expect(auth).not.toContain('http://localhost:*')
    expect(auth).not.toContain('http://127.0.0.1:*')
  })

  it('pins the conservative demo OAuth storage and account-linking policy', () => {
    const auth = read('demo/convex/auth.ts')

    expect(auth).toContain("throw new Error('GITHUB_CLIENT_ID is required')")
    expect(auth).toContain("throw new Error('GITHUB_CLIENT_SECRET is required')")
    expect(auth).toContain('encryptOAuthTokens: true')
    expect(auth).toContain('disableImplicitLinking: true')
    expect(auth).toContain('trustedProviders: []')
    expect(auth).toContain('allowDifferentEmails: false')
    expect(auth).toContain('allowUnlinkingAll: false')
  })

  it('keeps the agency identity-to-domain-user path rebuildable and usable', () => {
    const auth = read('starters/agency/convex/auth.ts')
    const page = read('starters/agency/app/pages/agency.vue')

    // Agency users are stable domain actors referenced by tenant and audit
    // records, not disposable display projections. Assert the required
    // lifecycle behavior without coupling this guard to the generic helper.
    expect(auth).toContain('syncAgencyUserActor(ctx, user as BetterAuthUserProjectionSource, true)')
    expect(auth).toContain(
      'syncAgencyUserActor(ctx, user as BetterAuthUserProjectionSource, false)',
    )
    expect(auth).toContain('syncAgencyUserActor(ctx, { id: String(user.id) }, false)')
    expect(auth).toContain('rebuildUserProjectionBatch = internalMutation')
    expect(page).toContain('useConvexAuth()')
    expect(page).toContain('await authClient.signUp.email')
    expect(page).toContain('await authClient.signIn.email')
    expect(page).not.toContain('await refresh()')
  })
})
