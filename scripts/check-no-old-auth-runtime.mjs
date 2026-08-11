#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const root = process.cwd()
const removedPackage = '@convex-dev/better-auth'
const excludedDirectories = new Set([
  '.claude',
  '.git',
  '.audit',
  '.data',
  '.pnpm-store',
  '.release-artifacts',
  'coverage',
  'node_modules',
  'reports',
])
const historicalInputs = new Set([
  'THIRD_PARTY_NOTICES.md',
  'plan.md',
  'scripts/check-no-old-auth-runtime.mjs',
  'scripts/check-workspace-dependency-alignment.mjs',
  'security/upstream-convex-better-auth.json',
  'test/unit/supported-version-alignment.test.ts',
])
const historicalPrefixes = ['docs/research/', 'LICENSES/']
const violations = []

function isHistoricalInput(path) {
  return historicalInputs.has(path) || historicalPrefixes.some((prefix) => path.startsWith(prefix))
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      walk(absolute)
      continue
    }
    if (!entry.isFile() || statSync(absolute).size > 5_000_000) continue
    const path = relative(root, absolute).split(sep).join('/')
    if (isHistoricalInput(path)) continue
    let contents
    try {
      contents = readFileSync(absolute, 'utf8')
    } catch {
      continue
    }
    if (!contents.includes(removedPackage)) continue
    const lines = contents.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index]?.includes(removedPackage)) violations.push(`${path}:${index + 1}`)
    }
  }
}

walk(root)

const graph = spawnSync('pnpm', ['why', removedPackage, '--recursive', '--json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
  timeout: 30_000,
})
if (graph.error || graph.status !== 0) {
  violations.push(
    `installed dependency graph could not be inspected: ${graph.error?.message ?? graph.stderr.trim() ?? `exit ${graph.status}`}`,
  )
} else {
  try {
    const result = JSON.parse(graph.stdout)
    if (!Array.isArray(result) || result.length > 0) {
      violations.push(`installed dependency graph resolves ${removedPackage}`)
    }
  } catch {
    violations.push('installed dependency graph returned invalid JSON')
  }
}

if (violations.length > 0) {
  console.error(`Removed auth runtime reference found in ${violations.length} location(s):`)
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log('Old auth runtime absence check passed.')
}
