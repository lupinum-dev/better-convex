import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertNoJwtShapedValue,
  normalizeEvidenceOrigin,
  redactEvidenceLog,
} from './mcp-auth-contracts.mjs'
import { startLocalMcpOAuthFixture } from './mcp-local-fixture.mjs'

const convexCli = fileURLToPath(new URL('../node_modules/convex/bin/main.js', import.meta.url))
const MAX_ENV_FILE_BYTES = 128 * 1024
const MAX_CONVEX_OUTPUT_BYTES = 256 * 1024

const externalVariableNames = Object.freeze([
  'BCN_MCP_TEST_APP_DIR',
  'BCN_MCP_TEST_CONVEX_SITE_URL',
  'BCN_MCP_TEST_CONVEX_URL',
  'BCN_MCP_TEST_EMAIL',
  'BCN_MCP_TEST_ORIGIN',
  'BCN_MCP_TEST_PASSWORD',
])

const childCredentialVariableNames = Object.freeze([
  'BCN_AUTH_PROXY_IP_SECRET',
  'BCN_MCP_CONFORMANCE_BEARER',
  'BCN_MCP_RELEASE_TARBALL',
  'BCN_MCP_TEST_MODE',
  ...externalVariableNames,
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_SECRETS',
  'MCP_SERVER_SECRET',
  'NUXT_PUBLIC_CONVEX_SITE_URL',
  'NUXT_PUBLIC_CONVEX_URL',
])
const childCredentialVariableNameSet = new Set(
  childCredentialVariableNames.map((name) => name.toUpperCase()),
)

function requiredEnvironmentValue(environment, name) {
  const value = environment[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required in external-disposable MCP test mode`)
  }
  return value
}

function exactOrigin(environment, name) {
  const value = requiredEnvironmentValue(environment, name)
  const normalized = normalizeEvidenceOrigin(value)
  if (normalized !== value) {
    throw new Error(`${name} must be one exact canonical origin without a trailing slash`)
  }
  return normalized
}

function parseExternalConfiguration(environment) {
  const appDir = requiredEnvironmentValue(environment, 'BCN_MCP_TEST_APP_DIR')
  if (!isAbsolute(appDir)) {
    throw new Error('BCN_MCP_TEST_APP_DIR must be an absolute path')
  }

  const origin = exactOrigin(environment, 'BCN_MCP_TEST_ORIGIN')
  const convexUrl = exactOrigin(environment, 'BCN_MCP_TEST_CONVEX_URL')
  const convexSiteUrl = exactOrigin(environment, 'BCN_MCP_TEST_CONVEX_SITE_URL')
  if (new Set([origin, convexUrl, convexSiteUrl]).size !== 3) {
    throw new Error('The MCP app, Convex API, and Convex site origins must be distinct')
  }
  const deploymentName = managedConvexDeploymentName(convexUrl, 'cloud', 'BCN_MCP_TEST_CONVEX_URL')
  const siteDeploymentName = managedConvexDeploymentName(
    convexSiteUrl,
    'site',
    'BCN_MCP_TEST_CONVEX_SITE_URL',
  )
  if (
    deploymentName.name !== siteDeploymentName.name ||
    deploymentName.region !== siteDeploymentName.region
  ) {
    throw new Error(
      'The external MCP Convex API and site origins must name the same deployment and region',
    )
  }

  const email = requiredEnvironmentValue(environment, 'BCN_MCP_TEST_EMAIL')
  if (email !== email.trim() || email.length > 320 || !/^[^\s@]+@[^\s@]+$/u.test(email)) {
    throw new Error('BCN_MCP_TEST_EMAIL must be one bounded email address')
  }

  const password = requiredEnvironmentValue(environment, 'BCN_MCP_TEST_PASSWORD')
  if (password.length < 15 || password.length > 1_024 || /[\0\r\n]/u.test(password)) {
    throw new Error(
      'BCN_MCP_TEST_PASSWORD must be a single-line password between 15 and 1,024 characters',
    )
  }

  return Object.freeze({
    appDir,
    convexSiteUrl,
    convexUrl,
    deploymentName: deploymentName.name,
    deploymentRegion: deploymentName.region,
    email,
    mode: 'external-disposable',
    origin,
    password,
  })
}

export function parseMcpEvidenceFixtureConfiguration(environment = process.env) {
  const mode = environment.BCN_MCP_TEST_MODE ?? 'local'
  if (mode === 'external-disposable') return parseExternalConfiguration(environment)
  if (mode !== 'local') {
    throw new Error('Unknown BCN_MCP_TEST_MODE; expected local or external-disposable')
  }
  const unexpected = externalVariableNames.filter((name) => environment[name] !== undefined)
  if (unexpected.length > 0) {
    throw new Error(
      `External MCP fixture values require BCN_MCP_TEST_MODE=external-disposable: ${unexpected.join(', ')}`,
    )
  }
  return Object.freeze({ mode: 'local' })
}

export function safeMcpFixtureChildEnvironment(environment = process.env) {
  const childEnvironment = { ...environment }
  for (const name of Object.keys(childEnvironment)) {
    const normalizedName = name.toUpperCase()
    if (
      childCredentialVariableNameSet.has(normalizedName) ||
      normalizedName.startsWith('CONVEX_')
    ) {
      delete childEnvironment[name]
    }
  }
  return childEnvironment
}

function readTopologyEnvironment(source) {
  const topology = {}
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const declaration = parseTopologyDeclaration(line)
    if (!declaration) {
      if (/\bCONVEX_\w+\b/iu.test(line)) {
        throw new Error('External MCP app .env.local contains an invalid Convex declaration')
      }
      continue
    }
    const { name, rawValue } = declaration
    if (
      name.toUpperCase().startsWith('CONVEX_') &&
      !['CONVEX_DEPLOYMENT', 'CONVEX_SITE_URL', 'CONVEX_URL'].includes(name)
    ) {
      throw new Error(`External MCP app .env.local contains unsupported ${name.toUpperCase()}`)
    }
    if (
      ![
        'CONVEX_DEPLOYMENT',
        'CONVEX_SITE_URL',
        'CONVEX_URL',
        'NUXT_PUBLIC_CONVEX_SITE_URL',
        'NUXT_PUBLIC_CONVEX_URL',
        'SITE_URL',
      ].includes(name)
    ) {
      continue
    }
    if (Object.hasOwn(topology, name)) {
      throw new Error(`External MCP app .env.local contains duplicate ${name} values`)
    }
    let value = rawValue.trim()
    const quote = value[0]
    if (quote === "'" || quote === '"' || quote === '`') {
      const closingQuote = value.lastIndexOf(quote)
      const remainder = closingQuote === -1 ? value : value.slice(closingQuote + 1).trim()
      if (closingQuote > 0 && (remainder.length === 0 || remainder.startsWith('#'))) {
        value = value.slice(1, closingQuote)
      }
    } else {
      const comment = value.search(/\s+#/u)
      if (comment !== -1) value = value.slice(0, comment).trimEnd()
    }
    topology[name] = value
  }
  return topology
}

function parseTopologyDeclaration(line) {
  let declaration = line
  if (declaration.startsWith('export')) {
    const remainder = declaration.slice('export'.length)
    if (/^\s/u.test(remainder)) declaration = remainder.trimStart()
  }

  const equals = declaration.indexOf('=')
  const colon = declaration.indexOf(':')
  const colonIsSeparator = colon !== -1 && /^\s/u.test(declaration.slice(colon + 1))
  const separator =
    equals === -1
      ? colonIsSeparator
        ? colon
        : -1
      : colonIsSeparator && colon < equals
        ? colon
        : equals
  if (separator === -1) return null

  const name = declaration.slice(0, separator).trim()
  if (!/^[\w.-]+$/u.test(name)) return null
  return { name, rawValue: declaration.slice(separator + 1) }
}

function managedConvexDeploymentName(origin, service, name) {
  const labels = new URL(origin).hostname.split('.')
  const hasRegion = labels.length === 4
  if (
    (labels.length !== 3 && !hasRegion) ||
    labels.at(-2) !== 'convex' ||
    labels.at(-1) !== service
  ) {
    throw new Error(`${name} must use one canonical managed Convex ${service} origin`)
  }
  const deploymentName = labels[0]
  const region = hasRegion ? labels[1] : null
  if (
    !/^[a-z]+-[a-z]+-\d+$/u.test(deploymentName) ||
    (region !== null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(region))
  ) {
    throw new Error(`${name} must contain one canonical managed Convex deployment name`)
  }
  return Object.freeze({ name: deploymentName, region })
}

async function validateExternalApp(configuration) {
  const directory = await stat(configuration.appDir).catch(() => undefined)
  if (!directory?.isDirectory()) {
    throw new Error('BCN_MCP_TEST_APP_DIR must reference an existing directory')
  }
  const envFile = join(configuration.appDir, '.env.local')
  const metadata = await stat(envFile).catch(() => undefined)
  if (!metadata?.isFile() || metadata.size > MAX_ENV_FILE_BYTES) {
    throw new Error('The external MCP app must have one bounded .env.local file')
  }
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
    throw new Error('The external MCP app .env.local must be owner-only (for example, mode 0600)')
  }
  if (await stat(join(configuration.appDir, '.env')).catch(() => undefined)) {
    throw new Error('The external MCP app must not contain a sibling .env file')
  }
  const topology = readTopologyEnvironment(await readFile(envFile, 'utf8'))
  const deploymentSelector = /^(?:dev|preview):([a-z]+-[a-z]+-\d+)$/u.exec(
    topology.CONVEX_DEPLOYMENT ?? '',
  )
  if (
    deploymentSelector?.[1] !== configuration.deploymentName ||
    topology.SITE_URL !== configuration.origin ||
    topology.CONVEX_URL !== configuration.convexUrl ||
    topology.CONVEX_SITE_URL !== configuration.convexSiteUrl ||
    topology.NUXT_PUBLIC_CONVEX_URL !== configuration.convexUrl ||
    topology.NUXT_PUBLIC_CONVEX_SITE_URL !== configuration.convexSiteUrl
  ) {
    throw new Error(
      'The external MCP deployment selector and origins must exactly match CONVEX_DEPLOYMENT, SITE_URL, CONVEX_URL, CONVEX_SITE_URL, NUXT_PUBLIC_CONVEX_URL, and NUXT_PUBLIC_CONVEX_SITE_URL in .env.local',
    )
  }
}

function capture(child) {
  let output = ''
  const append = (chunk) => {
    output = (output + chunk.toString()).slice(-MAX_CONVEX_OUTPUT_BYTES)
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  return () => output.trim()
}

function safeConvexLog(value, configuration) {
  assertNoJwtShapedValue(value)
  return redactEvidenceLog(value, [configuration.email, configuration.password])
}

async function prepareExternalCliAuthority(configuration, environment) {
  const directory = await mkdtemp(join(tmpdir(), 'bcn-mcp-cli-authority-'))
  await chmod(directory, 0o700)
  try {
    await copyFile(join(configuration.appDir, 'package.json'), join(directory, 'package.json'))
    const child = spawn(
      process.execPath,
      ['--', convexCli, 'deployment', 'select', configuration.deploymentName],
      {
        cwd: directory,
        env: safeMcpFixtureChildEnvironment(environment),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const output = capture(child)
    const [code, signal] = await once(child, 'close')
    if (code !== 0) {
      throw new Error(
        `External fixture Convex deployment preflight failed (${code ?? signal ?? 'unknown'}): ${safeConvexLog(output(), configuration)}`,
      )
    }

    const envFile = join(directory, '.env.local')
    const metadata = await stat(envFile).catch(() => undefined)
    if (!metadata?.isFile() || metadata.size > MAX_ENV_FILE_BYTES) {
      throw new Error('The Convex deployment preflight did not produce one bounded env file')
    }
    const topology = readTopologyEnvironment(await readFile(envFile, 'utf8'))
    const selected = /^(?:dev|preview):([a-z]+-[a-z]+-\d+)$/u.exec(topology.CONVEX_DEPLOYMENT ?? '')
    if (
      selected?.[1] !== configuration.deploymentName ||
      topology.CONVEX_URL !== configuration.convexUrl ||
      topology.CONVEX_SITE_URL !== configuration.convexSiteUrl
    ) {
      throw new Error(
        'The Convex deployment preflight did not confirm the exact non-production deployment and origins',
      )
    }
    await chmod(envFile, 0o600)

    let released = false
    return Object.freeze({
      envFile,
      release: async () => {
        if (released) return
        released = true
        await rm(directory, { force: true, recursive: true })
      },
    })
  } catch (error) {
    await rm(directory, { force: true, recursive: true })
    throw error
  }
}

function createExternalRunConvex(configuration, environment, ensureCliAuthority) {
  return async (functionName, args = {}) => {
    if (!/^[\w./-]+:\w+$/u.test(functionName)) {
      throw new Error('Invalid fixture Convex function name')
    }
    const authority = await ensureCliAuthority()
    const child = spawn(
      process.execPath,
      [
        '--',
        convexCli,
        'run',
        functionName,
        JSON.stringify(args),
        '--deployment',
        configuration.deploymentName,
        '--env-file',
        authority.envFile,
      ],
      {
        cwd: configuration.appDir,
        env: safeMcpFixtureChildEnvironment(environment),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const output = capture(child)
    let result
    try {
      result = await once(child, 'close')
    } catch {
      throw new Error('The repository-pinned Convex CLI could not be started')
    }
    const [code, signal] = result
    if (code !== 0) {
      throw new Error(
        `External fixture Convex command failed (${code ?? signal ?? 'unknown'}): ${safeConvexLog(output(), configuration)}`,
      )
    }
    const value = output()
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
}

async function startExternalMcpOAuthFixture(configuration, environment) {
  await validateExternalApp(configuration)
  let authorityPromise
  let released = false
  const ensureCliAuthority = async () => {
    if (released) throw new Error('The external MCP fixture has already been released')
    authorityPromise ??= prepareExternalCliAuthority(configuration, environment)
    return await authorityPromise
  }
  return Object.freeze({
    convexSiteUrl: configuration.convexSiteUrl,
    convexUrl: configuration.convexUrl,
    cwd: configuration.appDir,
    email: configuration.email,
    origin: configuration.origin,
    password: configuration.password,
    release: async () => {
      if (released) return
      released = true
      const authority = await authorityPromise?.catch(() => undefined)
      await authority?.release()
    },
    runConvex: createExternalRunConvex(configuration, environment, ensureCliAuthority),
  })
}

export async function startMcpEvidenceFixture(environment = process.env) {
  const configuration = parseMcpEvidenceFixtureConfiguration(environment)
  if (configuration.mode === 'local') return startLocalMcpOAuthFixture()
  return startExternalMcpOAuthFixture(configuration, environment)
}
