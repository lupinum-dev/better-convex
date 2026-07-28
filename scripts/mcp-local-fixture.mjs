import { spawn } from 'node:child_process'
import { randomBytes, randomInt } from 'node:crypto'
import { once } from 'node:events'
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertCurrentBackendBinary } from './check-auth-backend.mjs'
import { assertNoJwtShapedValue, redactEvidenceLog } from './mcp-auth-contracts.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const starter = join(root, 'starters/mcp-oauth-agent')
const convexCli = join(root, 'node_modules/convex/bin/main.js')
const nuxtCli = join(root, 'node_modules/nuxt/bin/nuxt.mjs')
const MAX_LOG_BYTES = 256 * 1024
const START_TIMEOUT_MS = 60_000

const copiedArtifactNames = new Set([
  '--port',
  '.convex',
  '.env.local',
  '.nuxt',
  '.output',
  'node_modules',
])

function cleanEnvironment() {
  const env = { ...process.env }
  for (const name of [
    'BCN_AUTH_PROXY_IP_SECRET',
    'BCN_AUTH_TRUSTED_CLIENT_IP_HEADER',
    'BCN_MCP_CONFORMANCE_BEARER',
    'BCN_MCP_RELEASE_TARBALL',
    'BCN_MCP_TEST_APP_DIR',
    'BCN_MCP_TEST_CONVEX_URL',
    'BCN_MCP_TEST_CONVEX_SITE_URL',
    'BCN_MCP_TEST_EMAIL',
    'BCN_MCP_TEST_MODE',
    'BCN_MCP_TEST_ORIGIN',
    'BCN_MCP_TEST_PASSWORD',
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_SECRETS',
    'MCP_SERVER_SECRET',
    'NUXT_PUBLIC_CONVEX_SITE_URL',
    'NUXT_PUBLIC_CONVEX_URL',
  ]) {
    delete env[name]
  }
  for (const name of Object.keys(env)) {
    if (name.toUpperCase().startsWith('CONVEX_')) delete env[name]
  }
  return env
}

function capture(child) {
  let value = ''
  const append = (chunk) => {
    value = (value + chunk.toString()).slice(-MAX_LOG_BYTES)
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  return () => value
}

function safeLog(value, secrets) {
  assertNoJwtShapedValue(value)
  return redactEvidenceLog(value, secrets).slice(-8_000)
}

async function availableRandomPort(excluded = new Set()) {
  // Fixed scan ranges make independent security gates select the same first
  // port before either process has time to bind it. Pick from a large,
  // non-ephemeral range so concurrent fixtures do not coordinate through a
  // shared source of truth. The bind check remains fail-closed; the spawned
  // service also treats a lost bind race as a hard fixture failure.
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const port = randomInt(12_000, 44_000)
    if (excluded.has(port)) continue
    const server = createServer()
    const available = await new Promise((ready) => {
      server.once('error', () => ready(false))
      server.listen(port, '127.0.0.1', () => ready(true))
    })
    if (!available) continue
    await new Promise((ready, reject) => server.close((error) => (error ? reject(error) : ready())))
    return port
  }
  throw new Error('No random loopback fixture port was available')
}

async function waitUntil(check, description, timeoutMs = START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await check()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await new Promise((ready) => setTimeout(ready, 100))
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError instanceof Error ? `: ${lastError.message}` : ''}`,
  )
}

function terminate(child, signal = 'SIGTERM') {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') child.kill(signal)
  else {
    try {
      process.kill(-child.pid, signal)
    } catch {
      child.kill(signal)
    }
  }
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  terminate(child)
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((ready) => setTimeout(() => ready(false), 3_000)),
  ])
  if (!exited) {
    terminate(child, 'SIGKILL')
    await once(child, 'exit').catch(() => {})
  }
}

async function ensureWorkspacePackageBuild() {
  await runCommand('pnpm', ['exec', 'nuxt-module-build', 'prepare'], {
    cwd: root,
    env: cleanEnvironment(),
    secrets: [],
  })
  await runCommand('pnpm', ['exec', 'nuxt-module-build', 'build'], {
    cwd: root,
    env: cleanEnvironment(),
    secrets: [],
  })
  await Promise.all([
    access(join(root, 'dist/module.mjs')),
    access(join(root, 'dist/runtime/convex-auth/component/convex.config.js')),
  ])
}

async function resolveReleaseTarball() {
  const value = process.env.BCN_RELEASE_TARBALL
  if (!value) return undefined
  const path = await realpath(resolve(root, value))
  const metadata = await stat(path)
  if (!metadata.isFile() || !path.endsWith('.tgz')) {
    throw new Error('BCN_RELEASE_TARBALL must reference one existing .tgz file')
  }
  return path
}

async function resolveMcpReleaseTarball() {
  const value = process.env.BCN_MCP_RELEASE_TARBALL
  if (!value) return undefined
  const path = await realpath(resolve(root, value))
  const metadata = await stat(path)
  if (!metadata.isFile() || !path.endsWith('.tgz')) {
    throw new Error('BCN_MCP_RELEASE_TARBALL must reference one existing .tgz file')
  }
  return path
}

async function linkDependencies(cwd, releaseTarball, mcpReleaseTarball) {
  const modules = join(cwd, 'node_modules')
  await mkdir(modules, { mode: 0o700 })
  const [productManifest, starterManifest] = await Promise.all(
    [join(root, 'package.json'), join(starter, 'package.json')].map(async (path) =>
      JSON.parse(await readFile(path, 'utf8')),
    ),
  )
  const dependencyNames = new Set()
  for (const dependencies of [
    productManifest.dependencies,
    productManifest.optionalDependencies,
    productManifest.peerDependencies,
    starterManifest.dependencies,
    starterManifest.devDependencies,
    starterManifest.optionalDependencies,
  ]) {
    for (const name of Object.keys(dependencies ?? {})) dependencyNames.add(name)
  }
  dependencyNames.delete('better-convex-nuxt')
  for (const name of [...dependencyNames].sort()) {
    if (!/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/iu.test(name)) {
      throw new Error('Invalid fixture dependency name')
    }
    if (name === '@better-convex/mcp' && mcpReleaseTarball) continue
    const source = join(root, 'node_modules', name)
    const destination = join(modules, name)
    const installedSource = await realpath(source)
    await mkdir(dirname(destination), { mode: 0o700, recursive: true })
    await symlink(installedSource, destination, 'dir')
  }
  const installedModule = join(modules, 'better-convex-nuxt')
  if (releaseTarball) {
    await mkdir(installedModule, { mode: 0o700 })
    await runCommand(
      'tar',
      ['-xzf', releaseTarball, '--strip-components=1', '-C', installedModule],
      { cwd, env: cleanEnvironment(), secrets: [] },
    )
    const manifest = JSON.parse(await readFile(join(installedModule, 'package.json'), 'utf8'))
    if (manifest.name !== 'better-convex-nuxt' || typeof manifest.version !== 'string') {
      throw new Error('BCN_RELEASE_TARBALL did not contain the expected package')
    }
  } else {
    await ensureWorkspacePackageBuild()
    await symlink(root, installedModule, 'dir')
  }
  if (mcpReleaseTarball) {
    const installedMcp = join(modules, '@better-convex/mcp')
    await mkdir(installedMcp, { mode: 0o700, recursive: true })
    await runCommand(
      'tar',
      ['-xzf', mcpReleaseTarball, '--strip-components=1', '-C', installedMcp],
      { cwd, env: cleanEnvironment(), secrets: [] },
    )
    const [installedManifest, sourceManifest] = await Promise.all(
      [join(installedMcp, 'package.json'), join(root, 'packages/mcp/package.json')].map((path) =>
        readFile(path, 'utf8').then(JSON.parse),
      ),
    )
    if (
      installedManifest.name !== '@better-convex/mcp' ||
      installedManifest.version !== sourceManifest.version ||
      installedManifest.dependencies?.['@modelcontextprotocol/server'] !==
        sourceManifest.dependencies?.['@modelcontextprotocol/server']
    ) {
      throw new Error('BCN_MCP_RELEASE_TARBALL did not contain the reviewed MCP package')
    }
  }
}

async function readFixtureEnvironment(cwd) {
  const source = await readFile(join(cwd, '.env.local'), 'utf8')
  return Object.fromEntries(
    source
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1).trim()]
      }),
  )
}

async function runCommand(command, args, { cwd, env, input, secrets }) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  })
  if (input !== undefined) child.stdin.end(`${input}\n`)
  const log = capture(child)
  const [code, signal] = await once(child, 'exit')
  if (code !== 0) {
    throw new Error(
      `Fixture command failed (${code ?? signal ?? 'unknown'}): ${safeLog(log(), secrets)}`,
    )
  }
  return log().trim()
}

function isEnvironmentOccConflict(error) {
  return (
    error instanceof Error &&
    /\b503\b/u.test(error.message) &&
    /\bOptimisticConcurrencyControlFailure\b/u.test(error.message)
  )
}

/**
 * Start a clean, reviewed local Convex deployment and the real MCP OAuth
 * starter. Every mutable/generated file lives below one disposable temp root.
 */
export async function startLocalMcpOAuthFixture(options = {}) {
  const reviewedBackend = await assertCurrentBackendBinary()
  const releaseTarball = await resolveReleaseTarball()
  const mcpReleaseTarball = await resolveMcpReleaseTarball()
  const tempRoot = await mkdtemp(join(tmpdir(), 'bcn-mcp-oauth-fixture-'))
  const cwd = join(tempRoot, 'app')
  let convex
  let nuxt
  let released = false
  const secretOverrides = options.secretOverridesForTest
  const trustedClientIpHeader = options.trustedClientIpHeaderForTest
  const nuxtMode = options.nuxtModeForTest ?? 'development'
  if (nuxtMode !== 'development' && nuxtMode !== 'production') {
    throw new Error('Invalid fixture Nuxt mode')
  }
  if (trustedClientIpHeader !== undefined) {
    try {
      if (
        trustedClientIpHeader !== trustedClientIpHeader.toLowerCase() ||
        trustedClientIpHeader.startsWith('x-bcn-')
      ) {
        throw new TypeError('invalid')
      }
      new Headers().set(trustedClientIpHeader, 'validation')
    } catch {
      throw new Error('Invalid trusted fixture client-IP header')
    }
  }
  if (secretOverrides !== undefined) {
    if (
      !secretOverrides ||
      typeof secretOverrides !== 'object' ||
      Array.isArray(secretOverrides) ||
      Object.keys(secretOverrides).sort().join(',') !== 'betterAuthSecrets,proxyIpSecret' ||
      [secretOverrides.betterAuthSecrets, secretOverrides.proxyIpSecret].some(
        (secret) =>
          typeof secret !== 'string' ||
          secret.length < 32 ||
          secret.length > 1_024 ||
          !/^[\x21-\x7E]+$/u.test(secret),
      )
    ) {
      throw new Error('Invalid fixture secret overrides')
    }
  }
  const suffix = randomBytes(8).toString('hex')
  const email = `mcp-gate-${suffix}@example.test`
  const password = `${randomBytes(24).toString('base64url')}!aA1`
  const betterAuthSecrets =
    secretOverrides?.betterAuthSecrets ?? `1:${randomBytes(32).toString('base64url')}`
  const proxyIpSecret = secretOverrides?.proxyIpSecret ?? randomBytes(32).toString('base64url')
  const secrets = [password, betterAuthSecrets, proxyIpSecret]
  const registerConfidentialClientSecretForRedaction = (secret) => {
    if (
      typeof secret !== 'string' ||
      secret.length < 16 ||
      secret.length > 512 ||
      !/^[\x21-\x7E]+$/u.test(secret)
    ) {
      throw new Error('Invalid confidential fixture secret')
    }
    if (!secrets.includes(secret)) secrets.push(secret)
  }

  const release = async () => {
    if (released) return
    released = true
    await Promise.all([stopProcess(nuxt), stopProcess(convex)])
    await rm(tempRoot, { force: true, recursive: true })
  }

  try {
    await cp(starter, cwd, {
      filter: (source) => source === starter || !copiedArtifactNames.has(basename(source)),
      recursive: true,
    })
    await linkDependencies(cwd, releaseTarball, mcpReleaseTarball)
    const installedClientIpModule = await import(
      pathToFileURL(join(cwd, 'node_modules/better-convex-nuxt/dist/runtime/shared/client-ip.js'))
        .href
    )
    if (
      typeof installedClientIpModule.normalizeClientIp !== 'function' ||
      typeof installedClientIpModule.signClientIp !== 'function'
    ) {
      throw new TypeError('Installed BCN package does not expose the reviewed client-IP signer')
    }
    const signedClientIpHeadersForTest = async (ip) => {
      const canonicalIp = installedClientIpModule.normalizeClientIp(ip)
      if (!canonicalIp) throw new Error('Invalid fixture client IP')
      return Object.freeze({
        'x-bcn-client-ip': canonicalIp,
        'x-bcn-client-ip-signature': await installedClientIpModule.signClientIp(
          canonicalIp,
          proxyIpSecret,
        ),
      })
    }
    await options.prepareFixture?.({ cwd })

    const selectedPorts = new Set()
    const cloudPort = await availableRandomPort(selectedPorts)
    selectedPorts.add(cloudPort)
    const sitePort = await availableRandomPort(selectedPorts)
    selectedPorts.add(sitePort)
    const appPort = await availableRandomPort(selectedPorts)
    const convexUrl = `http://127.0.0.1:${cloudPort}`
    const convexSiteUrl = `http://127.0.0.1:${sitePort}`
    const origin = `http://127.0.0.1:${appPort}`
    const baseEnv = {
      ...cleanEnvironment(),
      CONVEX_AGENT_MODE: 'anonymous',
      CONVEX_ALLOW_ANONYMOUS: 'true',
    }

    convex = spawn(
      process.execPath,
      [
        '--',
        convexCli,
        'dev',
        '--local-backend-version',
        reviewedBackend.version,
        '--local-cloud-port',
        String(cloudPort),
        '--local-site-port',
        String(sitePort),
        '--tail-logs',
        'disable',
        '--typecheck',
        'disable',
      ],
      {
        cwd,
        detached: process.platform !== 'win32',
        env: baseEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const convexLog = capture(convex)
    await waitUntil(async () => {
      if (convex.exitCode !== null) {
        throw new Error(`Convex exited early: ${safeLog(convexLog(), secrets)}`)
      }
      const env = await readFixtureEnvironment(cwd).catch(() => undefined)
      if (env?.CONVEX_URL !== convexUrl || env?.CONVEX_SITE_URL !== convexSiteUrl) return false
      return fetch(`${convexUrl}/version`).then((response) => response.status < 500)
    }, 'reviewed local Convex backend')

    const cliEnv = { ...baseEnv }
    const runCli = (args, input) =>
      runCommand(process.execPath, ['--', convexCli, ...args, '--env-file', '.env.local'], {
        cwd,
        env: cliEnv,
        input,
        secrets,
      })
    const setFixtureEnvironment = async (name, value) => {
      const maxAttempts = 4
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          await runCli(['env', 'set', name], value)
          return
        } catch (error) {
          if (!isEnvironmentOccConflict(error) || attempt === maxAttempts) throw error
          await new Promise((ready) => setTimeout(ready, attempt * 100))
        }
      }
    }
    for (const [name, value] of [
      ['SITE_URL', origin],
      ['BETTER_AUTH_SECRETS', betterAuthSecrets],
      ['BCN_AUTH_PROXY_IP_SECRET', proxyIpSecret],
    ]) {
      await setFixtureEnvironment(name, value)
    }
    await waitUntil(() => {
      if (convex.exitCode !== null) {
        throw new Error(`Convex exited before deployment: ${safeLog(convexLog(), secrets)}`)
      }
      return convexLog().includes('Convex functions ready!')
    }, 'MCP OAuth Convex function deployment')
    await runCli(['run', 'auth:rotateSigningKey', '{}'])

    const nuxtEnvironment = {
      ...baseEnv,
      BCN_AUTH_PROXY_IP_SECRET: proxyIpSecret,
      ...(trustedClientIpHeader
        ? { BCN_AUTH_TRUSTED_CLIENT_IP_HEADER: trustedClientIpHeader }
        : {}),
      CONVEX_SITE_URL: convexSiteUrl,
      CONVEX_URL: convexUrl,
      HOST: '127.0.0.1',
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: String(appPort),
      NUXT_HOST: '127.0.0.1',
      NUXT_PORT: String(appPort),
      NUXT_PUBLIC_CONVEX_SITE_URL: convexSiteUrl,
      NUXT_PUBLIC_CONVEX_URL: convexUrl,
      PORT: String(appPort),
      SITE_URL: origin,
    }
    if (nuxtMode === 'production') {
      await runCommand(process.execPath, [nuxtCli, 'build'], {
        cwd,
        env: { ...nuxtEnvironment, NODE_ENV: 'production' },
        secrets,
      })
    }
    const nuxtEntry = nuxtMode === 'production' ? join(cwd, '.output/server/index.mjs') : nuxtCli
    const nuxtArguments = nuxtMode === 'production' ? [] : ['dev']
    nuxt = spawn(process.execPath, [nuxtEntry, ...nuxtArguments], {
      cwd,
      detached: process.platform !== 'win32',
      env: {
        ...nuxtEnvironment,
        ...(nuxtMode === 'production' ? { NODE_ENV: 'production' } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const nuxtLog = capture(nuxt)
    try {
      await waitUntil(async () => {
        if (nuxt.exitCode !== null)
          throw new Error(`Nuxt exited early: ${safeLog(nuxtLog(), secrets)}`)
        return fetch(origin, { redirect: 'manual' }).then((response) => response.status === 200)
      }, 'Nuxt MCP OAuth fixture')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Nuxt MCP OAuth fixture failed'
      throw new Error(`${message}; Nuxt output: ${safeLog(nuxtLog(), secrets)}`, { cause: error })
    }

    const signup = await fetch(`${origin}/api/auth/sign-up/email`, {
      body: JSON.stringify({ email, name: 'MCP Gate', password }),
      headers: {
        'content-type': 'application/json',
        origin,
        ...(trustedClientIpHeader ? { [trustedClientIpHeader]: '127.0.0.1' } : {}),
      },
      method: 'POST',
      redirect: 'manual',
    })
    await signup.body?.cancel().catch(() => {})
    if (signup.status !== 200) throw new Error(`Fixture user creation failed with ${signup.status}`)
    await runCli([
      'run',
      'mcpAdmin:setOAuthAdministratorByEmail',
      JSON.stringify({ email, enabled: true }),
    ])

    const runConvex = async (functionName, args = {}) => {
      if (!/^[\w./-]+:\w+$/u.test(functionName)) {
        throw new Error('Invalid fixture Convex function name')
      }
      const output = await runCli(['run', functionName, JSON.stringify(args)])
      try {
        return JSON.parse(output)
      } catch {
        return output
      }
    }

    const retireCurrentAuthSecretForTest = async () => {
      const replacement = `2:${randomBytes(32).toString('base64url')}`
      secrets.push(replacement)
      await setFixtureEnvironment('BETTER_AUTH_SECRETS', replacement)
    }

    const readOAuthCredentialCountsForTest = async () => {
      const counts = await runConvex('mcpOAuthEvidence:countCredentialRows')
      if (
        !counts ||
        typeof counts !== 'object' ||
        Object.keys(counts).sort().join(',') !== 'accessTokens,idTokens,refreshTokens' ||
        [counts.accessTokens, counts.idTokens, counts.refreshTokens].some(
          (count) => !Number.isSafeInteger(count) || count < 0 || count > 100,
        )
      ) {
        throw new Error('Invalid OAuth credential count evidence')
      }
      return Object.freeze({ ...counts })
    }

    return Object.freeze({
      convexSiteUrl,
      convexUrl,
      cwd,
      email,
      origin,
      password,
      nuxtMode,
      readOAuthCredentialCountsForTest,
      registerConfidentialClientSecretForRedaction,
      release,
      retireCurrentAuthSecretForTest,
      runConvex,
      signedClientIpHeadersForTest,
    })
  } catch (error) {
    await release()
    throw error
  }
}
