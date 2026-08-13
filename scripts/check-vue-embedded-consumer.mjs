#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'

import { chromium } from 'playwright'

import { prepareVueCandidate } from './vue-candidate-consumer.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const fixtureRoot = join(repositoryRoot, 'test/fixtures/vue-embedded')
const scratchRoot = mkdtempSync(join(tmpdir(), 'better-convex-vue-embedded-'))
const hostRoot = join(scratchRoot, 'host')
const embeddedRoot = join(scratchRoot, 'embedded')
const secretSentinel = `embedded-secret-${randomUUID()}`

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'inherit',
  })
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} expected ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}`,
    )
  }
}

function assertNoRetiredIdentityFields(installedRoot) {
  const distRoot = join(installedRoot, 'dist')
  const declarations = readdirSync(distRoot, { recursive: true }).filter((path) =>
    /\.d\.[cm]?ts$/u.test(path),
  )
  if (declarations.length === 0) throw new Error('Packed Vue package emitted no declarations')
  for (const declaration of declarations) {
    if (readFileSync(join(distRoot, declaration), 'utf8').includes('authEpoch')) {
      throw new Error(`Packed Vue declaration retains authEpoch: ${declaration}`)
    }
  }
}

function contentType(pathname) {
  return extname(pathname) === '.mjs'
    ? 'text/javascript; charset=utf-8'
    : 'text/html; charset=utf-8'
}

function startServer() {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname === '/') {
      response.writeHead(200, { 'content-type': contentType(pathname) })
      response.end('<!doctype html><div id="embedded-app"></div>')
      return
    }
    const match = pathname.match(/^\/(host|embedded)\/(.+)$/)
    if (!match) {
      response.writeHead(404).end()
      return
    }
    const root =
      match[1] === 'host' ? join(hostRoot, 'dist-host') : join(embeddedRoot, 'dist-embedded')
    try {
      const bytes = readFileSync(join(root, match[2]))
      response.writeHead(200, { 'content-type': contentType(match[2]) })
      response.end(bytes)
    } catch {
      response.writeHead(404).end()
    }
  })
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Embedded proof server did not bind a TCP port'))
        return
      }
      resolvePromise({ server, url: `http://127.0.0.1:${address.port}` })
    })
  })
}

let browser = null
let server = null
let candidate
try {
  candidate = prepareVueCandidate(process.argv.slice(2), scratchRoot)

  for (const consumerRoot of [hostRoot, embeddedRoot]) {
    cpSync(fixtureRoot, consumerRoot, { recursive: true })
    cpSync(candidate.tarballPath, join(consumerRoot, 'better-convex-vue.tgz'))
    run(
      'pnpm',
      ['install', '--frozen-lockfile=false', '--ignore-scripts', '--strict-peer-dependencies'],
      consumerRoot,
    )
    const installed = JSON.parse(
      readFileSync(
        join(consumerRoot, 'node_modules/@lupinum/better-convex-vue/package.json'),
        'utf8',
      ),
    )
    if (installed.version !== candidate.version) {
      throw new Error(`Unexpected installed Vue package version: ${String(installed.version)}`)
    }
    const installedRoot = join(consumerRoot, 'node_modules/@lupinum/better-convex-vue')
    candidate.assertInstalled(installedRoot)
    assertNoRetiredIdentityFields(installedRoot)
  }

  run('pnpm', ['run', 'typecheck'], hostRoot)
  run('pnpm', ['run', 'typecheck'], embeddedRoot)
  run('pnpm', ['run', 'build:host'], hostRoot)
  run('pnpm', ['run', 'build:embedded'], embeddedRoot)

  const hostBundle = readFileSync(join(hostRoot, 'dist-host/host.mjs'), 'utf8')
  const embeddedBundle = readFileSync(join(embeddedRoot, 'dist-embedded/embedded.mjs'), 'utf8')
  for (const [name, bytes] of [
    ['host', hostBundle],
    ['embedded', embeddedBundle],
  ]) {
    for (const marker of [
      secretSentinel,
      'better-auth',
      '@better-auth/',
      '@nuxt/',
      '#imports',
      'from"h3"',
      'from"nitropack"',
    ]) {
      if (bytes.includes(marker))
        throw new Error(`${name} bundle contains forbidden marker: ${marker}`)
    }
  }

  const started = await startServer()
  server = started.server
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(started.url)
  const report = await page.evaluate(async (secret) => {
    await import('/host/host.mjs')
    const host = window.__betterConvexEmbeddedHost
    if (!host) throw new Error('Host bundle did not install its proof boundary')
    host.initialize(secret)
    await import('/embedded/embedded.mjs')
    const embedded = window.__betterConvexEmbeddedConsumer
    if (!embedded) throw new Error('Embedded bundle did not install its proof boundary')
    const hostSnapshot = host.snapshot()
    const attachmentKeys = Object.keys(host.attachment()).sort()
    const clientKeys = Object.keys(host.attachment().client).sort()
    const distinctVueCopies = host.vueIdentity !== embedded.vueIdentity
    const attached = embedded.attach()
    const listenersAfterAttach = host.listenerCount()
    const connectionListenersAfterAttach = host.connectionListenerCount()
    const clientStatsAfterAttach = host.clientStats()
    host.emitConnection(true)
    await new Promise((resolvePromise) => requestAnimationFrame(resolvePromise))
    const afterConnection = embedded.snapshot()
    host.emit({
      authEnabled: true,
      settled: true,
      identityKey: 'user:alice',
      identityGeneration: 1,
      error: null,
    })
    await new Promise((resolvePromise) => requestAnimationFrame(resolvePromise))
    const afterAuthentication = embedded.snapshot()
    const clientStatsAfterAuthentication = host.clientStats()
    host.emit({
      authEnabled: true,
      settled: true,
      identityKey: 'user:bob',
      identityGeneration: 2,
      error: null,
    })
    await new Promise((resolvePromise) => requestAnimationFrame(resolvePromise))
    const afterIdentityChange = embedded.snapshot()
    const clientStatsAfterIdentityChange = host.clientStats()
    const rendered = document.body.textContent
    const serializedAttachment = JSON.stringify(host.attachment())
    const afterUnmount = embedded.unmount()
    const listenersAfterUnmount = host.listenerCount()
    const connectionListenersAfterUnmount = host.connectionListenerCount()
    const detachCount = host.detachCount()
    const clientStatsAfterUnmount = host.clientStats()
    const ownerControlCallsAfterUnmount = host.ownerControlCalls()
    host.emit({
      authEnabled: true,
      settled: true,
      identityKey: 'anonymous',
      identityGeneration: 3,
      error: null,
    })
    host.emitConnection(false)
    const afterLateHostChange = embedded.snapshot()
    const remounted = embedded.attach()
    const listenersAfterRemount = host.listenerCount()
    const connectionListenersAfterRemount = host.connectionListenerCount()
    const secondUnmount = embedded.unmount()
    return {
      distinctVueCopies,
      attachmentKeys,
      clientKeys,
      identityKeys: Object.keys(hostSnapshot).sort(),
      projectedCause: hostSnapshot.error?.cause,
      attached,
      embeddedClientKeys: embedded.clientKeys(),
      listenersAfterAttach,
      connectionListenersAfterAttach,
      clientStatsAfterAttach,
      afterConnection,
      afterAuthentication,
      clientStatsAfterAuthentication,
      afterIdentityChange,
      clientStatsAfterIdentityChange,
      rendered,
      serializedAttachment,
      afterUnmount,
      listenersAfterUnmount,
      connectionListenersAfterUnmount,
      detachCount,
      clientStatsAfterUnmount,
      ownerControlCallsAfterUnmount,
      afterLateHostChange,
      remounted,
      listenersAfterRemount,
      connectionListenersAfterRemount,
      secondUnmount,
      listenersAfterSecondUnmount: host.listenerCount(),
      connectionListenersAfterSecondUnmount: host.connectionListenerCount(),
      detachCountAfterSecondUnmount: host.detachCount(),
      ownerControlCallsAfterSecondUnmount: host.ownerControlCalls(),
    }
  }, secretSentinel)

  assertDeepEqual(report.distinctVueCopies, true, 'Separate Vue copies')
  assertDeepEqual(
    report.attachmentKeys,
    ['anonymousClient', 'client', 'connection', 'identity'],
    'Attachment fields',
  )
  assertDeepEqual(
    report.clientKeys,
    ['action', 'mutation', 'onUpdate', 'query'],
    'Host projected client',
  )
  assertDeepEqual(report.embeddedClientKeys, report.clientKeys, 'Embedded stable client')
  assertDeepEqual(
    report.identityKeys,
    ['authEnabled', 'error', 'identityGeneration', 'identityKey', 'settled'],
    'Projected identity fields',
  )
  assertDeepEqual(report.projectedCause, undefined, 'Projected error cause')
  assertDeepEqual(report.listenersAfterAttach, 1, 'Host listener after attach')
  assertDeepEqual(report.connectionListenersAfterAttach, 1, 'Host connection listener after attach')
  assertDeepEqual(report.afterConnection.connected, true, 'Cross-copy connection observation')
  assertDeepEqual(
    report.clientStatsAfterAttach,
    { created: 0, active: 0, stopped: 0 },
    'Errored identity gate',
  )
  assertDeepEqual(report.afterAuthentication.queryStatus, 'pending', 'Authenticated query state')
  assertDeepEqual(
    report.clientStatsAfterAuthentication,
    { created: 1, active: 1, stopped: 0 },
    'Authenticated subscription',
  )
  assertDeepEqual(report.afterIdentityChange.queryData, null, 'Identity-change result retirement')
  assertDeepEqual(report.afterIdentityChange.queryStatus, 'pending', 'Identity-change query state')
  assertDeepEqual(
    report.clientStatsAfterIdentityChange,
    { created: 2, active: 1, stopped: 1 },
    'Cross-copy identity resubscription',
  )
  assertDeepEqual(report.listenersAfterUnmount, 0, 'Host listeners after unmount')
  assertDeepEqual(
    report.connectionListenersAfterUnmount,
    0,
    'Host connection listeners after unmount',
  )
  assertDeepEqual(report.detachCount, 1, 'Exactly-once host detach')
  assertDeepEqual(
    report.clientStatsAfterUnmount,
    { created: 2, active: 0, stopped: 2 },
    'Embedded query disposal',
  )
  assertDeepEqual(
    report.ownerControlCallsAfterUnmount,
    { close: 0, dispose: 0, setAuth: 0 },
    'Child unmount host ownership',
  )
  assertDeepEqual(report.afterLateHostChange.queryStatus, 'idle', 'Disposed state isolation')
  assertDeepEqual(report.listenersAfterRemount, 1, 'Host listener after child remount')
  assertDeepEqual(
    report.connectionListenersAfterRemount,
    1,
    'Host connection listener after child remount',
  )
  assertDeepEqual(report.listenersAfterSecondUnmount, 0, 'Host listeners after second unmount')
  assertDeepEqual(
    report.connectionListenersAfterSecondUnmount,
    0,
    'Host connection listeners after second unmount',
  )
  assertDeepEqual(report.detachCountAfterSecondUnmount, 2, 'Exactly-once detach after remount')
  assertDeepEqual(
    report.ownerControlCallsAfterSecondUnmount,
    { close: 0, dispose: 0, setAuth: 0 },
    'Remounted child host ownership',
  )

  for (const [label, value] of [
    ['attachment', report.serializedAttachment],
    ['rendered DOM', report.rendered],
    ['attached snapshot', JSON.stringify(report.attached)],
    ['post-change snapshot', JSON.stringify(report.afterIdentityChange)],
  ]) {
    if (String(value).includes(secretSentinel)) {
      throw new Error(`Embedded ${label} disclosed the secret sentinel`)
    }
  }

  console.log('Packed cross-Vue-copy embedded consumer passed.')
} finally {
  await browser?.close()
  if (server) await new Promise((resolvePromise) => server.close(resolvePromise))
  candidate?.cleanup()
  rmSync(scratchRoot, { recursive: true, force: true })
}
