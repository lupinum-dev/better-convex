import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertCurrentBackendBinary } from '../../scripts/check-auth-backend.mjs'

interface LocalConvexHandle {
  authOrigin: string
  cwd: string
  deploymentEnv: Readonly<Record<string, string>>
  process: ChildProcessWithoutNullStreams
  provisionSigningKey: boolean
  requireAuthDeployment: boolean
  selectionEnvDirectory: string
  url: string
  siteUrl: string
}

interface LocalConvexSelectionEnv {
  directory: string
  path: string
}

interface LocalConvexEnv {
  deployment?: string
  forbiddenCredentialNames?: readonly string[]
  url?: string
  siteUrl?: string
}

export interface EnsureLocalConvexResult {
  env: Record<string, string>
  release: () => Promise<void>
}

export interface EnsureLocalConvexOptions {
  authOrigin?: string
  cwd?: string
  deploymentEnv?: Readonly<Record<string, string>>
  provisionSigningKey?: boolean
  requireAuthDeployment?: boolean
  timeoutMs?: number
}

export interface LocalAuthPreflightOptions {
  cwd?: string
  env?: Record<string, string>
  origin?: string
  timeoutMs?: number
}

let activeHandle: LocalConvexHandle | null = null
let retainers = 0
const startupFailures = new Map<string, Error>()
const convexCli = fileURLToPath(new URL('../../node_modules/convex/bin/main.js', import.meta.url))
const localAuthSecret = '1:better-convex-nuxt-e2e-only-secret-32-bytes-minimum'
const localProxyIpSecret = 'better-convex-nuxt-e2e-proxy-ip-secret-32-bytes'
const localConvexReadyMessage = 'Convex functions ready!'
const localConvexCommandTimeoutMs = 10_000
const localConvexGracefulShutdownMs = 2_000
const localConvexForcedShutdownMs = 3_000
const localConvexSelectionPrefixes = ['anonymous:', 'local:'] as const
const nonLocalConvexCredentialNames = [
  'CONVEX_DEPLOY_KEY',
  'CONVEX_DEPLOYMENT_TOKEN',
  'CONVEX_OVERRIDE_ACCESS_TOKEN',
  'CONVEX_PROVISION_HOST',
  'CONVEX_SELF_HOSTED_ADMIN_KEY',
  'CONVEX_SELF_HOSTED_URL',
] as const
const inheritedConvexEnvBlocklist = new Set(['CONVEX_DEPLOYMENT', ...nonLocalConvexCredentialNames])
const inheritedConvexRuntimeEnvBlocklist = new Set([
  'CONVEX_SITE_URL',
  'CONVEX_URL',
  'NUXT_PUBLIC_CONVEX_SITE_URL',
  'NUXT_PUBLIC_CONVEX_URL',
])
const maxLocalDeploymentEnvEntries = 16
const maxLocalDeploymentEnvValueBytes = 4096
const reservedLocalDeploymentEnvNames = new Set([
  'BCN_AUTH_PROXY_IP_SECRET',
  'BETTER_AUTH_SECRETS',
  'CONVEX_DEPLOYMENT',
  'CONVEX_SITE_URL',
  'CONVEX_URL',
  'NUXT_PUBLIC_CONVEX_SITE_URL',
  'NUXT_PUBLIC_CONVEX_URL',
  'SITE_URL',
])
const allowedLocalConvexFileNames = new Set(['CONVEX_DEPLOYMENT', 'CONVEX_SITE_URL', 'CONVEX_URL'])

function startupKey(
  cwd: string,
  url: string,
  deploymentEnv: Readonly<Record<string, string>>,
): string {
  return `${cwd}:${url}:${JSON.stringify(deploymentEnv)}`
}

async function availableLocalPort(excluded?: number): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer()
      server.unref()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        server.close((error) => {
          if (error) reject(error)
          else if (!address || typeof address === 'string') reject(new Error('Invalid local port'))
          else resolve(address.port)
        })
      })
    })
    if (port !== excluded) return port
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function cacheStartupFailure(key: string, error: unknown): Error {
  const normalized = toError(error)
  startupFailures.set(key, normalized)
  return normalized
}

function installLocalConvexEnv(env: Record<string, string>): Record<string, string> {
  Object.assign(process.env, env)
  return env
}

function redactChildDiagnostic(value: string, sensitiveValues: readonly string[]): string {
  let redacted = value
  for (const sensitiveValue of sensitiveValues) {
    if (!sensitiveValue) continue
    redacted = redacted.replaceAll(sensitiveValue, '[REDACTED]')
    const encoded = encodeURIComponent(sensitiveValue)
    if (encoded !== sensitiveValue) redacted = redacted.replaceAll(encoded, '[REDACTED]')
    const jsonEncoded = JSON.stringify(sensitiveValue).slice(1, -1)
    if (jsonEncoded !== sensitiveValue) {
      redacted = redacted.replaceAll(jsonEncoded, '[REDACTED]')
    }
  }
  return redacted
}

function createChildOutputReader(
  child: ChildProcessWithoutNullStreams,
  sensitiveValues: readonly string[] = [],
): () => string {
  const chunks: string[] = []
  const maxLength = 4000

  const append = (data: Buffer | string) => {
    chunks.push(data.toString())

    let length = chunks.reduce((total, chunk) => total + chunk.length, 0)
    while (length > maxLength && chunks.length > 1) {
      const removed = chunks.shift()
      length -= removed?.length ?? 0
    }
  }

  child.stdout.on('data', append)
  child.stderr.on('data', append)

  return () => {
    const output = redactChildDiagnostic(chunks.join('').replace(/\r/g, '').trim(), sensitiveValues)
    if (!output) return '(no output captured)'
    return output.length > maxLength ? output.slice(-maxLength) : output
  }
}

async function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return

  await new Promise<void>((resolve) => {
    const onExit = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve()
    }, timeoutMs)
    child.once('exit', onExit)
  })
}

function signalChildProcessTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) {
  if (child.pid === undefined) return

  if (process.platform === 'win32') {
    // Force the full tree while the parent PID can still identify its
    // descendants. A graceful parent-only fallback can orphan the backend.
    const arguments_ = ['/PID', String(child.pid), '/T', '/F']
    const result = spawnSync('taskkill', arguments_, { stdio: 'ignore', windowsHide: true })
    if (result.status === 0) return
    child.kill('SIGKILL')
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return
    if (code === 'EPERM') {
      // Some constrained macOS runners deny negative-PID signals even for a
      // group created by this process. Signal the known child directly and
      // let the mandatory owned-port check below prove the backend also died.
      child.kill(signal)
      return
    }
    throw error
  }
}

function spawnConvex(
  cwd: string,
  args: string[],
  overrides: Readonly<Record<string, string>> = {},
  localDeployment?: string,
): ChildProcessWithoutNullStreams {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...overrides }).filter(
      ([name]) =>
        !inheritedConvexRuntimeEnvBlocklist.has(name) && !name.toUpperCase().startsWith('CONVEX_'),
    ),
  )
  // Empty values block dotenv from reintroducing a cloud/deploy-key selection
  // from .env while still being treated as absent by Convex's selector.
  for (const name of inheritedConvexEnvBlocklist) env[name] = ''
  if (localDeployment !== undefined) {
    if (!localConvexSelectionPrefixes.some((prefix) => localDeployment.startsWith(prefix))) {
      throw new Error('Explicit Convex command selection must be local.')
    }
    env.CONVEX_DEPLOYMENT = localDeployment
  }
  env.CONVEX_AGENT_MODE = 'anonymous'
  env.CONVEX_ALLOW_ANONYMOUS = 'true'

  return spawn(process.execPath, ['--', convexCli, ...args], {
    cwd,
    detached: process.platform !== 'win32',
    env,
    stdio: 'pipe',
  })
}

async function createLocalConvexSelectionEnv(deployment: string): Promise<LocalConvexSelectionEnv> {
  const directory = await mkdtemp(path.join(tmpdir(), 'bcn-local-convex-selection-'))
  const envPath = path.join(directory, '.env.local')

  try {
    await writeFile(envPath, `CONVEX_DEPLOYMENT=${deployment}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    return { directory, path: envPath }
  } catch (error) {
    await rm(directory, { force: true, recursive: true })
    throw error
  }
}

async function removeLocalConvexSelectionEnv(directory: string): Promise<void> {
  await rm(directory, { force: true, recursive: true })
}

async function setLocalConvexEnvironment(
  cwd: string,
  selectionEnvPath: string,
  name: string,
  value: string,
): Promise<void> {
  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const child = spawnConvex(cwd, ['env', 'set', name, '--env-file', selectionEnvPath])
    const getOutput = createChildOutputReader(child, [value])
    child.stdin.on('error', () => undefined)
    // Convex removes one framing newline from stdin. Appending one preserves
    // the caller's value exactly, including an intentional trailing newline.
    child.stdin.end(`${value}\n`)
    await waitForChildExit(child, localConvexCommandTimeoutMs)
    if (child.exitCode === null && child.signalCode === null) {
      const output = getOutput()
      await terminateChild(child)
      throw new Error(
        `Timed out configuring local Convex ${name} after ${localConvexCommandTimeoutMs}ms: ${output}`,
      )
    }
    const code = child.exitCode
    if (code === 0) return

    const output = getOutput()
    const transient = output.includes('OptimisticConcurrencyControlFailure')
    if (!transient || attempt === maxAttempts) {
      throw new Error(`Failed to configure local Convex ${name}: ${output}`)
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 100))
  }
}

async function configureLocalAuthEnvironment(
  cwd: string,
  selectionEnvPath: string,
  authOrigin: string,
  deploymentEnv: Readonly<Record<string, string>>,
): Promise<void> {
  await setLocalConvexEnvironment(cwd, selectionEnvPath, 'SITE_URL', authOrigin)
  await setLocalConvexEnvironment(cwd, selectionEnvPath, 'BETTER_AUTH_SECRETS', localAuthSecret)
  await setLocalConvexEnvironment(
    cwd,
    selectionEnvPath,
    'BCN_AUTH_PROXY_IP_SECRET',
    localProxyIpSecret,
  )
  await configureLocalDeploymentEnvironment(cwd, selectionEnvPath, deploymentEnv)
  process.env.BCN_AUTH_PROXY_IP_SECRET = localProxyIpSecret
}

async function configureLocalDeploymentEnvironment(
  cwd: string,
  selectionEnvPath: string,
  deploymentEnv: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [name, value] of Object.entries(deploymentEnv)) {
    await setLocalConvexEnvironment(cwd, selectionEnvPath, name, value)
  }
}

async function readLocalConvexEnv(cwd: string): Promise<LocalConvexEnv> {
  try {
    const envPath = path.join(cwd, '.env.local')
    const content = await readFile(envPath, 'utf-8')
    const lines = content.split('\n')

    const values: Record<string, string> = {}
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      // Match dotenv's supported assignment prefixes. Convex uses dotenv for
      // --env-file, so both `export NAME=value` and `NAME: value` must reach
      // the same cloud-credential guard as ordinary `NAME=value` lines.
      const assignment = trimmed.match(/^(?:export\s+)?([\w.-]+)(?:\s*=\s*|:\s+)/u)
      const key = assignment?.[1]
      if (!key) continue

      const rawValue = trimmed.slice(assignment[0].length).trim()
      const value = rawValue.split('#')[0]?.trim()
      if (!value) continue

      values[key] = value
    }

    const forbiddenCredentialNames = Object.keys(values)
      .filter((name) => {
        const normalized = name.toUpperCase()
        return normalized.startsWith('CONVEX_') && !allowedLocalConvexFileNames.has(normalized)
      })
      .map((name) => name.toUpperCase())
      .sort()

    return {
      deployment: values.CONVEX_DEPLOYMENT,
      forbiddenCredentialNames,
      url: values.CONVEX_URL,
      siteUrl: values.CONVEX_SITE_URL,
    }
  } catch {
    return {}
  }
}

function deriveSiteUrlFromConvexUrl(urlString: string): string | null {
  try {
    const url = new URL(urlString)
    if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.port) {
      const port = Number.parseInt(url.port, 10)
      if (!Number.isNaN(port)) {
        url.port = String(port + 1)
        return url.toString().replace(/\/$/, '')
      }
    }
    return null
  } catch {
    return null
  }
}

function localPortFromUrl(urlString: string): number | null {
  try {
    const url = new URL(urlString)
    const isLoopback =
      url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
    if (!isLoopback || !url.port) return null

    const port = Number.parseInt(url.port, 10)
    return Number.isNaN(port) ? null : port
  } catch {
    return null
  }
}

function isLoopbackUrl(urlString: string): boolean {
  try {
    const { hostname } = new URL(urlString)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  } catch {
    return false
  }
}

function requireLocalConvexSelection(
  cwd: string,
  configured: LocalConvexEnv,
): { deployment: string; url: string; siteUrl: string } {
  const siteUrl =
    configured.siteUrl ??
    (configured.url ? (deriveSiteUrlFromConvexUrl(configured.url) ?? undefined) : undefined)
  const localSelector = localConvexSelectionPrefixes.some((prefix) =>
    configured.deployment?.startsWith(prefix),
  )

  if (
    !localSelector ||
    !configured.deployment ||
    configured.forbiddenCredentialNames?.length ||
    !configured.url ||
    !siteUrl ||
    !isLoopbackUrl(configured.url) ||
    !isLoopbackUrl(siteUrl)
  ) {
    throw new Error(
      [
        `Refusing non-local Convex selection in ${path.join(cwd, '.env.local')}.`,
        '- the E2E auto-start harness accepts only anonymous: or local: deployments with loopback URLs.',
        ...(configured.forbiddenCredentialNames?.length
          ? [
              `- remove forbidden deployment credential(s): ${configured.forbiddenCredentialNames.join(', ')}.`,
            ]
          : []),
      ].join('\n'),
    )
  }

  return { deployment: configured.deployment, url: configured.url, siteUrl }
}

function normalizeLocalAuthOrigin(origin: string): string {
  const url = new URL(origin)
  if (
    url.protocol !== 'http:' ||
    !isLoopbackUrl(origin) ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Local Convex auth origin must be a plain loopback HTTP origin: ${origin}`)
  }
  return url.origin
}

function normalizeLocalDeploymentEnv(
  deploymentEnv: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (deploymentEnv === undefined) return Object.freeze({})
  if (deploymentEnv === null || typeof deploymentEnv !== 'object' || Array.isArray(deploymentEnv)) {
    throw new TypeError('Local Convex deploymentEnv must be a record of environment variables.')
  }

  const entries = Object.entries(deploymentEnv).sort(([left], [right]) => left.localeCompare(right))
  if (entries.length > maxLocalDeploymentEnvEntries) {
    throw new RangeError(
      `Local Convex deploymentEnv cannot contain more than ${maxLocalDeploymentEnvEntries} entries.`,
    )
  }

  for (const [name, value] of entries) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(name)) {
      throw new TypeError(`Invalid local Convex deployment environment variable name: ${name}`)
    }
    if (name.startsWith('CONVEX_')) {
      throw new TypeError(
        `Local Convex deploymentEnv cannot use the reserved Convex CLI namespace: ${name}`,
      )
    }
    if (reservedLocalDeploymentEnvNames.has(name)) {
      throw new TypeError(`Local Convex deploymentEnv cannot override harness-owned ${name}.`)
    }
    if (typeof value !== 'string') {
      throw new TypeError(`Local Convex deployment environment variable ${name} must be a string.`)
    }
    const size = Buffer.byteLength(value, 'utf8')
    if (size === 0 || size > maxLocalDeploymentEnvValueBytes || value.includes('\0')) {
      throw new RangeError(
        `Local Convex deployment environment variable ${name} must contain 1-${maxLocalDeploymentEnvValueBytes} UTF-8 bytes without NUL.`,
      )
    }
  }

  return Object.freeze(Object.fromEntries(entries))
}

function localDeploymentEnvMatches(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([name, value], index) => {
      const rightEntry = rightEntries[index]
      return rightEntry?.[0] === name && rightEntry[1] === value
    })
  )
}

function buildManualAuthSetupHelp(cwd: string): string {
  return [
    '[e2e][auth-loop] Local Better Auth setup is incomplete.',
    'With the anonymous local Convex command below running in another terminal, run:',
    `  cd ${cwd}`,
    '  node -- node_modules/convex/bin/main.js env set SITE_URL http://localhost:3050 --env-file .env.local',
    '  # CONVEX_SITE_URL is supplied by the selected Convex deployment.',
    "  printf '%s' '1:<strong-random-secret>' | node -- node_modules/convex/bin/main.js env set BETTER_AUTH_SECRETS --env-file .env.local",
    "  printf '%s' '<separate-strong-random-secret>' | node -- node_modules/convex/bin/main.js env set BCN_AUTH_PROXY_IP_SECRET --env-file .env.local",
    '  cd .. && pnpm test:e2e',
  ].join('\n')
}

function buildLocalConvexSetupHelp(cwd: string): string {
  return [
    '[e2e] Local Convex backend is not configured.',
    'Either export CONVEX_URL and CONVEX_SITE_URL, or run:',
    `  cd ${cwd}`,
    '  CONVEX_DEPLOY_KEY= CONVEX_DEPLOYMENT_TOKEN= CONVEX_DEPLOYMENT= CONVEX_OVERRIDE_ACCESS_TOKEN= CONVEX_PROVISION_HOST= CONVEX_SELF_HOSTED_URL= CONVEX_SELF_HOSTED_ADMIN_KEY= CONVEX_AGENT_MODE=anonymous CONVEX_ALLOW_ANONYMOUS=true node -- node_modules/convex/bin/main.js dev',
    '  cd .. && pnpm test:e2e',
    'To let the e2e helper spawn the same anonymous local backend, set CONVEX_E2E_AUTO_START=true.',
  ].join('\n')
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const started = Date.now()

  return new Promise((resolve, reject) => {
    const check = () => {
      const socket = new net.Socket()
      socket.setTimeout(500)
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('timeout', () => {
        socket.destroy()
        retry()
      })
      socket.once('error', () => {
        socket.destroy()
        retry()
      })
      socket.connect(port, '127.0.0.1')
    }

    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for local Convex backend on port ${port}`))
        return
      }
      setTimeout(check, 100)
    }

    check()
  })
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (open: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(200)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, '127.0.0.1')
  })
}

async function waitForPortToClose(port: number, timeoutMs: number): Promise<void> {
  const started = Date.now()
  while (Date.now() - started <= timeoutMs) {
    if (!(await isPortOpen(port))) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for owned local Convex backend port ${port} to close.`)
}

async function terminateChild(
  child: ChildProcessWithoutNullStreams,
  ownedPort?: number,
): Promise<void> {
  signalChildProcessTree(child, 'SIGTERM')
  await waitForChildExit(child, localConvexGracefulShutdownMs)

  const treeStillRunning =
    (child.exitCode === null && child.signalCode === null) ||
    (ownedPort !== undefined && (await isPortOpen(ownedPort)))
  if (treeStillRunning) {
    signalChildProcessTree(child, 'SIGKILL')
    await waitForChildExit(child, localConvexForcedShutdownMs)
  }

  if (ownedPort !== undefined) {
    await waitForPortToClose(ownedPort, localConvexForcedShutdownMs)
  }
}

async function waitForLocalConvexSelection(
  child: ChildProcessWithoutNullStreams,
  cwd: string,
  timeoutMs: number,
  getOutput: () => string,
): Promise<{ url: string; siteUrl: string }> {
  const started = Date.now()

  while (Date.now() - started <= timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        [
          'Local Convex exited before its deployment was configured.',
          `- exit code: ${child.exitCode ?? 'none'}`,
          `- signal: ${child.signalCode ?? 'none'}`,
          'Captured Convex output:',
          getOutput(),
        ].join('\n'),
      )
    }

    const configured = await readLocalConvexEnv(cwd)
    if (configured.url) {
      const siteUrl = configured.siteUrl ?? deriveSiteUrlFromConvexUrl(configured.url)
      const port = localPortFromUrl(configured.url)
      if (siteUrl && port !== null) {
        try {
          await waitForPort(port, 500)
          return { url: configured.url, siteUrl }
        } catch {
          // The CLI writes .env.local before the backend is ready. Keep polling.
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(
    [
      `Timed out waiting for Convex to configure its local deployment after ${timeoutMs}ms.`,
      '',
      'Captured Convex output:',
      getOutput(),
    ].join('\n'),
  )
}

async function waitForLocalConvexFunctions(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
  getOutput: () => string,
): Promise<void> {
  const started = Date.now()

  while (Date.now() - started <= timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        [
          'Local Convex exited before the current functions were ready.',
          `- exit code: ${child.exitCode ?? 'none'}`,
          `- signal: ${child.signalCode ?? 'none'}`,
          'Captured Convex output:',
          getOutput(),
        ].join('\n'),
      )
    }

    // A persisted local deployment can serve an old bundle as soon as its
    // backend port opens. Do not let that stale route satisfy E2E readiness:
    // the CLI must confirm that this process pushed the current source graph.
    if (getOutput().includes(localConvexReadyMessage)) return

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(
    [
      `Timed out waiting for Convex to deploy the current functions after ${timeoutMs}ms.`,
      '',
      'Captured Convex output:',
      getOutput(),
    ].join('\n'),
  )
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

function sanitizeBodyPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240)
}

export async function assertLocalAuthReady(options: LocalAuthPreflightOptions = {}): Promise<void> {
  const cwd = options.cwd ?? path.resolve(process.cwd(), 'playground')
  const timeoutMs = options.timeoutMs ?? 5000
  const envFile = await readLocalConvexEnv(cwd)
  const mergedEnv = options.env ?? {}

  const convexUrl = mergedEnv.CONVEX_URL ?? process.env.CONVEX_URL ?? envFile.url
  const siteUrl =
    mergedEnv.CONVEX_SITE_URL ??
    process.env.CONVEX_SITE_URL ??
    envFile.siteUrl ??
    (convexUrl ? (deriveSiteUrlFromConvexUrl(convexUrl) ?? undefined) : undefined)

  if (!convexUrl || !siteUrl) {
    const missing = [!convexUrl ? 'CONVEX_URL' : null, !siteUrl ? 'CONVEX_SITE_URL' : null]
      .filter(Boolean)
      .join(', ')

    throw new Error(
      [
        `[e2e][auth-loop] Missing required local Convex env values: ${missing}.`,
        `- resolved CONVEX_URL: ${convexUrl ?? 'missing'}`,
        `- resolved CONVEX_SITE_URL: ${siteUrl ?? 'missing'}`,
        buildManualAuthSetupHelp(cwd),
      ].join('\n'),
    )
  }

  const origin = options.origin ?? 'http://localhost:3050'
  const originUrl = new URL(origin)
  const getSessionEndpoint = `${siteUrl.replace(/\/$/, '')}/api/auth/get-session`

  let response: Response
  try {
    response = await fetchWithTimeout(
      getSessionEndpoint,
      {
        method: 'GET',
        headers: {
          origin,
          'x-forwarded-host': originUrl.host,
          'x-forwarded-proto': originUrl.protocol.slice(0, -1),
        },
        redirect: 'manual',
      },
      timeoutMs,
    )
  } catch (error) {
    throw new Error(
      [
        `[e2e][auth-loop] Could not reach Better Auth endpoint: ${getSessionEndpoint}`,
        `- cause: ${error instanceof Error ? error.message : String(error)}`,
        buildManualAuthSetupHelp(cwd),
      ].join('\n'),
      { cause: error },
    )
  }

  if (response.status === 404) {
    throw new Error(
      [
        `[e2e][auth-loop] Better Auth HTTP route returned 404 at ${getSessionEndpoint}.`,
        '- likely cause: Better Auth routes are not registered on the local Convex site URL.',
        buildManualAuthSetupHelp(cwd),
      ].join('\n'),
    )
  }

  if (response.status === 403) {
    const body = sanitizeBodyPreview(await response.text())
    throw new Error(
      [
        `[e2e][auth-loop] Better Auth origin validation failed (403) at ${getSessionEndpoint}.`,
        `- attempted origin: ${origin}`,
        `- response: ${body || '(empty body)'}`,
        `- likely cause: SITE_URL/trusted origins do not include ${origin}.`,
        buildManualAuthSetupHelp(cwd),
      ].join('\n'),
    )
  }

  if (response.status >= 500) {
    const body = sanitizeBodyPreview(await response.text())
    throw new Error(
      [
        `[e2e][auth-loop] Better Auth endpoint returned ${response.status} at ${getSessionEndpoint}.`,
        `- response: ${body || '(empty body)'}`,
        '- likely cause: missing/invalid BETTER_AUTH_SECRETS, CONVEX_SITE_URL, or local auth component setup.',
        buildManualAuthSetupHelp(cwd),
      ].join('\n'),
    )
  }
}

function installResolvedLocalEnv(url: string, siteUrl: string): Record<string, string> {
  return installLocalConvexEnv({
    CONVEX_URL: url,
    NUXT_PUBLIC_CONVEX_URL: url,
    CONVEX_SITE_URL: siteUrl,
    NUXT_PUBLIC_CONVEX_SITE_URL: siteUrl,
  })
}

async function waitForLocalAuthDeployment(
  cwd: string,
  url: string,
  siteUrl: string,
  timeoutMs: number,
  authOrigin: string,
  getOutput?: () => string,
): Promise<void> {
  const started = Date.now()
  let lastError: unknown

  while (Date.now() - started <= timeoutMs) {
    try {
      await assertLocalAuthReady({
        cwd,
        env: { CONVEX_SITE_URL: siteUrl, CONVEX_URL: url },
        origin: authOrigin,
        timeoutMs: 1000,
      })
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  throw new Error(
    [
      `Timed out waiting for the local Better Auth deployment after ${timeoutMs}ms.`,
      `- last readiness error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      ...(getOutput ? ['', 'Captured Convex output:', getOutput()] : []),
    ].join('\n'),
  )
}

async function ensureLocalSigningKey(
  cwd: string,
  siteUrl: string,
  deployment: string,
): Promise<void> {
  const jwksUrl = `${siteUrl.replace(/\/$/u, '')}/api/auth/jwks`
  const before = await fetchWithTimeout(jwksUrl, { method: 'GET' }, 1000)
  await before.body?.cancel()
  if (before.status === 200) return
  if (before.status !== 503) {
    throw new Error(`Local signing-key preflight returned HTTP ${before.status}.`)
  }

  const child = spawnConvex(
    cwd,
    ['run', 'auth:rotateSigningKey', '{}', '--typecheck', 'disable', '--codegen', 'disable'],
    {},
    deployment,
  )
  const getOutput = createChildOutputReader(child, [localAuthSecret, localProxyIpSecret])
  child.stdin.end()
  await waitForChildExit(child, localConvexCommandTimeoutMs)
  if (child.exitCode === null && child.signalCode === null) {
    await terminateChild(child)
    throw new Error(`Timed out provisioning the local signing key: ${getOutput()}`)
  }
  if (child.exitCode !== 0) {
    throw new Error(`Failed to provision the local signing key: ${getOutput()}`)
  }

  const after = await fetchWithTimeout(jwksUrl, { method: 'GET' }, 1000)
  await after.body?.cancel()
  if (after.status !== 200) {
    throw new Error(`Provisioned local signing key was not published (HTTP ${after.status}).`)
  }
}

function retainLocalConvex(handle: LocalConvexHandle): () => Promise<void> {
  retainers += 1
  let released = false

  return async () => {
    if (released) return
    released = true

    if (activeHandle?.process !== handle.process) return
    retainers -= 1
    if (retainers > 0) return

    activeHandle = null
    try {
      await terminateChild(handle.process, localPortFromUrl(handle.url) ?? undefined)
    } finally {
      await removeLocalConvexSelectionEnv(handle.selectionEnvDirectory)
    }
  }
}

async function startLocalConvex(
  cwd: string,
  timeoutMs: number,
  authOrigin: string,
  deploymentEnv: Readonly<Record<string, string>>,
  requireAuthDeployment: boolean,
  provisionSigningKey: boolean,
): Promise<LocalConvexHandle> {
  const reviewedBackend = await assertCurrentBackendBinary()
  const configured = await readLocalConvexEnv(cwd)
  const hasSavedSelection = Boolean(
    configured.deployment ||
    configured.url ||
    configured.siteUrl ||
    configured.forbiddenCredentialNames?.length,
  )
  const savedSelection = hasSavedSelection
    ? requireLocalConvexSelection(cwd, configured)
    : undefined
  let selectionEnv = savedSelection
    ? await createLocalConvexSelectionEnv(savedSelection.deployment)
    : undefined

  const devArguments = ['dev']
  if (selectionEnv) devArguments.push('--env-file', selectionEnv.path)
  else {
    const cloudPort = await availableLocalPort()
    const sitePort = await availableLocalPort(cloudPort)
    devArguments.push(
      '--local-cloud-port',
      String(cloudPort),
      '--local-site-port',
      String(sitePort),
    )
  }
  devArguments.push('--local-backend-version', reviewedBackend.version)

  // Prime auth.config.ts only for fixtures that explicitly require the Better
  // Auth readiness gate. Provider-neutral fixtures receive only their reviewed
  // deployment values. Never give a subprocess the application's broader
  // .env.local file.
  const child = spawnConvex(
    cwd,
    devArguments,
    requireAuthDeployment
      ? {
          SITE_URL: authOrigin,
          BETTER_AUTH_SECRETS: localAuthSecret,
          BCN_AUTH_PROXY_IP_SECRET: localProxyIpSecret,
          ...deploymentEnv,
        }
      : deploymentEnv,
  )
  const getOutput = createChildOutputReader(child, [
    localAuthSecret,
    localProxyIpSecret,
    ...Object.values(deploymentEnv),
  ])
  let ownedPort: number | undefined

  try {
    const runningSelection = await waitForLocalConvexSelection(child, cwd, timeoutMs, getOutput)
    ownedPort = localPortFromUrl(runningSelection.url) ?? undefined
    const selected = requireLocalConvexSelection(cwd, await readLocalConvexEnv(cwd))
    if (runningSelection.url !== selected.url || runningSelection.siteUrl !== selected.siteUrl) {
      throw new Error('Local Convex changed deployment selection during E2E startup.')
    }
    selectionEnv ??= await createLocalConvexSelectionEnv(selected.deployment)
    if (requireAuthDeployment) {
      await configureLocalAuthEnvironment(cwd, selectionEnv.path, authOrigin, deploymentEnv)
    } else {
      await configureLocalDeploymentEnvironment(cwd, selectionEnv.path, deploymentEnv)
    }
    await waitForLocalConvexFunctions(child, timeoutMs, getOutput)
    if (requireAuthDeployment) {
      await waitForLocalAuthDeployment(
        cwd,
        selected.url,
        selected.siteUrl,
        timeoutMs,
        authOrigin,
        getOutput,
      )
      if (provisionSigningKey) {
        await ensureLocalSigningKey(cwd, selected.siteUrl, selected.deployment)
      }
    }

    const handle: LocalConvexHandle = {
      authOrigin,
      cwd,
      deploymentEnv,
      process: child,
      provisionSigningKey,
      requireAuthDeployment,
      selectionEnvDirectory: selectionEnv.directory,
      url: selected.url,
      siteUrl: selected.siteUrl,
    }
    activeHandle = handle
    child.once('exit', () => {
      if (activeHandle?.process === child) {
        activeHandle = null
        retainers = 0
        void removeLocalConvexSelectionEnv(handle.selectionEnvDirectory).catch(() => {})
      }
    })
    return handle
  } catch (error) {
    try {
      await terminateChild(child, ownedPort)
    } finally {
      if (selectionEnv) await removeLocalConvexSelectionEnv(selectionEnv.directory)
    }
    throw error
  }
}

function assertRequiredLocalUrls(cwd: string, url: string, siteUrl: string): void {
  if (process.env.BCN_E2E_REQUIRE_LOCAL !== 'true') return
  if (isLoopbackUrl(url) && isLoopbackUrl(siteUrl)) return

  throw new Error(
    [
      '[e2e] BCN_E2E_REQUIRE_LOCAL=true, but the configured Convex URLs are not loopback URLs.',
      `- CONVEX_URL: ${url}`,
      `- CONVEX_SITE_URL: ${siteUrl}`,
      buildLocalConvexSetupHelp(cwd),
    ].join('\n'),
  )
}

export async function ensureLocalConvex(
  options: EnsureLocalConvexOptions = {},
): Promise<EnsureLocalConvexResult> {
  const cwd = options.cwd ?? path.resolve(process.cwd(), 'playground')
  const timeoutMs = options.timeoutMs ?? 45_000
  const autoStart = process.env.CONVEX_E2E_AUTO_START === 'true'
  const authOrigin = normalizeLocalAuthOrigin(options.authOrigin ?? 'http://localhost:3050')
  const deploymentEnv = normalizeLocalDeploymentEnv(options.deploymentEnv)
  const requireAuthDeployment = options.requireAuthDeployment ?? true
  const provisionSigningKey = options.provisionSigningKey ?? requireAuthDeployment

  if (activeHandle) {
    if (
      activeHandle.cwd !== cwd ||
      activeHandle.authOrigin !== authOrigin ||
      activeHandle.provisionSigningKey !== provisionSigningKey ||
      activeHandle.requireAuthDeployment !== requireAuthDeployment
    ) {
      throw new Error(
        `A local Convex backend is already managed with different fixture readiness requirements.`,
      )
    }
    if (!localDeploymentEnvMatches(activeHandle.deploymentEnv, deploymentEnv)) {
      throw new Error(
        `A local Convex backend is already managed for ${cwd} with a different deployment environment.`,
      )
    }

    return {
      env: installResolvedLocalEnv(activeHandle.url, activeHandle.siteUrl),
      release: retainLocalConvex(activeHandle),
    }
  }

  const envFile = await readLocalConvexEnv(cwd)
  const hasSavedSelection = Boolean(
    envFile.deployment ||
    envFile.url ||
    envFile.siteUrl ||
    envFile.forbiddenCredentialNames?.length,
  )
  if (autoStart && hasSavedSelection) requireLocalConvexSelection(cwd, envFile)
  const explicitUrl = process.env.CONVEX_URL ?? envFile.url
  const explicitSiteUrl = explicitUrl
    ? (process.env.CONVEX_SITE_URL ??
      envFile.siteUrl ??
      deriveSiteUrlFromConvexUrl(explicitUrl) ??
      undefined)
    : undefined
  const key = startupKey(
    cwd,
    `${explicitUrl ?? 'auto'}:${authOrigin}:${requireAuthDeployment ? 'auth' : 'functions'}:${provisionSigningKey ? 'key' : 'no-key'}`,
    deploymentEnv,
  )
  const previousFailure = startupFailures.get(key)
  if (previousFailure) throw previousFailure

  if (explicitUrl && explicitSiteUrl) {
    assertRequiredLocalUrls(cwd, explicitUrl, explicitSiteUrl)
    const port = localPortFromUrl(explicitUrl)

    if (port === null) {
      if (autoStart) {
        throw cacheStartupFailure(
          key,
          new Error(
            [
              `Refusing to auto-start against non-loopback Convex URL ${explicitUrl}.`,
              '- the auto-start harness owns only anonymous or local loopback deployments.',
            ].join('\n'),
          ),
        )
      }
      return {
        env: installResolvedLocalEnv(explicitUrl, explicitSiteUrl),
        release: async () => {},
      }
    }

    let reachable = false
    try {
      await assertCurrentBackendBinary()
      await waitForPort(port, 1500)
      reachable = true
    } catch (error) {
      if (!autoStart) {
        throw cacheStartupFailure(
          key,
          new Error(
            [
              `Configured local Convex backend is not reachable at ${explicitUrl}.`,
              `- cause: ${error instanceof Error ? error.message : String(error)}`,
              buildLocalConvexSetupHelp(cwd),
            ].join('\n'),
          ),
        )
      }
    }

    if (reachable) {
      if (autoStart) {
        throw cacheStartupFailure(
          key,
          new Error(
            [
              `Refusing to reuse an already-running local Convex backend at ${explicitUrl}.`,
              '- auto-start mode cannot prove which source graph that external process deployed.',
              '- stop the existing backend so this harness can own a fresh dev process, or explicitly set CONVEX_E2E_AUTO_START=false for manually managed local testing.',
            ].join('\n'),
          ),
        )
      }
      return {
        env: installResolvedLocalEnv(explicitUrl, explicitSiteUrl),
        release: async () => {},
      }
    }
  } else if (!autoStart) {
    throw cacheStartupFailure(key, new Error(buildLocalConvexSetupHelp(cwd)))
  }

  try {
    const handle = await startLocalConvex(
      cwd,
      timeoutMs,
      authOrigin,
      deploymentEnv,
      requireAuthDeployment,
      provisionSigningKey,
    )
    assertRequiredLocalUrls(cwd, handle.url, handle.siteUrl)
    return {
      env: installResolvedLocalEnv(handle.url, handle.siteUrl),
      release: retainLocalConvex(handle),
    }
  } catch (error) {
    throw cacheStartupFailure(
      key,
      [
        error instanceof Error ? error.message : String(error),
        '',
        buildLocalConvexSetupHelp(cwd),
      ].join('\n'),
    )
  }
}
