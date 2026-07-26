#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { createJiti } from 'jiti'

import { assertCurrentBackendBinary } from './check-auth-backend.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const jiti = createJiti(import.meta.url, { interopDefault: false })
const codegenPaths = [
  'test/fixtures/better-auth-local-component/convex/_generated',
  'test/fixtures/better-auth-local-component/convex/betterAuth/_generated',
]
const excludedDirectoryNames = new Set([
  '.convex',
  '.git',
  '.nuxt',
  '.output',
  '.pnpm-store',
  '.release-artifacts',
  'coverage',
  'dist',
  'node_modules',
  'reports',
])
const bulkEvidence = {
  cleanup: makeFunctionReference('bulkEvidence:cleanup'),
  measure: makeFunctionReference('bulkEvidence:measure'),
  seed: makeFunctionReference('bulkEvidence:seed'),
}

function fail(message) {
  throw new Error(`[auth-schema] ${message}`)
}

function run(command, arguments_, cwd, env = process.env) {
  const result = spawnSync(command, arguments_, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().slice(-8_000)
    fail(`${command} ${arguments_.join(' ')} failed (${result.signal ?? result.status})\n${output}`)
  }
}

function output(command, arguments_, cwd, env = process.env) {
  const result = spawnSync(command, arguments_, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const commandOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().slice(-8_000)
    fail(
      `${command} ${arguments_.join(' ')} failed (${result.signal ?? result.status})\n${commandOutput}`,
    )
  }
  return result.stdout.trim()
}

function shouldCopy(source) {
  const relative = path.relative(root, source)
  if (!relative) return true
  const segments = relative.split(path.sep)
  if (segments.some((segment) => excludedDirectoryNames.has(segment))) return false
  const basename = segments.at(-1) ?? ''
  if (basename === '.env' || (basename.startsWith('.env.') && basename !== '.env.example')) {
    return false
  }
  return true
}

function snapshot(targetRoot, relativePath) {
  const target = path.join(targetRoot, relativePath)
  const files = new Map()
  if (!existsSync(target)) return files

  const visit = (filename) => {
    const metadata = statSync(filename)
    if (metadata.isDirectory()) {
      for (const entry of readdirSync(filename).sort()) visit(path.join(filename, entry))
      return
    }
    if (!metadata.isFile()) return
    const digest = createHash('sha256').update(readFileSync(filename)).digest('hex')
    files.set(path.relative(targetRoot, filename).split(path.sep).join('/'), digest)
  }
  visit(target)
  return files
}

function diffSnapshots(expected, actual) {
  const differences = []
  const names = new Set([...expected.keys(), ...actual.keys()])
  for (const name of [...names].sort()) {
    if (!expected.has(name)) differences.push(`unexpected ${name}`)
    else if (!actual.has(name)) differences.push(`missing ${name}`)
    else if (expected.get(name) !== actual.get(name)) differences.push(`changed ${name}`)
  }
  return differences
}

function assertPathsFresh(isolatedRoot, paths, label) {
  const differences = paths.flatMap((relativePath) =>
    diffSnapshots(snapshot(root, relativePath), snapshot(isolatedRoot, relativePath)),
  )
  if (differences.length > 0) {
    fail(`${label} is stale:\n${differences.map((item) => `- ${item}`).join('\n')}`)
  }
}

function clearConvexEnvironment() {
  for (const name of [
    'CONVEX_DEPLOYMENT',
    'CONVEX_SITE_URL',
    'CONVEX_URL',
    'NUXT_PUBLIC_CONVEX_SITE_URL',
    'NUXT_PUBLIC_CONVEX_URL',
  ]) {
    delete process.env[name]
  }
}

async function verifyBulkBudgetHeadroom(convexUrl) {
  const client = new ConvexHttpClient(convexUrl)
  for (let index = 0; index < 128; index += 1) {
    await client.mutation(bulkEvidence.seed, { index })
  }
  const result = await client.mutation(bulkEvidence.measure, {})
  if (!result || result.updated !== 128 || !result.metrics) {
    fail('deployed bulk-budget evidence returned an invalid result')
  }
  for (const name of [
    'bytesRead',
    'bytesWritten',
    'databaseQueries',
    'documentsRead',
    'documentsWritten',
  ]) {
    const metric = result.metrics[name]
    if (
      !metric ||
      !Number.isFinite(metric.used) ||
      !Number.isFinite(metric.remaining) ||
      metric.remaining <= metric.used * 10
    ) {
      fail(`deployed bulk-budget evidence lacks 10x headroom for ${name}`)
    }
  }
  const deleted = await client.mutation(bulkEvidence.cleanup, {})
  if (deleted !== 128) fail('deployed bulk-budget evidence cleanup was incomplete')
}

async function runRealCodegen(cwd, deploymentEnv = undefined, verifyBulkBudget = false) {
  const { ensureLocalConvex } = await jiti.import('../test/helpers/local-convex.ts')
  clearConvexEnvironment()
  process.env.BCN_E2E_REQUIRE_LOCAL = 'true'
  process.env.CONVEX_AGENT_MODE = 'anonymous'
  process.env.CONVEX_E2E_AUTO_START = 'true'
  const handle = await ensureLocalConvex({ cwd, deploymentEnv, timeoutMs: 90_000 })
  try {
    const siteUrl = handle.env.CONVEX_SITE_URL
    if (!siteUrl) fail(`local backend did not report a site URL for ${cwd}`)
    const statuses = []
    for (let index = 0; index < 4; index += 1) {
      const response = await fetch(`${siteUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3050',
        },
        body: JSON.stringify({
          email: 'schema-first-write@example.test',
          password: 'not-a-real-password',
        }),
      })
      statuses.push(response.status)
    }
    if (statuses.slice(0, 3).some((status) => status >= 500) || statuses[3] !== 429) {
      fail(`database-backed auth first-write proof failed for ${cwd}: ${statuses.join(', ')}`)
    }
    if (verifyBulkBudget) {
      const convexUrl = handle.env.CONVEX_URL
      if (!convexUrl) fail(`local backend did not report a Convex URL for ${cwd}`)
      await verifyBulkBudgetHeadroom(convexUrl)
    }
  } finally {
    await handle.release()
    clearConvexEnvironment()
  }
}

function resolveSchemaTarball(isolatedRoot, parent) {
  const supplied = process.env.BCN_RELEASE_TARBALL
  if (supplied) {
    if (!path.isAbsolute(supplied) || !existsSync(supplied)) {
      fail('BCN_RELEASE_TARBALL must be an existing absolute tarball path')
    }
    return supplied
  }

  const artifacts = path.join(parent, 'artifacts')
  mkdirSync(artifacts, { recursive: true })
  const packed = JSON.parse(
    output(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', artifacts],
      isolatedRoot,
    ),
  )
  if (!Array.isArray(packed) || packed.length !== 1) fail('schema gate pack was not singular')
  const tarball = path.join(artifacts, packed[0].filename)
  if (!existsSync(tarball)) fail(`schema gate tarball is missing: ${tarball}`)
  return tarball
}

function resolveSchemaVueTarball(isolatedRoot, parent) {
  const supplied = process.env.BCN_RELEASE_VUE_TARBALL
  if (supplied) {
    if (!path.isAbsolute(supplied) || !existsSync(supplied)) {
      fail('BCN_RELEASE_VUE_TARBALL must be an existing absolute tarball path')
    }
    return supplied
  }

  const packageRoot = path.join(isolatedRoot, 'packages/vue')
  run('pnpm', ['run', 'build'], packageRoot)
  const artifacts = path.join(parent, 'artifacts', 'vue')
  mkdirSync(artifacts, { recursive: true })
  const packed = JSON.parse(
    output(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', artifacts],
      packageRoot,
    ),
  )
  if (!Array.isArray(packed) || packed.length !== 1)
    fail('Vue schema companion pack was not singular')
  const tarball = path.join(artifacts, packed[0].filename)
  if (!existsSync(tarball)) fail(`Vue schema companion tarball is missing: ${tarball}`)
  return tarball
}

function preparePackagedDemo(isolatedRoot, parent, tarball, vueTarball) {
  const packaged = path.join(parent, 'packaged-demo')
  cpSync(path.join(isolatedRoot, 'demo'), packaged, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(path.join(isolatedRoot, 'demo'), source)
      return !relative
        .split(path.sep)
        .some((segment) => excludedDirectoryNames.has(segment) || segment === '.env.local')
    },
  })
  const localTarball = path.join(packaged, 'better-convex-nuxt.tgz')
  copyFileSync(tarball, localTarball)
  const localVueTarball = path.join(packaged, 'better-convex-vue.tgz')
  copyFileSync(vueTarball, localVueTarball)
  const manifestPath = path.join(packaged, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dependencies['better-convex-nuxt'] = 'file:./better-convex-nuxt.tgz'
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(
    path.join(packaged, 'pnpm-workspace.yaml'),
    "overrides:\n  'better-convex-vue': 'file:./better-convex-vue.tgz'\n",
  )
  run('pnpm', ['install', '--lockfile-only', '--no-frozen-lockfile', '--ignore-scripts'], packaged)
  run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], packaged)
  return packaged
}

async function main() {
  const unknown = process.argv.slice(2)
  if (unknown.length > 0) fail(`unknown argument ${JSON.stringify(unknown[0])}`)
  await assertCurrentBackendBinary()

  const parent = mkdtempSync(path.join(tmpdir(), 'bcn-auth-schema-'))
  const isolatedRoot = path.join(parent, 'repository')
  try {
    cpSync(root, isolatedRoot, { filter: shouldCopy, recursive: true })
    symlinkSync(path.join(root, 'node_modules'), path.join(isolatedRoot, 'node_modules'), 'dir')
    for (const consumer of ['playground', 'test/fixtures/better-auth-local-component']) {
      const modules = path.join(isolatedRoot, consumer, 'node_modules')
      mkdirSync(modules, { recursive: true })
      symlinkSync(isolatedRoot, path.join(modules, 'better-convex-nuxt'), 'dir')
    }

    run('pnpm', ['exec', 'jiti', 'scripts/generate-auth-schema.mjs', '--check'], isolatedRoot)

    run('pnpm', ['exec', 'nuxt-module-build', 'prepare'], isolatedRoot)
    run('pnpm', ['exec', 'nuxt-module-build', 'build'], isolatedRoot)
    const tarball = resolveSchemaTarball(isolatedRoot, parent)
    const vueTarball = resolveSchemaVueTarball(isolatedRoot, parent)
    const packagedDemo = preparePackagedDemo(isolatedRoot, parent, tarball, vueTarball)
    await runRealCodegen(packagedDemo, {
      GITHUB_CLIENT_ID: 'bcn-auth-schema-inert-github-client',
      GITHUB_CLIENT_SECRET: 'bcn-auth-schema-inert-github-secret',
    })
    await runRealCodegen(
      path.join(isolatedRoot, 'test/fixtures/better-auth-local-component'),
      undefined,
      true,
    )
    assertPathsFresh(isolatedRoot, codegenPaths, 'Convex codegen')
    const packagedDifferences = diffSnapshots(
      snapshot(path.join(root, 'demo/convex/_generated'), ''),
      snapshot(path.join(packagedDemo, 'convex/_generated'), ''),
    )
    if (packagedDifferences.length > 0) {
      fail(
        `packaged Convex codegen is stale:\n${packagedDifferences.map((item) => `- ${item}`).join('\n')}`,
      )
    }

    console.log(
      '[auth-schema] PASS: curated, Team, Agentic SaaS, local-fixture, and two-factor schema/metadata are deterministic; a clean tarball consumer and local component both deploy, perform database-backed first writes, preserve >10x transaction headroom at the 128-row bulk limit, and produce fresh codegen on the reviewed backend.',
    )
  } finally {
    clearConvexEnvironment()
    rmSync(parent, { force: true, recursive: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
