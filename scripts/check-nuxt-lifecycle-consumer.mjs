#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { chromium } from 'playwright'

import { inspectConsumerCandidate } from './package-consumer-candidate.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const fixtureRoot = join(repositoryRoot, 'test/fixtures/nuxt-lifecycle')
const browserRuntimeFixture = join(repositoryRoot, 'test/fixtures/browser-runtime')

function parseArguments(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]
    if (!['--nuxt-tarball', '--vue-tarball'].includes(name) || values.has(name)) {
      throw new Error(
        'Usage: check-nuxt-lifecycle-consumer.mjs --nuxt-tarball <path> --vue-tarball <path>',
      )
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`)
    values.set(name, resolve(repositoryRoot, value))
    index += 1
  }
  if (values.size !== 2) {
    throw new Error(
      'Usage: check-nuxt-lifecycle-consumer.mjs --nuxt-tarball <path> --vue-tarball <path>',
    )
  }
  return Object.freeze({
    nuxtTarball: values.get('--nuxt-tarball'),
    vueTarball: values.get('--vue-tarball'),
  })
}

function run(command, args, cwd, env = process.env) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    stdio: 'inherit',
  })
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolvePromise) => server.close(resolvePromise))
  if (!port) throw new Error('Failed to allocate a production Nitro port')
  return port
}

async function waitForServer(origin, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Production Nitro exited with ${child.exitCode}`)
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok) return await response.text()
    } catch {
      // Nitro is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 75))
  }
  throw new Error('Timed out waiting for the production Nuxt lifecycle consumer')
}

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const stopped = await Promise.race([
    new Promise((resolvePromise) => child.once('exit', () => resolvePromise(true))),
    new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), 3_000)),
  ])
  if (!stopped) {
    child.kill('SIGKILL')
    if (child.exitCode === null)
      await new Promise((resolvePromise) => child.once('exit', resolvePromise))
  }
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} expected ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}`,
    )
  }
}

function boundedBrowserDiagnostics(values) {
  return values.slice(-8).map((value) => value.slice(-1_000))
}

function productionJavaScript(outputDirectory) {
  const publicDirectory = join(outputDirectory, 'public')
  const files = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && /\.(?:js|mjs)$/u.test(entry.name)) files.push(path)
    }
  }
  visit(publicDirectory)
  return files.map((path) => readFileSync(path, 'utf8')).join('\n')
}

const options = parseArguments(process.argv.slice(2))
const scratchRoot = mkdtempSync(join(tmpdir(), 'better-convex-nuxt-lifecycle-'))
const consumerRoot = join(scratchRoot, 'consumer')
let browser
let server
let nuxtCandidate
let vueCandidate

try {
  nuxtCandidate = inspectConsumerCandidate({
    packageId: 'nuxt',
    packageName: 'better-convex-nuxt',
    tarballPath: options.nuxtTarball,
  })
  vueCandidate = inspectConsumerCandidate({
    packageId: 'vue',
    packageName: 'better-convex-vue',
    tarballPath: options.vueTarball,
  })
  if (
    nuxtCandidate.manifest.dependencies?.['better-convex-vue'] !== vueCandidate.manifest.version
  ) {
    throw new Error('Nuxt candidate does not depend on the exact supplied Vue candidate version')
  }

  cpSync(fixtureRoot, consumerRoot, { recursive: true })
  cpSync(browserRuntimeFixture, join(scratchRoot, 'browser-runtime'), {
    recursive: true,
  })
  cpSync(options.nuxtTarball, join(consumerRoot, 'better-convex-nuxt.tgz'))
  cpSync(options.vueTarball, join(consumerRoot, 'better-convex-vue.tgz'))
  run('pnpm', ['install', '--no-frozen-lockfile', '--ignore-scripts'], consumerRoot)
  run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], consumerRoot)
  symlinkSync(join(consumerRoot, 'node_modules'), join(scratchRoot, 'node_modules'), 'dir')

  const lock = readFileSync(join(consumerRoot, 'pnpm-lock.yaml'), 'utf8')
  for (const filename of ['better-convex-nuxt.tgz', 'better-convex-vue.tgz']) {
    if (!lock.includes(filename)) throw new Error(`Lifecycle consumer lock omits ${filename}`)
  }
  nuxtCandidate.assertInstalled(join(consumerRoot, 'node_modules/better-convex-nuxt'))
  vueCandidate.assertInstalled(join(consumerRoot, 'node_modules/better-convex-vue'))

  run('pnpm', ['run', 'typecheck'], consumerRoot)
  run('pnpm', ['run', 'build'], consumerRoot, {
    ...process.env,
    NODE_ENV: 'production',
    NUXT_TELEMETRY_DISABLED: '1',
  })
  const outputDirectory = join(consumerRoot, '.output')
  const publicCode = productionJavaScript(outputDirectory)
  for (const forbidden of [
    'src/runtime/client-core',
    'packages/vue/src',
    'better-convex-vue-authenticated-consumer',
  ]) {
    if (publicCode.includes(forbidden)) {
      throw new Error(`Production Nuxt lifecycle bundle contains forbidden marker: ${forbidden}`)
    }
  }

  const port = await availablePort()
  const origin = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, [join(outputDirectory, 'server/index.mjs')], {
    cwd: consumerRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: String(port),
      NODE_ENV: 'production',
      PORT: String(port),
    },
    stdio: 'ignore',
  })
  const html = await waitForServer(origin, server)
  if (!html.includes('better-convex-nuxt-lifecycle')) {
    throw new Error('Production SSR output omitted the lifecycle consumer root')
  }

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const pageErrors = []
  const consoleMessages = []
  const consoleErrors = []
  const failedRequests = []
  const failedResponses = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    consoleMessages.push(`[${message.type()}] ${message.text()}`)
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`)
  })
  await page.goto(origin, { waitUntil: 'networkidle' })
  try {
    await page.waitForFunction(() => Boolean(window.__betterConvexNuxtLifecycle))
  } catch (error) {
    throw new Error(
      `Lifecycle probe did not mount: ${JSON.stringify({
        consoleMessages: boundedBrowserDiagnostics(consoleMessages),
        consoleErrors: boundedBrowserDiagnostics(consoleErrors),
        failedRequests: boundedBrowserDiagnostics(failedRequests),
        failedResponses: boundedBrowserDiagnostics(failedResponses),
        html: (await page.content()).slice(-4_000),
        pageErrors: boundedBrowserDiagnostics(pageErrors),
      })}`,
      { cause: error },
    )
  }

  const invoke = (method, ...args) =>
    page.evaluate(
      ({ methodName, methodArgs }) => window.__betterConvexNuxtLifecycle[methodName](...methodArgs),
      { methodName: method, methodArgs: args },
    )
  const attachment = await invoke('attachment')
  assertDeepEqual(attachment.frozen, true, 'Frozen Nuxt host attachment')
  assertDeepEqual(
    attachment.runtimeKeys,
    ['anonymousClient', 'client', 'connection', 'identity'],
    'Nuxt host attachment allowlist',
  )
  assertDeepEqual(
    attachment.clientKeys,
    ['action', 'mutation', 'onUpdate', 'query'],
    'Nuxt host client allowlist',
  )
  assertDeepEqual(
    attachment.anonymousClientKeys,
    ['action', 'mutation', 'onUpdate', 'query'],
    'Nuxt host anonymous client allowlist',
  )
  assertDeepEqual(
    attachment.identityKeys,
    ['snapshot', 'subscribe', 'waitForInitialSettlement'],
    'Nuxt host identity observer allowlist',
  )
  assertDeepEqual(
    attachment.identitySnapshotKeys,
    ['authEnabled', 'error', 'identityGeneration', 'identityKey', 'settled'],
    'Nuxt host identity snapshot allowlist',
  )
  assertDeepEqual(
    attachment.identity,
    {
      authEnabled: false,
      settled: true,
      identityKey: 'anonymous',
      identityGeneration: 0,
      error: null,
    },
    'Nuxt host identity snapshot',
  )
  if (/token|cookie|authorization|secret|credential/iu.test(JSON.stringify(attachment))) {
    throw new Error('Nuxt host attachment inspection exposed a credential-shaped field')
  }
  let snapshot = await invoke('snapshot')
  assertDeepEqual(snapshot.query.data, [], 'Initial query data')
  assertDeepEqual(snapshot.pagination.results, [], 'Initial pagination data')

  snapshot = await invoke('emitQuery', [{ id: 'query-a' }])
  assertDeepEqual(snapshot.query.data, [{ id: 'query-a' }], 'Live query data')
  snapshot = await invoke('emitPage', null, {
    page: [{ id: 'page-a' }],
    continueCursor: 'cursor-empty',
    isDone: false,
  })
  assertDeepEqual(snapshot.pagination.results, [{ id: 'page-a' }], 'First live page')
  await invoke('loadMore', 1)
  snapshot = await invoke('emitPage', 'cursor-empty', {
    page: [],
    continueCursor: 'cursor-tail',
    isDone: false,
  })
  assertDeepEqual(snapshot.pagination.results, [{ id: 'page-a' }], 'Empty continuation page')
  await invoke('loadMore', 1)
  snapshot = await invoke('emitPage', 'cursor-tail', {
    page: [{ id: 'page-b' }],
    continueCursor: '',
    isDone: true,
  })
  assertDeepEqual(
    snapshot.pagination.results,
    [{ id: 'page-a' }, { id: 'page-b' }],
    'Pagination cursor chain',
  )

  const beforeArgumentChange = await invoke('subscriptions')
  snapshot = await invoke('setOwner', 'bob')
  assertDeepEqual(snapshot.query.data, null, 'Query retirement after argument change')
  assertDeepEqual(snapshot.pagination.results, [], 'Pagination retirement after argument change')
  const afterArgumentChange = await invoke('subscriptions')
  const priorIds = new Set(beforeArgumentChange.map((entry) => entry.id))
  if (afterArgumentChange.some((entry) => priorIds.has(entry.id) && entry.active)) {
    throw new Error('Argument change retained a prior Nuxt subscription')
  }
  snapshot = await invoke('failQuery', 'Fixture query failure')
  assertDeepEqual(snapshot.query.error.kind, 'unknown', 'Query error classification')

  assertDeepEqual(
    await invoke('runMutation', 'write'),
    { operation: 'mutation', value: 'write' },
    'Mutation result',
  )
  assertDeepEqual(
    await invoke('runAction', 'work'),
    { operation: 'action', value: 'work' },
    'Action result',
  )
  let safe = await invoke('safeMutation', 'plain', 'Fixture mutation failure')
  assertDeepEqual(safe.ok, false, 'Plain safe mutation')
  assertDeepEqual(safe.error.kind, 'unknown', 'Plain safe mutation classification')
  safe = await invoke('safeMutation', 'application', 'ignored')
  assertDeepEqual(safe.ok, false, 'Application safe mutation')
  assertDeepEqual(safe.error.kind, 'server', 'Application safe mutation classification')
  assertDeepEqual(
    safe.error.data,
    { code: 'FIXTURE_DENIED', reason: 'fixture-policy' },
    'Application error data',
  )

  const disposed = await invoke('unmount')
  if (disposed.activeSubscriptions !== 0) {
    throw new Error(`Nuxt lifecycle consumer leaked subscriptions: ${JSON.stringify(disposed)}`)
  }
  await page.locator('[data-disposed]').waitFor()
  if (pageErrors.length || consoleErrors.length || failedRequests.length) {
    throw new Error(
      `Production browser errors: ${JSON.stringify({ pageErrors, consoleErrors, failedRequests })}`,
    )
  }

  console.log('Exact-package production Nuxt lifecycle consumer passed.')
} finally {
  await browser?.close()
  await stop(server)
  nuxtCandidate?.cleanup()
  vueCandidate?.cleanup()
  rmSync(scratchRoot, { force: true, recursive: true })
}
