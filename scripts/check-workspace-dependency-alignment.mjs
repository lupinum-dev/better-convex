#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parse } from 'yaml'

import { supportedDependencyTuple } from './supported-dependency-tuple.mjs'

const rootDir = process.cwd()
const rootPackage = readPackage('package.json')
const workspaceSource = readFileSync(resolve(rootDir, 'pnpm-workspace.yaml'), 'utf8')
const ciWorkflow = readFileSync(resolve(rootDir, '.github/workflows/ci.yml'), 'utf8')
const ci = parse(ciWorkflow)
const renovate = readPackage('renovate.json')
const playgroundPackage = readPackage('playground/package.json')
const distributedAppManifests = [
  'demo/package.json',
  ...readdirSync(resolve(rootDir, 'starters'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `starters/${entry.name}/package.json`),
]

const rootSpecifiers = new Map(Object.entries(supportedDependencyTuple))

const manifestPaths = [
  'demo/package.json',
  'playground/package.json',
  ...readdirSync(resolve(rootDir, 'starters'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `starters/${entry.name}/package.json`),
  ...packageManifestsIn('test/fixtures'),
].filter((path) => existsSync(resolve(rootDir, path)))

const failures = []
for (const manifestPath of ['package.json', 'docs/package.json', 'demo/package.json']) {
  const manifest = readPackage(manifestPath)
  const packageManager = manifest.packageManager ?? ''
  if (!/^pnpm@(?:1[1-9]|[2-9]\d)\./u.test(packageManager)) {
    failures.push(`${manifestPath} must use pnpm 11 or newer for strict dependency quarantine`)
  }
  if (manifest.pnpm) {
    failures.push(`${manifestPath} must keep pnpm settings in pnpm-workspace.yaml`)
  }
}
const compatibilitySteps = ci?.jobs?.compatibility?.steps ?? []
const verifierIndex = compatibilitySteps.findIndex(
  (step) => step?.run?.trim() === 'node scripts/verify-action-shas.mjs' && step?.if == null,
)
if (compatibilitySteps[verifierIndex]?.env?.GITHUB_TOKEN) {
  failures.push('Action SHA verification must not receive GITHUB_TOKEN')
}
const installIndex = compatibilitySteps.findIndex((step) =>
  /(?:^|\s)(?:pnpm|corepack pnpm\S*) install(?:\s|$)/u.test(step?.run ?? ''),
)
if (verifierIndex < 0 || installIndex < 0 || verifierIndex > installIndex) {
  failures.push('CI must verify pinned Action commits upstream')
}
if (renovate.minimumReleaseAge !== '1 day') {
  failures.push('Renovate must match the 24-hour pnpm quarantine')
}

for (const workspacePath of [
  'pnpm-workspace.yaml',
  'docs/pnpm-workspace.yaml',
  'demo/pnpm-workspace.yaml',
]) {
  const workspace = readFileSync(resolve(rootDir, workspacePath), 'utf8')
  if (!/^minimumReleaseAge:\s*1440\s*$/mu.test(workspace)) {
    failures.push(`${workspacePath} must quarantine fresh dependencies for 24 hours`)
  }
  if (!/^minimumReleaseAgeStrict:\s*true\s*$/mu.test(workspace)) {
    failures.push(`${workspacePath} must apply the quarantine to transitive dependencies`)
  }
  if (!/^minimumReleaseAgeIgnoreMissingTime:\s*false\s*$/mu.test(workspace)) {
    failures.push(`${workspacePath} must fail when registry publication time is missing`)
  }
  if (/^minimumReleaseAgeExclude:/mu.test(workspace)) {
    failures.push(`${workspacePath} must not contain a committed dependency-age exception`)
  }
}

if (existsSync(resolve(rootDir, 'packages/mcp/pnpm-workspace.yaml'))) {
  failures.push('packages/mcp must use the root workspace policy and lockfile')
}

const workspacePackagesBlock =
  workspaceSource.match(/^packages:\s*(?:#.*)?\r?\n((?:[ \t].*(?:\r?\n|$))*)/mu)?.[1] ?? ''
if (!/^\s+-\s+['"]?playground['"]?\s*(?:#.*)?$/mu.test(workspacePackagesBlock)) {
  failures.push('pnpm-workspace.yaml must list playground under packages')
}
if (playgroundPackage.dependencies?.['@lupinum/better-convex-nuxt'] !== 'workspace:*') {
  failures.push('playground/package.json must declare @lupinum/better-convex-nuxt@workspace:*')
}

for (const manifestPath of manifestPaths) {
  const packageJson = readPackage(manifestPath)
  for (const [name, expected] of rootSpecifiers) {
    const actual = dependencySpecifier(packageJson, name)
    if (actual && normalizeSpecifier(actual) !== normalizeSpecifier(expected)) {
      failures.push(`${manifestPath} declares ${name}@${actual}; expected ${expected}`)
    }
  }
  if (dependencySpecifier(packageJson, '@convex-dev/better-auth')) {
    failures.push(`${manifestPath} still declares the removed @convex-dev/better-auth package`)
  }
  if (dependencySpecifier(packageJson, 'kysely')) {
    failures.push(
      `${manifestPath} declares kysely directly; Better Auth owns its database dependency`,
    )
  }
}

for (const manifestPath of distributedAppManifests) {
  const appDir = manifestPath.slice(0, -'/package.json'.length)
  const packageJson = readPackage(manifestPath)
  const expected = rootSpecifiers.get('@lupinum/better-convex-nuxt') ?? rootPackage.version
  const actual = dependencySpecifier(packageJson, '@lupinum/better-convex-nuxt')
  if (actual !== expected) {
    failures.push(
      `${manifestPath} declares @lupinum/better-convex-nuxt@${actual}; expected ${expected}`,
    )
  }

  const workspacePath = resolve(rootDir, appDir, 'pnpm-workspace.yaml')
  if (existsSync(workspacePath)) {
    const workspace = readFileSync(workspacePath, 'utf8')
    if (/@lupinum\/better-convex-nuxt\s*:\s*(?:file|link|workspace):/u.test(workspace)) {
      failures.push(`${appDir}/pnpm-workspace.yaml overrides @lupinum/better-convex-nuxt locally`)
    }
  }

  const lockPath = resolve(rootDir, appDir, 'pnpm-lock.yaml')
  if (!existsSync(lockPath)) {
    failures.push(`${appDir}/pnpm-lock.yaml is missing`)
    continue
  }
  const lock = readFileSync(lockPath, 'utf8')
  if (/\/private\/|\/Users\/|\/home\/|[A-Z]:\\\\Users\\\\/u.test(lock)) {
    failures.push(`${appDir}/pnpm-lock.yaml contains a source-machine absolute path`)
  }
  if (/@lupinum\/better-convex-nuxt@(?:file|link):/u.test(lock)) {
    failures.push(`${appDir}/pnpm-lock.yaml resolves @lupinum/better-convex-nuxt from a local path`)
  }
  const lockedSpecifier = lock.match(
    /\n {6}'?@lupinum\/better-convex-nuxt'?:\n {8}specifier: ['"]?([^'"\n]+)['"]?/u,
  )?.[1]
  if (lockedSpecifier !== actual) {
    failures.push(
      `${appDir}/pnpm-lock.yaml records @lupinum/better-convex-nuxt@${lockedSpecifier ?? '<missing>'}; manifest declares ${actual}`,
    )
  }
  if (!lock.includes(`\n  '@lupinum/better-convex-nuxt@${actual}':`)) {
    failures.push(`${appDir}/pnpm-lock.yaml has no registry package entry for ${actual}`)
  }
}

if (existsSync(resolve(rootDir, 'test/fixtures/consumer-smoke/pnpm-lock.yaml'))) {
  failures.push(
    'test/fixtures/consumer-smoke/pnpm-lock.yaml must stay ephemeral; its packed-tarball path is run-specific',
  )
}

if (failures.length > 0) {
  console.error(`Workspace dependency alignment failed with ${failures.length} issue(s):`)
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exitCode = 1
} else {
  console.log(
    `Workspace dependency alignment passed (${manifestPaths.length} manifest(s) checked).`,
  )
}

function readPackage(path) {
  return JSON.parse(readFileSync(resolve(rootDir, path), 'utf8'))
}

function dependencySpecifier(packageJson, name) {
  return (
    packageJson.dependencies?.[name] ??
    packageJson.devDependencies?.[name] ??
    packageJson.peerDependencies?.[name]
  )
}

function normalizeSpecifier(specifier) {
  return specifier.replace(/^[~^]/, '')
}

function packageManifestsIn(parent, child) {
  return readdirSync(resolve(rootDir, parent), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [parent, entry.name, child, 'package.json'].filter(Boolean).join('/'))
}
