#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { stat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const AUTHORITY_ENV_FILE = '.env.local'
const LOCAL_BACKEND_STARTUP_TIMEOUT = 'CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS'
const MAX_ENV_FILE_BYTES = 64 * 1024
const TOKEN_SELECTORS = ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT_TOKEN'] as const
const SELF_HOSTED_SELECTORS = ['CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY'] as const
const ALLOWED_CONVEX_FILE_NAMES = new Set([
  ...TOKEN_SELECTORS,
  ...SELF_HOSTED_SELECTORS,
  'CONVEX_DEPLOYMENT',
  'CONVEX_SITE_URL',
  'CONVEX_URL',
])
const DEPLOYMENT_SELECTORS = new Set([
  ...TOKEN_SELECTORS,
  ...SELF_HOSTED_SELECTORS,
  'CONVEX_DEPLOYMENT',
])
const PINNED_CONVEX_AUTHORITY_NAMES = [
  ...TOKEN_SELECTORS,
  ...SELF_HOSTED_SELECTORS,
  'CONVEX_AGENT_MODE',
  'CONVEX_ALLOW_ANONYMOUS',
  'CONVEX_DEPLOYMENT',
  'CONVEX_IMPORT_CHUNK_SIZE',
  'CONVEX_MIN_DOCUMENTS_FOR_INDEX_DELETE_WARNING',
  'CONVEX_OVERRIDE_ACCESS_TOKEN',
  'CONVEX_PROVISION_HOST',
  'CONVEX_RUNNING_LIVE_IN_MONOREPO',
  'CONVEX_SITE_URL',
  'CONVEX_URL',
  'CONVEX_VERBOSE',
  'CONVEX_VERSION_API_ORIGIN',
  'CONVEX_VERSION_OVERRIDE',
] as const
const FORBIDDEN_FILE_BOUND_ARGUMENTS = [
  '--admin-key',
  '--anonymous',
  '--cloud',
  '--configure',
  '--deployment',
  '--deployment-name',
  '--dev-deployment',
  '--env-file',
  '--local',
  '--local-backend-version',
  '--local-dashboard-version',
  '--local-force-upgrade',
  '--override-auth-client',
  '--override-auth-password',
  '--override-auth-url',
  '--override-auth-username',
  '--preview-create',
  '--preview-name',
  '--prod',
  '--project',
  '--team',
  '--type',
  '--url',
] as const
const FILE_BOUND_COMMANDS = new Set(['codegen', 'deploy', 'dev', 'env', 'run'])
const DEPLOYMENT_KEY = /^(?:dev|prod):[^:|\s]+\|\S+$/u
const DEPLOYMENT_NAME = /^(?:custom|dev|local|preview|prod):[a-z0-9_-]+$/u

type ConvexAuthorityKind = 'deployment-key' | 'deployment-name' | 'self-hosted'

function hasValue(environment: Readonly<Record<string, string>>, name: string): boolean {
  return typeof environment[name] === 'string' && environment[name]!.length > 0
}

function isAnonymousDeployment(value: string): boolean {
  const prefix = 'anonymous:anonymous-'
  if (!value.startsWith(prefix) || value.length === prefix.length) return false
  for (const character of value.slice(prefix.length)) {
    const code = character.charCodeAt(0)
    if (
      character === '/' ||
      character === '\\' ||
      character === ':' ||
      code <= 31 ||
      code === 127
    ) {
      return false
    }
  }
  return true
}

/** Validate that the fixed file contains one, and only one, deployment selector class. */
export function assertConvexAuthoritySelection(
  environment: Readonly<Record<string, string>>,
): ConvexAuthorityKind {
  if (
    Object.keys(environment).some(
      (name) => name.toUpperCase().startsWith('CONVEX_') && !ALLOWED_CONVEX_FILE_NAMES.has(name),
    )
  ) {
    throw new Error('The Convex authority file contains an unsupported Convex setting.')
  }
  const tokens = TOKEN_SELECTORS.filter((name) => hasValue(environment, name))
  const hasDeployment = hasValue(environment, 'CONVEX_DEPLOYMENT')
  const selfHosted = SELF_HOSTED_SELECTORS.filter((name) => hasValue(environment, name))

  if (tokens.length > 1 || selfHosted.length === 1) {
    throw new Error('The Convex authority file contains conflicting or incomplete selectors.')
  }
  if (tokens.length === 1 && !DEPLOYMENT_KEY.test(environment[tokens[0]!]!)) {
    throw new Error('The Convex authority file must use a deployment-scoped key.')
  }
  if (
    hasDeployment &&
    !DEPLOYMENT_NAME.test(environment.CONVEX_DEPLOYMENT!) &&
    !isAnonymousDeployment(environment.CONVEX_DEPLOYMENT!)
  ) {
    throw new Error('The Convex authority file contains an invalid deployment selector.')
  }

  const selectorClasses =
    Number(tokens.length === 1) + Number(hasDeployment) + Number(selfHosted.length === 2)
  if (selectorClasses !== 1) {
    throw new Error('The Convex authority file must contain exactly one deployment selector.')
  }
  if (tokens.length === 1) return 'deployment-key'
  return hasDeployment ? 'deployment-name' : 'self-hosted'
}

/** Build a child environment whose only Convex authority comes from the fixed file. */
export function buildConvexCommandEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
  authorityFile: Readonly<Record<string, string>>,
): Record<string, string> {
  assertConvexAuthoritySelection(authorityFile)
  const environment = buildClearedConvexEnvironment(inherited)
  for (const [name, value] of Object.entries(authorityFile)) {
    if (DEPLOYMENT_SELECTORS.has(name)) environment[name] = value
  }
  if (authorityFile.CONVEX_DEPLOYMENT?.startsWith('anonymous:anonymous-')) {
    environment.CONVEX_AGENT_MODE = 'anonymous'
    environment.CONVEX_ALLOW_ANONYMOUS = 'true'
  }
  return environment
}

function buildClearedConvexEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const localBackendStartupTimeout = inherited[LOCAL_BACKEND_STARTUP_TIMEOUT]
  if (localBackendStartupTimeout) {
    const seconds = Number(localBackendStartupTimeout)
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error('The local Convex backend startup timeout must be a positive number.')
    }
  }
  const environment = Object.fromEntries(
    Object.entries(inherited).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].toUpperCase().startsWith('CONVEX_'),
    ),
  )
  // Convex loads both .env.local and .env without overriding existing values.
  // Empty definitions prevent a sibling file from restoring hidden or
  // higher-precedence authority after inherited values have been removed.
  for (const name of PINNED_CONVEX_AUTHORITY_NAMES) environment[name] = ''
  // This is a bounded startup-tuning input, not deployment authority. Preserve
  // a valid inherited value without pinning an empty definition that Convex
  // interprets as zero.
  if (localBackendStartupTimeout) {
    environment[LOCAL_BACKEND_STARTUP_TIMEOUT] = localBackendStartupTimeout
  }
  return environment
}

function assertFileBoundArguments(arguments_: readonly string[]): void {
  for (const argument of arguments_) {
    if (
      FORBIDDEN_FILE_BOUND_ARGUMENTS.some(
        (name) => argument === name || argument.startsWith(`${name}=`),
      )
    ) {
      throw new Error('Deployment overrides are not supported by this runner.')
    }
  }
}

async function readAuthorityFile(cwd: string): Promise<Record<string, string>> {
  const path = resolve(cwd, AUTHORITY_ENV_FILE)
  try {
    const file = await stat(path)
    if (!file.isFile() || file.size > MAX_ENV_FILE_BYTES) throw new Error('invalid')
    const source = await readFile(path, 'utf8')
    if (source.replaceAll('\r\n', '').includes('\r')) throw new Error('invalid')
    const convexAssignments = new Set<string>()
    for (const line of source.split(/\r?\n/u)) {
      const assignment = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*([=:])/u.exec(line)
      const name = assignment?.[1]
      const separator = assignment?.[2]
      if (name?.toUpperCase().startsWith('CONVEX_')) {
        if (name !== name.toUpperCase() || separator !== '=' || convexAssignments.has(name)) {
          throw new Error('invalid')
        }
        convexAssignments.add(name)
      }
    }
    const parsed = parseEnv(source)
    const environment: Record<string, string> = {}
    for (const [name, value] of Object.entries(parsed)) {
      if (value === undefined) throw new Error('invalid')
      environment[name] = value
    }
    return environment
  } catch {
    throw new Error('The Convex authority file is missing, invalid, or too large.')
  }
}

function usage(): string {
  return [
    'Run the pinned Convex CLI with one explicit deployment authority.',
    '',
    'Usage:',
    '  better-convex-nuxt-convex configure',
    '  better-convex-nuxt-convex dev --anonymous [options]',
    '  better-convex-nuxt-convex <codegen|deploy|dev|env|run> [options]',
    '  better-convex-nuxt-convex deployment select <selector>',
    '',
    'File-bound commands use only .env.local. Configure, anonymous dev, and',
    'deployment select clear inherited and dotenv authority before Convex runs.',
  ].join('\n')
}

export async function runConvexCommand(
  arguments_: readonly string[],
  options: { cwd?: string; inheritedEnvironment?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const inherited = options.inheritedEnvironment ?? process.env
  const [command, ...commandArguments] = arguments_
  let convexArguments: string[]
  let environment: Record<string, string>

  if (command === 'configure') {
    if (commandArguments.length > 0) throw new Error('Configure does not accept extra arguments.')
    convexArguments = ['dev', '--configure']
    environment = buildClearedConvexEnvironment(inherited)
  } else if (command === 'deployment' && commandArguments[0] === 'select') {
    if (
      commandArguments.length !== 2 ||
      !commandArguments[1] ||
      commandArguments[1].startsWith('-')
    ) {
      throw new Error('Deployment select requires an explicit selector.')
    }
    convexArguments = [command, ...commandArguments]
    environment = buildClearedConvexEnvironment(inherited)
  } else if (command === 'dev' && commandArguments.includes('--anonymous')) {
    if (commandArguments.filter((argument) => argument === '--anonymous').length !== 1) {
      throw new Error('Anonymous development accepts exactly one --anonymous flag.')
    }
    const forwardedArguments = commandArguments.filter((argument) => argument !== '--anonymous')
    assertFileBoundArguments(forwardedArguments)
    convexArguments = [command, ...forwardedArguments]
    environment = buildClearedConvexEnvironment(inherited)
    environment.CONVEX_AGENT_MODE = 'anonymous'
    environment.CONVEX_ALLOW_ANONYMOUS = 'true'
  } else if (command && FILE_BOUND_COMMANDS.has(command)) {
    assertFileBoundArguments(commandArguments)
    const authorityFile = await readAuthorityFile(cwd)
    const authorityKind = assertConvexAuthoritySelection(authorityFile)
    const deploymentKey = TOKEN_SELECTORS.map((name) => authorityFile[name]).find(Boolean)
    if (command === 'deploy' && authorityKind === 'deployment-name') {
      throw new Error('Deploy requires a deployment-scoped key or self-hosted authority.')
    }
    if (command === 'deploy' && deploymentKey && !deploymentKey.startsWith('prod:')) {
      throw new Error('Deploy requires a production deployment key or self-hosted authority.')
    }
    if (
      command === 'dev' &&
      authorityKind === 'deployment-name' &&
      !/^(?:anonymous:anonymous-|dev:|local:)/u.test(authorityFile.CONVEX_DEPLOYMENT!)
    ) {
      throw new Error('Dev requires a dev, local, anonymous, or development-key authority.')
    }
    if (command === 'dev' && deploymentKey && !deploymentKey.startsWith('dev:')) {
      throw new Error('Dev requires a development deployment key or local authority.')
    }
    environment = buildConvexCommandEnvironment(inherited, authorityFile)
    convexArguments = [command, ...commandArguments]
  } else {
    throw new Error('Unsupported Convex command.')
  }

  const convexCli = resolve(cwd, 'node_modules/convex/bin/main.js')
  const result = spawnSync(process.execPath, ['--', convexCli, ...convexArguments], {
    cwd,
    env: environment,
    stdio: 'inherit',
  })
  if (result.error || result.status === null) {
    throw new Error('The Convex CLI could not be started or did not exit normally.')
  }
  return result.status
}

let invokedAsScript = false
if (process.argv[1]) {
  try {
    invokedAsScript = realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    // An unresolved entry path cannot identify this module as the executable.
  }
}

if (invokedAsScript) {
  try {
    const arguments_ = process.argv.slice(2)
    if (arguments_.length === 1 && (arguments_[0] === '--help' || arguments_[0] === '-h')) {
      console.log(usage())
      process.exitCode = 0
    } else {
      process.exitCode = await runConvexCommand(arguments_)
    }
  } catch (error) {
    console.error(
      `[better-convex-nuxt-convex] ${error instanceof Error ? error.message : 'failed'}`,
    )
    process.exitCode = 1
  }
}
