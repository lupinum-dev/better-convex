import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'

import { runAuthSchemaCommand } from './auth-schema'
import { inspectConvexAuthority, runConvexCommand } from './convex'

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
export const { ensureSigningKey, rotateSigningKey } = auth.jwksOperatorFunctions()
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
export const { assertProfile, consumeOne, count, create, deleteMany, deleteOne, findMany, findOne, incrementOne, rotateSigningKey, sessionAdmission, expireWorkforceSession, listWorkforceSessions, revokeAllWorkforceSessions, revokeWorkforceSession, touchWorkforceSession, updateMany, updateOne } = defineAuthAdapterFunctions({ metadata: schemaMetadata, schema })
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

function defaultDependencies(root: string): InitDependencies {
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
  async function question(message: string): Promise<string> {
    const terminal = createInterface({ input: process.stdin, output: process.stdout })
    try {
      return await terminal.question(message)
    } finally {
      terminal.close()
    }
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
    generateSchema: runAuthSchemaCommand,
    randomSecret: () => randomBytes(32).toString('base64url'),
    log: console.log,
  }
}

function parseArguments(args: readonly string[]): { help: boolean; typedClient: boolean } {
  let help = false
  let typedClient = false
  for (const argument of args) {
    if (argument === '--help' || argument === '-h') help = true
    else if (argument === '--typed-client') typedClient = true
    else if (argument === '--prod' || argument === '--production') {
      throw new Error('better-convex init refuses production provisioning')
    } else throw new Error(`Unknown init argument: ${argument}`)
  }
  return { help, typedClient }
}

async function inspectFiles(root: string, typedClient: boolean): Promise<PlannedFile[]> {
  const entries: Record<string, string> = { ...templates }
  if (typedClient) entries['convex-auth.ts'] = typedClientTemplate
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

async function provisionDevelopment(dependencies: InitDependencies): Promise<void> {
  const environmentNames = new Set(await dependencies.readEnvironmentNames())
  if (environmentNames.has('BCN_AUTH_INITIALIZED')) {
    dependencies.log('Development auth secrets and the first signing key are already provisioned.')
    return
  }
  const siteUrl = await dependencies.prompt('Development site URL', 'http://localhost:3000')
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
  await set('BCN_AUTH_PROXY_IP_SECRET', dependencies.randomSecret())
  const ensured = await dependencies.runConvex(['run', 'auth:ensureSigningKey', '{}'])
  if (ensured !== 0) {
    throw new Error(
      `development provisioning stopped after: ${completed.join(', ')}. Signing-key provisioning failed; rerun init to continue.`,
    )
  }
  completed.push('signing key')
  await set('BCN_AUTH_INITIALIZED', '1')
  dependencies.log(`Development provisioning complete: ${completed.join(', ')}.`)
}

export async function runInitCommand(
  args: readonly string[],
  overrides: Partial<InitDependencies> = {},
): Promise<number> {
  const parsed = parseArguments(args)
  if (parsed.help) {
    console.log('Usage: better-convex init [--typed-client]')
    return 0
  }
  const root = process.cwd()
  const defaults = defaultDependencies(root)
  const dependencies: InitDependencies = { ...defaults, ...overrides }
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
  await provisionDevelopment(dependencies)
  return 0
}
