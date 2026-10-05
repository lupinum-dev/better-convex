import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { parseEnv } from 'node:util'

import { normalizeAuthOrigin } from '../shared/auth-origin'
import { inspectConvexAuthority, runConvexCommand } from './convex'
import { rethrowAuthSchemaImportError } from './optional-auth'

export interface InitDependencies {
  confirm(message: string): Promise<boolean>
  prompt(message: string, defaultValue: string): Promise<string>
  readDevelopmentAuthorityLabel(): Promise<string>
  runConvex(args: readonly string[], input?: string): Promise<number>
  readEnvironmentNames(): Promise<ReadonlySet<string>>
  generateSchema(args: readonly string[]): Promise<number>
  randomSecret(): string
  log(message: string): void
}

interface PlannedFile {
  path: string
  contents: string
  exists: boolean
}

const templates = {
  'convex/auth.config.ts': `import { getConvexAuthProvider } from '@lupinum/better-convex-nuxt/better-auth/server'
import type { AuthConfig } from 'convex/server'

export default { providers: [getConvexAuthProvider()] } satisfies AuthConfig
`,
  'convex/auth.ts': `import { createBetterConvexAuth } from '@lupinum/better-convex-nuxt/better-auth/server'

import { components } from './_generated/api'
import type { DataModel } from './_generated/dataModel'

export const auth = createBetterConvexAuth<DataModel>(components.betterAuth)
export const createAuth = auth.createAuth
export const { ensureSigningKey, pruneSigningKeys, rotateSigningKey } = auth.jwksOperatorFunctions()
export const { onCreate, onUpdate, onDelete } = auth.triggerFunctions()
`,
  'convex/http.ts': `import { httpRouter } from 'convex/server'

import { auth } from './auth'

const http = httpRouter()
auth.registerRoutes(http)
export default http
`,
  'convex/convex.config.ts': `import { defineApp } from 'convex/server'

import betterAuth from './betterAuth/convex.config'

const app = defineApp()
app.use(betterAuth, { name: 'betterAuth' })
export default app
`,
  'convex/betterAuth/adapter.ts': `import { defineAuthAdapterFunctions } from '@lupinum/better-convex-nuxt/better-auth/server'

import schema from './schema'
import schemaMetadata from './schemaMetadata'

// This module is inside the isolated betterAuth component, not the public app API.
export const { consumeOne, consumeRateLimit, count, create, deleteMany, deleteOne, expireSession, findMany, findOne, incrementOne, oauthLiveAccess, pruneRateLimits, pruneSigningKeys, rotateSigningKey, sessionAdmission, updateMany, updateOne } = defineAuthAdapterFunctions({ metadata: schemaMetadata, schema })
`,
  'convex/betterAuth/convex.config.ts': `import { defineComponent } from 'convex/server'

export default defineComponent('betterAuth')
`,
  'convex/betterAuth/schemaPlugins.ts': `import { jwt, organization } from 'better-auth/plugins'

export function createAuthSchemaPlugins(authIssuer: string) {
  return [
    organization(),
    jwt({
      disableSettingJwtHeader: true,
      jwks: { disablePrivateKeyEncryption: false, gracePeriod: 21 * 60, keyPairConfig: { alg: 'RS256' } },
      jwt: { audience: authIssuer, expirationTime: '10m', issuer: authIssuer },
    }),
  ]
}
`,
  'convex/betterAuth/schemaOptions.ts': `import type { BetterAuthOptions } from 'better-auth'

import { createAuthSchemaPlugins } from './schemaPlugins'

const origin = 'https://schema.invalid'
export default {
  basePath: '/api/auth',
  baseURL: origin,
  plugins: createAuthSchemaPlugins(\`${'${origin}'}/api/auth\`),
  rateLimit: { enabled: true, modelName: 'rateLimit', storage: 'database' },
  secret: 'schema-generation-only-value-never-used-at-runtime',
  verification: { storeIdentifier: 'hashed' },
} satisfies BetterAuthOptions
`,
} as const

// Nuxt 4 looks for the auth-client definition in `<srcDir>/convex-auth.ts`; `app/` is the default srcDir.
const TYPED_CLIENT_PATH = 'app/convex-auth.ts'
const PROXY_SECRET_NAME = 'BCN_AUTH_PROXY_IP_SECRET'
const LOCAL_ENV_FILE = '.env.local'

const typedClientTemplate = `import { defineConvexAuthClient } from '@lupinum/better-convex-nuxt/better-auth/client'

export default defineConvexAuthClient()
`

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function defaultDependencies(root: string): InitDependencies & { close(): void } {
  let authorityPromise: ReturnType<typeof inspectConvexAuthority> | undefined
  const developmentAuthority = async () => {
    authorityPromise ??= inspectConvexAuthority(root)
    const authority = await authorityPromise
    if (!authority.development) {
      throw new Error('better-convex init refuses production or unclassified authority')
    }
    return authority
  }
  const runDevelopmentConvex = async (
    args: readonly string[],
    options: { input?: string; onStdout?: (output: string) => void } = {},
  ) => {
    const authority = await developmentAuthority()
    return await runConvexCommand(args, {
      ...options,
      cwd: root,
      developmentOnly: true,
      expectedAuthorityDigest: authority.digest,
      quiet: true,
    })
  }
  // One line reader for the whole run. The iterator buffers lines, so answers
  // piped on stdin reach every question instead of only the first.
  let terminal: ReturnType<typeof createInterface> | undefined
  let lines: AsyncIterator<string> | undefined
  async function question(message: string): Promise<string> {
    process.stdout.write(message)
    terminal ??= createInterface({ input: process.stdin, crlfDelay: Infinity })
    lines ??= terminal[Symbol.asyncIterator]()
    const next = await lines.next()
    return next.done ? '' : next.value
  }
  return {
    async confirm(message) {
      const answer = (await question(`${message} [y/N] `)).trim().toLowerCase()
      return answer === 'y' || answer === 'yes'
    },
    async prompt(message, defaultValue) {
      const answer = (await question(`${message} [${defaultValue}] `)).trim()
      return answer || defaultValue
    },
    async readDevelopmentAuthorityLabel() {
      return (await developmentAuthority()).label
    },
    runConvex: async (args, input) => await runDevelopmentConvex(args, { input }),
    async readEnvironmentNames() {
      let output = ''
      const status = await runDevelopmentConvex(['env', 'list', '--names-only'], {
        onStdout: (value) => {
          output += value
        },
      })
      if (status !== 0) {
        throw new Error('Could not inspect the development Convex environment; no values changed.')
      }
      const names = output
        .split(/\r?\n/u)
        .map((name) => name.trim())
        .filter(Boolean)
      if (names.some((name) => !/^[A-Z][A-Z0-9_]*$/u.test(name))) {
        throw new Error('Convex returned an invalid environment-name list; no values changed.')
      }
      return new Set(names)
    },
    async generateSchema(args) {
      const { runAuthSchemaCommand } = await import('./auth-schema').catch(
        rethrowAuthSchemaImportError,
      )
      return await runAuthSchemaCommand(args)
    },
    randomSecret: () => randomBytes(32).toString('base64url'),
    log: console.log,
    close: () => terminal?.close(),
  }
}

interface InitArguments {
  help: boolean
  typedClient: boolean
  /** Answer yes to every confirmation and use the default for every prompt. */
  yes: boolean
  siteUrl?: string
}

function parseArguments(args: readonly string[]): InitArguments {
  const parsed: InitArguments = { help: false, typedClient: false, yes: false }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === '--help' || argument === '-h') parsed.help = true
    else if (argument === '--typed-client') parsed.typedClient = true
    else if (argument === '--yes' || argument === '-y') parsed.yes = true
    else if (argument === '--site-url' || argument.startsWith('--site-url=')) {
      const value = argument === '--site-url' ? args[(index += 1)] : argument.slice(11)
      if (!value) throw new Error('--site-url requires an origin')
      parsed.siteUrl = normalizeAuthOrigin(value, 'SITE_URL')
    } else if (argument === '--prod' || argument === '--production') {
      throw new Error('better-convex init refuses production provisioning')
    } else throw new Error(`Unknown init argument: ${argument}`)
  }
  return parsed
}

async function inspectFiles(root: string, typedClient: boolean): Promise<PlannedFile[]> {
  const entries: Record<string, string> = { ...templates }
  if (typedClient) entries[TYPED_CLIENT_PATH] = typedClientTemplate
  const planned: PlannedFile[] = []
  const conflicts: string[] = []
  for (const [relativePath, contents] of Object.entries(entries)) {
    const path = join(root, relativePath)
    const existing = await readOptional(path)
    if (existing !== undefined && existing !== contents) conflicts.push(relativePath)
    planned.push({ path, contents, exists: existing === contents })
  }
  if (conflicts.length > 0) {
    throw new Error(
      `initializer found conflicting files and wrote nothing: ${conflicts.join(', ')}. Move or merge them manually, then rerun.`,
    )
  }
  return planned
}

function showPlan(
  root: string,
  files: readonly PlannedFile[],
  log: (message: string) => void,
): void {
  const missing = files.filter((file) => !file.exists)
  if (missing.length === 0) {
    log('Local Better Convex auth files are already initialized.')
    return
  }
  log('Proposed files:')
  for (const file of missing) {
    const relative = file.path.slice(root.length + 1)
    log(`--- /dev/null\n+++ ${relative}\n${file.contents}`)
  }
}

async function writeMissing(files: readonly PlannedFile[]): Promise<void> {
  for (const file of files) {
    if (file.exists) continue
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, file.contents, { encoding: 'utf8', flag: 'wx', mode: 0o644 })
  }
}

function readLocalEnvironmentValue(contents: string, name: string): string | undefined {
  return parseEnv(contents)[name] || undefined
}

/** Append `name=value` to `.env.local` unless the file already sets `name`. */
async function ensureLocalEnvironmentValue(
  root: string,
  name: string,
  createValue: () => string,
  dependencies: InitDependencies,
): Promise<string> {
  const path = join(root, LOCAL_ENV_FILE)
  const contents = (await readOptional(path)) ?? ''
  const existing = readLocalEnvironmentValue(contents, name)
  if (existing !== undefined) return existing
  const value = createValue()
  const separator = contents === '' || contents.endsWith('\n') ? '' : '\n'
  await appendFile(path, `${separator}${name}=${value}\n`, { encoding: 'utf8', mode: 0o600 })
  dependencies.log(`Wrote ${name} to ${LOCAL_ENV_FILE}.`)
  return value
}

/**
 * Nuxt and Convex must share one proxy secret. Reuse the value in `.env.local` when it
 * exists; otherwise create one and write it to `.env.local` before Convex, so a failed
 * Convex step can be retried with the same value.
 */
function resolveLocalProxySecret(root: string, dependencies: InitDependencies): Promise<string> {
  return ensureLocalEnvironmentValue(
    root,
    PROXY_SECRET_NAME,
    () => dependencies.randomSecret(),
    dependencies,
  )
}

async function provisionDevelopment(root: string, dependencies: InitDependencies): Promise<void> {
  const environmentNames = new Set(await dependencies.readEnvironmentNames())
  const localSiteUrl = readLocalEnvironmentValue(
    (await readOptional(join(root, LOCAL_ENV_FILE))) ?? '',
    'SITE_URL',
  )
  // A `${...}` reference is expanded by Nuxt's env loader, not here.
  const localSiteUrlIsLiteral = localSiteUrl !== undefined && !localSiteUrl.includes('$')
  const siteUrl = await dependencies.prompt(
    'Development site URL',
    localSiteUrlIsLiteral ? localSiteUrl : 'http://localhost:3000',
  )
  // nuxt.config reads SITE_URL for `convex.auth.origin`; Convex and Nuxt must agree.
  if (environmentNames.has('SITE_URL')) {
    // Convex keeps its value; init cannot read it back to compare.
    if (localSiteUrl === undefined) {
      dependencies.log(
        `SITE_URL is set in Convex but not in ${LOCAL_ENV_FILE}. Add the same value to ${LOCAL_ENV_FILE}, or Nuxt uses http://localhost:3000 as its origin.`,
      )
    }
  } else if (localSiteUrl !== undefined && !localSiteUrlIsLiteral) {
    dependencies.log(
      `Kept SITE_URL in ${LOCAL_ENV_FILE}. It must resolve to ${siteUrl}, the value set in Convex.`,
    )
  } else {
    if (localSiteUrl !== undefined && localSiteUrl !== siteUrl) {
      throw new Error(
        `${LOCAL_ENV_FILE} sets SITE_URL=${localSiteUrl}, but you entered ${siteUrl}. Nuxt and Convex must use the same origin: change ${LOCAL_ENV_FILE} or enter ${localSiteUrl}, then rerun init.`,
      )
    }
    await ensureLocalEnvironmentValue(root, 'SITE_URL', () => siteUrl, dependencies)
  }
  const completed: string[] = []
  const set = async (name: string, value: string) => {
    if (environmentNames.has(name)) return
    const status = await dependencies.runConvex(['env', 'set', name], value)
    if (status !== 0) {
      throw new Error(
        `development provisioning stopped after: ${completed.join(', ') || 'no external steps'}. Failed to set ${name}; rerun init to continue.`,
      )
    }
    environmentNames.add(name)
    completed.push(name)
  }
  await set('SITE_URL', siteUrl)
  await set('BETTER_AUTH_SECRETS', `0:${dependencies.randomSecret()}`)
  if (environmentNames.has(PROXY_SECRET_NAME)) {
    const local = readLocalEnvironmentValue(
      (await readOptional(join(root, LOCAL_ENV_FILE))) ?? '',
      PROXY_SECRET_NAME,
    )
    if (local === undefined) {
      dependencies.log(
        `${PROXY_SECRET_NAME} is set in Convex but not in ${LOCAL_ENV_FILE}. Add the same value to ${LOCAL_ENV_FILE}, or the Nuxt auth proxy rejects every request.`,
      )
    }
  } else {
    await set(PROXY_SECRET_NAME, await resolveLocalProxySecret(root, dependencies))
  }
  const ensured = await dependencies.runConvex(['run', 'auth:ensureSigningKey', '{}'])
  if (ensured !== 0) {
    throw new Error(
      `development provisioning stopped after: ${completed.join(', ')}. Signing-key provisioning failed; rerun init to continue.`,
    )
  }
  completed.push('signing key')
  dependencies.log(`Development provisioning complete: ${completed.join(', ')}.`)
}

export async function runInitCommand(
  args: readonly string[],
  overrides: Partial<InitDependencies> = {},
): Promise<number> {
  const parsed = parseArguments(args)
  if (parsed.help) {
    console.log(
      [
        'Usage: better-convex init [--typed-client] [--yes] [--site-url <origin>]',
        '',
        '  --typed-client       Also write app/convex-auth.ts.',
        '  --yes, -y            Accept every step without asking (for scripts and CI).',
        '  --site-url <origin>  Development site URL. Default: http://localhost:3000.',
      ].join('\n'),
    )
    return 0
  }
  const root = process.cwd()
  const defaults = defaultDependencies(root)
  const answers: Partial<InitDependencies> = {
    ...(parsed.yes ? { confirm: async () => true } : {}),
    ...(parsed.siteUrl || parsed.yes
      ? { prompt: async (_message, defaultValue) => parsed.siteUrl ?? defaultValue }
      : {}),
  }
  const dependencies: InitDependencies = { ...defaults, ...answers, ...overrides }
  try {
    return await initialize(root, parsed, dependencies)
  } finally {
    defaults.close()
  }
}

async function initialize(
  root: string,
  parsed: InitArguments,
  dependencies: InitDependencies,
): Promise<number> {
  const schemaPath = join(root, 'convex/betterAuth/schema.ts')
  const metadataPath = join(root, 'convex/betterAuth/schemaMetadata.ts')
  const [schema, metadata] = await Promise.all([
    readOptional(schemaPath),
    readOptional(metadataPath),
  ])
  if ((schema === undefined) !== (metadata === undefined)) {
    throw new Error(
      'initializer found an incomplete generated auth schema and wrote nothing. Remove the incomplete generated file, then rerun.',
    )
  }
  const files = await inspectFiles(root, parsed.typedClient)
  showPlan(root, files, dependencies.log)
  if (files.some((file) => !file.exists)) {
    if (!(await dependencies.confirm('Write these development files?'))) return 0
    await writeMissing(files)
  }
  if (schema === undefined) {
    dependencies.log('Missing generated files: convex/betterAuth/schema.ts and schemaMetadata.ts')
    if (!(await dependencies.confirm('Generate the reviewed auth schema files?'))) return 0
  }
  const schemaArguments = [
    '--config',
    join(root, 'convex/betterAuth/schemaOptions.ts'),
    '--output',
    join(root, 'convex/betterAuth'),
  ]
  const schemaStatus = await dependencies.generateSchema(
    schema === undefined ? schemaArguments : [...schemaArguments, '--check'],
  )
  if (schemaStatus !== 0) {
    throw new Error(
      'Generated auth schema conflicts with the reviewed plugin profile. Run better-convex auth schema and review the diff manually.',
    )
  }
  const authorityLabel = await dependencies.readDevelopmentAuthorityLabel()
  if (
    !(await dependencies.confirm(
      `Provision development secrets and the first signing key in ${authorityLabel}?`,
    ))
  ) {
    return 0
  }
  await provisionDevelopment(root, dependencies)
  return 0
}
