#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { chromium } from 'playwright'

import { prepareVueCandidate } from './vue-candidate-consumer.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const fixtureRoot = join(repositoryRoot, 'test/fixtures/vue-authenticated')
const browserRuntimeFixture = join(repositoryRoot, 'test/fixtures/browser-runtime')
const scratchRoot = mkdtempSync(join(tmpdir(), 'better-convex-vue-auth-'))
const consumerRoot = join(scratchRoot, 'consumer')
const tokenSentinel = `proof-${crypto.randomUUID()}`
const providerErrorSentinel = `provider-${crypto.randomUUID()}`

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'inherit',
  })
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolvePromise) => server.close(resolvePromise))
  if (!port) throw new Error('Failed to reserve a preview port')
  return port
}

async function waitForPreview(url, child) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite preview exited with ${child.exitCode}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  throw new Error('Timed out waiting for the authenticated Vue preview')
}

function assertSnapshot(snapshot, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (snapshot[key] !== value) {
      throw new Error(
        `Snapshot ${key} expected ${JSON.stringify(value)}; received ${JSON.stringify(snapshot[key])}`,
      )
    }
  }
  const serialized = JSON.stringify(snapshot)
  if (serialized.includes(tokenSentinel) || serialized.includes(providerErrorSentinel)) {
    throw new Error('Safe identity snapshot disclosed provider-private material')
  }
  if (Object.hasOwn(snapshot, 'token') || Object.hasOwn(snapshot, 'role')) {
    throw new Error('Safe identity snapshot gained credential or policy fields')
  }
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} expected ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}`,
    )
  }
}

let preview = null
let browser = null
let candidate
try {
  candidate = prepareVueCandidate(process.argv.slice(2), scratchRoot)

  cpSync(fixtureRoot, consumerRoot, { recursive: true })
  cpSync(browserRuntimeFixture, join(scratchRoot, 'browser-runtime'), {
    recursive: true,
  })
  cpSync(candidate.tarballPath, join(consumerRoot, 'better-convex-vue.tgz'))
  run(
    'pnpm',
    ['install', '--frozen-lockfile=false', '--ignore-scripts', '--strict-peer-dependencies'],
    consumerRoot,
  )
  symlinkSync(join(consumerRoot, 'node_modules'), join(scratchRoot, 'node_modules'), 'dir')
  candidate.assertInstalled(join(consumerRoot, 'node_modules/@lupinum/better-convex-vue'))
  run('pnpm', ['run', 'typecheck'], consumerRoot)
  run('pnpm', ['run', 'build'], consumerRoot)
  const assetsDirectory = join(consumerRoot, 'dist/assets')
  const bundleName = readdirSync(assetsDirectory).find(
    (name) => name.startsWith('index-') && name.endsWith('.js'),
  )
  if (!bundleName) throw new Error('Authenticated consumer emitted no JavaScript entry bundle')
  const bundleBytes = readFileSync(join(assetsDirectory, bundleName), 'utf8')
  for (const marker of [tokenSentinel, providerErrorSentinel, 'better-auth', '@better-auth/']) {
    if (bundleBytes.includes(marker)) {
      throw new Error(`Authenticated bundle contains forbidden marker: ${marker}`)
    }
  }

  const port = await reservePort()
  const url = `http://127.0.0.1:${port}`
  preview = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: consumerRoot,
      stdio: 'ignore',
    },
  )
  await waitForPreview(url, preview)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })

  const invoke = (method, ...args) =>
    page.evaluate(
      ({ methodName, methodArgs }) => window.__betterConvexAuthProof[methodName](...methodArgs),
      { methodName: method, methodArgs: args },
    )
  assertSnapshot(await invoke('snapshot'), {
    authEnabled: true,
    settled: false,
    identityKey: 'anonymous',
    identityGeneration: 0,
  })
  assertSnapshot(await invoke('transition', 'anonymous', null, 1), {
    settled: true,
    identityKey: 'anonymous',
    identityGeneration: 1,
  })

  let operations = await invoke('operationSnapshot')
  assertDeepEqual(
    operations.query,
    {
      data: undefined,
      status: 'pending',
      pending: true,
      error: null,
    },
    'Initial live query state',
  )
  assertDeepEqual(
    operations.pagination,
    {
      data: undefined,
      status: 'pending',
      loading: true,
      stale: false,
      canLoadMore: false,
      error: null,
    },
    'Initial pagination state',
  )

  operations = await invoke('emitQuery', [{ id: 'query-a' }])
  assertDeepEqual(operations.query.data, [{ id: 'query-a' }], 'Live query result')
  assertDeepEqual(operations.query.status, 'success', 'Live query status')

  operations = await invoke('emitPage', null, {
    page: [{ id: 'page-a' }],
    continueCursor: 'cursor-empty',
    isDone: false,
  })
  assertDeepEqual(operations.pagination.data, [{ id: 'page-a' }], 'First page')
  assertDeepEqual(operations.pagination.canLoadMore, true, 'First page continuation')
  await invoke('loadMore', 1)
  operations = await invoke('emitPage', 'cursor-empty', {
    page: [],
    continueCursor: 'cursor-tail',
    isDone: false,
  })
  assertDeepEqual(operations.pagination.data, [{ id: 'page-a' }], 'Empty continuation page')
  assertDeepEqual(operations.pagination.canLoadMore, true, 'Empty page continuation')
  await invoke('loadMore', 1)
  operations = await invoke('emitPage', 'cursor-tail', {
    page: [{ id: 'page-b' }],
    continueCursor: '',
    isDone: true,
  })
  assertDeepEqual(
    operations.pagination.data,
    [{ id: 'page-a' }, { id: 'page-b' }],
    'Pagination cursor chain',
  )
  assertDeepEqual(operations.pagination.status, 'success', 'Pagination exhaustion')
  assertDeepEqual(operations.pagination.canLoadMore, false, 'Exhausted continuation state')

  const subscriptionsBeforeArgsChange = await invoke('subscriptions')
  operations = await invoke('setOwner', 'bob')
  assertDeepEqual(operations.query.data, undefined, 'Query data after argument boundary')
  assertDeepEqual(operations.pagination.data, undefined, 'Pagination after argument boundary')
  const subscriptionsAfterArgsChange = await invoke('subscriptions')
  if (
    subscriptionsAfterArgsChange
      .filter((subscription) =>
        subscriptionsBeforeArgsChange.some((previous) => previous.id === subscription.id),
      )
      .some((subscription) => subscription.active)
  ) {
    throw new Error('Argument change left a prior subscription active')
  }
  operations = await invoke('failQuery', 'Fixture query failure')
  assertDeepEqual(operations.query.status, 'error', 'Query error status')
  assertDeepEqual(operations.query.error.kind, 'unknown', 'Query error classification')
  operations = await invoke('setOwner', 'bob-recovered')
  assertDeepEqual(operations.query.error, null, 'Query error recovery')
  operations = await invoke('emitQuery', [{ id: 'query-b' }])
  assertDeepEqual(operations.query.data, [{ id: 'query-b' }], 'Query after argument change')
  operations = await invoke('emitPage', null, {
    page: [{ id: 'page-bob' }],
    continueCursor: '',
    isDone: true,
  })
  assertDeepEqual(operations.pagination.data, [{ id: 'page-bob' }], 'Page after args change')

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
  let safeFailure = await invoke('safeMutation', 'plain', 'Fixture client failure')
  assertDeepEqual(safeFailure.ok, false, 'Plain error safe result')
  assertDeepEqual(safeFailure.error.kind, 'unknown', 'Plain error classification')
  safeFailure = await invoke('safeMutation', 'application', 'ignored')
  assertDeepEqual(safeFailure.ok, false, 'Application error safe result')
  assertDeepEqual(safeFailure.error.kind, 'server', 'Application error classification')
  assertDeepEqual(
    safeFailure.error.data,
    { code: 'FIXTURE_DENIED', reason: 'fixture-policy' },
    'Application error data',
  )

  operations = await invoke('startDeferredMutation')
  assertDeepEqual(operations.mutation.status, 'pending', 'Deferred mutation pending state')
  assertSnapshot(await invoke('transition', 'authenticated', 'alice', 2, tokenSentinel), {
    settled: true,
    identityKey: 'user:alice',
    identityGeneration: 2,
  })
  operations = await invoke('operationSnapshot')
  assertDeepEqual(operations.query.data, undefined, 'Query retirement across identity')
  assertDeepEqual(operations.pagination.data, undefined, 'Pagination retirement across identity')
  assertDeepEqual(operations.mutation.status, 'idle', 'Mutation retirement across identity')
  const retiredMutation = await invoke('finishDeferredMutation', 'should-not-commit')
  assertDeepEqual(retiredMutation.ok, false, 'Retired mutation completion')
  assertDeepEqual(retiredMutation.error.code, 'IDENTITY_CHANGED', 'Retired mutation code')
  const beforeProviderRefresh = await invoke('stats')
  assertSnapshot(await invoke('transition', 'authenticated', 'alice', 2, tokenSentinel), {
    settled: true,
    identityKey: 'user:alice',
    identityGeneration: 2,
  })
  const afterProviderRefresh = await invoke('stats')
  if (afterProviderRefresh.tokenFetches !== beforeProviderRefresh.tokenFetches) {
    throw new Error('Value-identical provider notification unexpectedly fetched a token')
  }
  assertSnapshot(await invoke('transition', 'authenticated', 'alice', 3, tokenSentinel), {
    settled: true,
    identityKey: 'user:alice',
    identityGeneration: 3,
  })
  assertSnapshot(await invoke('transition', 'authenticated', 'bob', 4, tokenSentinel), {
    settled: true,
    identityKey: 'user:bob',
    identityGeneration: 4,
  })
  assertSnapshot(await invoke('rejectCurrent'), {
    settled: true,
    identityKey: 'anonymous',
    identityGeneration: 5,
  })
  assertSnapshot(await invoke('transition', 'authenticated', 'carol', 6, tokenSentinel), {
    settled: true,
    identityKey: 'user:carol',
    identityGeneration: 6,
  })
  assertSnapshot(await invoke('transition', 'anonymous', null, 7), {
    settled: true,
    identityKey: 'anonymous',
    identityGeneration: 7,
  })
  assertSnapshot(await invoke('transition', 'error', null, 8, providerErrorSentinel), {
    settled: true,
    identityKey: 'anonymous',
    identityGeneration: 8,
  })

  const attachmentKeys = await invoke('attachmentKeys')
  if (
    JSON.stringify(attachmentKeys) !==
    JSON.stringify(['anonymousClient', 'client', 'connection', 'identity'])
  ) {
    throw new Error(`Unexpected attachment surface: ${JSON.stringify(attachmentKeys)}`)
  }
  const clientKeys = await invoke('clientKeys')
  if (JSON.stringify(clientKeys) !== JSON.stringify(['action', 'mutation', 'onUpdate', 'query'])) {
    throw new Error(`Stable client handle gained lifecycle controls: ${JSON.stringify(clientKeys)}`)
  }
  const body = await page.locator('body').textContent()
  if (body.includes(tokenSentinel) || body.includes(providerErrorSentinel)) {
    throw new Error('Credential or provider error entered rendered output')
  }
  const disposed = await invoke('unmount')
  if (disposed.listeners !== 0 || disposed.closed < 1) {
    throw new Error(`Authenticated consumer did not dispose cleanly: ${JSON.stringify(disposed)}`)
  }

  console.log('Authenticated packed Vue consumer passed.')
} finally {
  await browser?.close()
  if (preview && preview.exitCode === null) preview.kill('SIGTERM')
  candidate?.cleanup()
  rmSync(scratchRoot, { recursive: true, force: true })
}
