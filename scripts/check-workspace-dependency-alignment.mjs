#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parse } from 'yaml'

import { checkDependencyPolicy } from './check-dependency-policy.mjs'
import { validatePackageArtifactVersion } from './package-artifact-coordinates.mjs'
import { sharedPackageRuntimes, supportedDependencyTuple } from './supported-dependency-tuple.mjs'

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
const mcpPackage = readPackage('packages/mcp/package.json')
const mcpServerSdk = '@modelcontextprotocol/server'
const publishedPackageNames = ['@lupinum/better-convex-nuxt', '@lupinum/better-convex-mcp']
const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u

const manifestPaths = [
  'demo/package.json',
  'playground/package.json',
  ...readdirSync(resolve(rootDir, 'starters'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `starters/${entry.name}/package.json`),
  ...packageManifestsIn('test/fixtures'),
].filter((path) => existsSync(resolve(rootDir, path)))

const failures = []
const packageManagerManifestPaths = [
  'package.json',
  'docs/package.json',
  ...distributedAppManifests,
]
for (const manifestPath of packageManagerManifestPaths) {
  const manifest = readPackage(manifestPath)
  const packageManager = manifest.packageManager ?? ''
  if (!/^pnpm@(?:1[1-9]|[2-9]\d)\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/u.test(packageManager)) {
    failures.push(`${manifestPath} must use an integrity-qualified pnpm 11 or newer descriptor`)
  }
  if (manifest.pnpm) {
    failures.push(`${manifestPath} must keep pnpm settings in pnpm-workspace.yaml`)
  }
  if (packageManager !== rootPackage.packageManager) {
    failures.push(`${manifestPath} must use the root packageManager ${rootPackage.packageManager}`)
  }
}
for (const [name, command] of Object.entries(rootPackage.scripts ?? {})) {
  if (/\bcorepack\s+pnpm@/u.test(command)) {
    failures.push(`${name} must use the root packageManager without an embedded version`)
  }
}
for (const workflowPath of ['.github/workflows/ci.yml', '.github/workflows/docs.yml']) {
  const workflow = readFileSync(resolve(rootDir, workflowPath), 'utf8')
  if (/\bcorepack\s+pnpm@/u.test(workflow)) {
    failures.push(`${workflowPath} must use the root packageManager without an embedded version`)
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
if (verifierIndex < 0 || installIndex < 0 || verifierIndex < installIndex) {
  failures.push('CI must verify pinned Action commits after the frozen install')
}
if (renovate.minimumReleaseAge !== '1 day') {
  failures.push('Renovate must match the 24-hour pnpm quarantine')
}

for (const workspacePath of [
  'pnpm-workspace.yaml',
  'docs/pnpm-workspace.yaml',
  'demo/pnpm-workspace.yaml',
  ...packageManifestsIn('test/fixtures')
    .map((path) => path.replace(/package\.json$/u, 'pnpm-workspace.yaml'))
    .filter((path) => existsSync(resolve(rootDir, path))),
]) {
  const workspace = readFileSync(resolve(rootDir, workspacePath), 'utf8')
  failures.push(
    ...checkDependencyPolicy(workspace).map((failure) => `${workspacePath}: ${failure}`),
  )
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

if (rootPackage.devDependencies?.[mcpServerSdk] !== mcpPackage.peerDependencies?.[mcpServerSdk]) {
  failures.push(
    `package.json must exercise ${mcpServerSdk}@${mcpPackage.peerDependencies?.[mcpServerSdk]} from packages/mcp`,
  )
}

// A distributed app installs published releases, so it follows their exact dependency tuple.
// Candidate checks move each app copy to the candidate tuple with the candidate tarballs.
const publishedRequirements = new Map(
  distributedAppManifests.map((manifestPath) => [manifestPath, publishedTuple(manifestPath)]),
)

for (const manifestPath of manifestPaths) {
  const packageJson = readPackage(manifestPath)
  const published = publishedRequirements.get(manifestPath)
  for (const [name, expected] of rootSpecifiers) {
    if (published?.has(name)) continue
    const actual = dependencySpecifier(packageJson, name)
    if (actual && normalizeSpecifier(actual) !== normalizeSpecifier(expected)) {
      failures.push(`${manifestPath} declares ${name}@${actual}; expected ${expected}`)
    }
  }
  for (const [name, { expected, owner }] of published ?? []) {
    const actual = dependencySpecifier(packageJson, name)
    if (actual !== undefined && actual !== expected) {
      failures.push(
        `${manifestPath} declares ${name}@${actual}; its pinned ${owner} requires ${expected}`,
      )
    }
  }
  if (!published && dependencySpecifier(packageJson, mcpServerSdk) !== undefined) {
    const actual = dependencySpecifier(packageJson, mcpServerSdk)
    if (actual !== mcpPackage.peerDependencies?.[mcpServerSdk]) {
      failures.push(
        `${manifestPath} declares ${mcpServerSdk}@${actual}; packages/mcp requires ${mcpPackage.peerDependencies?.[mcpServerSdk]}`,
      )
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
  const actual = dependencySpecifier(packageJson, '@lupinum/better-convex-nuxt')
  try {
    validatePackageArtifactVersion(actual)
  } catch {
    failures.push(
      `${manifestPath} must pin one exact published @lupinum/better-convex-nuxt version; received ${actual ?? '<missing>'}`,
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
  for (const packageName of publishedPackageNames) {
    const declared = dependencySpecifier(packageJson, packageName)
    if (declared === undefined) continue
    const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const lockedSpecifier = lock.match(
      new RegExp(`\\n {6}'?${escapedName}'?:\\n {8}specifier: ['"]?([^'"\\n]+)['"]?`, 'u'),
    )?.[1]
    if (lockedSpecifier !== declared) {
      failures.push(
        `${appDir}/pnpm-lock.yaml records ${packageName}@${lockedSpecifier ?? '<missing>'}; manifest declares ${declared}`,
      )
    }
    if (!lock.includes(`\n  '${packageName}@${declared}':`)) {
      failures.push(
        `${appDir}/pnpm-lock.yaml has no registry package entry for ${packageName}@${declared}`,
      )
    }
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

function publishedTuple(manifestPath) {
  const appDir = manifestPath.slice(0, -'/package.json'.length)
  const lockPath = resolve(rootDir, appDir, 'pnpm-lock.yaml')
  const requirements = new Map()
  if (!existsSync(lockPath)) return requirements
  const lock = parse(readFileSync(lockPath, 'utf8'))
  const packageJson = readPackage(manifestPath)
  for (const packageName of publishedPackageNames) {
    const version = dependencySpecifier(packageJson, packageName)
    if (version === undefined) continue
    const owner = `${packageName}@${version}`
    if (!exactVersionPattern.test(version)) {
      failures.push(`${manifestPath} must pin one exact published ${packageName} version`)
      continue
    }
    const exact = Object.entries(lock?.packages?.[owner]?.peerDependencies ?? {}).filter(
      ([, range]) => exactVersionPattern.test(String(range)),
    )
    const snapshot = Object.entries(lock?.snapshots ?? {}).find(
      ([key]) => key === owner || key.startsWith(`${owner}(`),
    )?.[1]
    for (const name of sharedPackageRuntimes[packageName] ?? []) {
      const resolved = snapshot?.dependencies?.[name]
      if (resolved === undefined) {
        failures.push(`${appDir}/pnpm-lock.yaml does not resolve ${name} for ${owner}`)
      } else {
        exact.push([name, String(resolved).replace(/\(.*$/u, '')])
      }
    }
    for (const [name, expected] of exact) {
      const current = requirements.get(name)
      if (current && current.expected !== expected) {
        failures.push(
          `${manifestPath} pins ${current.owner} and ${owner} with conflicting ${name} requirements`,
        )
      }
      requirements.set(name, { expected: String(expected), owner })
    }
  }
  return requirements
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
