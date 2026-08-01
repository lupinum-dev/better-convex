#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { prepareVueCandidate } from './vue-candidate-consumer.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const fixtureRoot = join(repositoryRoot, 'test/fixtures/vue-anonymous')
const scratchRoot = mkdtempSync(join(tmpdir(), 'better-convex-vue-anonymous-'))
const consumerRoot = join(scratchRoot, 'consumer')
const tarballName = 'better-convex-vue.tgz'
const forbiddenPackages = new Set([
  '@modelcontextprotocol/ext-apps',
  'better-auth',
  '@better-auth/core',
  '@better-auth/oauth-provider',
  'nuxt',
  'nitropack',
  'h3',
])
const forbiddenBundleMarkers = [
  '@modelcontextprotocol/ext-apps',
  'better-auth',
  '@better-auth/',
  'nitropack',
  'from"h3"',
  'from"nuxt"',
]

function run(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  })
}

function collectFiles(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? collectFiles(path) : [path]
  })
}

function collectDependencyNames(graph) {
  const names = new Set()
  const visit = (node) => {
    for (const section of ['dependencies', 'optionalDependencies']) {
      for (const [name, dependency] of Object.entries(node?.[section] ?? {})) {
        names.add(name)
        if (dependency && typeof dependency === 'object') visit(dependency)
      }
    }
  }
  for (const root of graph) visit(root)
  return names
}

let candidate
try {
  candidate = prepareVueCandidate(process.argv.slice(2), scratchRoot)
  const packedTarball = candidate.tarballPath
  const tarballBytes = readFileSync(packedTarball)
  const tarballSha256 = createHash('sha256').update(tarballBytes).digest('hex')

  cpSync(fixtureRoot, consumerRoot, { recursive: true })
  cpSync(packedTarball, join(consumerRoot, tarballName))
  run(
    'pnpm',
    ['install', '--frozen-lockfile=false', '--ignore-scripts', '--strict-peer-dependencies'],
    consumerRoot,
  )
  run('pnpm', ['run', 'typecheck'], consumerRoot)
  run('pnpm', ['run', 'build'], consumerRoot)

  const installedManifest = JSON.parse(
    readFileSync(join(consumerRoot, 'node_modules/better-convex-vue/package.json'), 'utf8'),
  )
  if (
    installedManifest.name !== 'better-convex-vue' ||
    installedManifest.version !== candidate.version
  ) {
    throw new Error('Anonymous consumer installed an unexpected Vue package identity')
  }
  candidate.assertInstalled(join(consumerRoot, 'node_modules/better-convex-vue'))
  const graph = JSON.parse(
    execFileSync('pnpm', ['list', '--prod', '--depth', 'Infinity', '--json'], {
      cwd: consumerRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }),
  )
  const dependencyNames = collectDependencyNames(graph)
  const forbiddenInstalled = [...forbiddenPackages].filter((name) => dependencyNames.has(name))
  if (forbiddenInstalled.length > 0) {
    throw new Error(`Anonymous production graph contains: ${forbiddenInstalled.join(', ')}`)
  }

  const bundleText = collectFiles(join(consumerRoot, 'dist'))
    .filter((file) => /\.(?:html|js|css)$/u.test(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
  const leakedMarkers = forbiddenBundleMarkers.filter((marker) => bundleText.includes(marker))
  if (leakedMarkers.length > 0) {
    throw new Error(
      `Anonymous production bundle contains forbidden marker(s): ${leakedMarkers.join(', ')}`,
    )
  }
  if (!bundleText.includes('better-convex-vue-anonymous')) {
    throw new Error('Anonymous production bundle is missing its positive-control marker')
  }

  console.log(`Anonymous Vue consumer passed (tarball sha256 ${tarballSha256}).`)
} finally {
  candidate?.cleanup()
  rmSync(scratchRoot, { recursive: true, force: true })
}
