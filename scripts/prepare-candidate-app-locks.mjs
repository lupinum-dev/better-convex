#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { buildAndPackReleaseTarball } from './pack-release-tarball.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const mode = process.argv[2]
if (!['check', 'update'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: prepare-candidate-app-locks.mjs check|update')
}

function run(executable, args, { capture = false, environment = process.env } = {}) {
  console.log(`\n> ${[executable, ...args].join(' ')}`)
  return execFileSync(executable, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: environment,
    stdio: capture ? 'pipe' : 'inherit',
  })
}

function ensureClean() {
  const status = run('git', ['status', '--porcelain'], { capture: true }).trim()
  if (status) {
    throw new Error(`Candidate lock preparation requires a clean working tree:\n${status}`)
  }
}

if (mode === 'check') ensureClean()
const scratchDirectory = mkdtempSync(join(tmpdir(), 'bcn-candidate-lock-inputs-'))
try {
  // Use the same build + bind + pack function as immutable artifact creation;
  // ordinary placeholder packs are never a supported lock input.
  const tarballs = Object.fromEntries(
    ['vue', 'nuxt', 'mcp'].map((packageId) => {
      const packed = buildAndPackReleaseTarball(packageId, scratchDirectory, {
        repositoryRoot,
      })
      return [packageId, packed.tarballPath]
    }),
  )
  if (mode === 'check') ensureClean()
  run('node', [
    'scripts/update-candidate-app-locks.mjs',
    '--tarball',
    tarballs.nuxt,
    '--vue-tarball',
    tarballs.vue,
    '--mcp-tarball',
    tarballs.mcp,
    ...(mode === 'check' ? ['--check'] : []),
  ])
  if (mode === 'check') ensureClean()
} finally {
  rmSync(scratchDirectory, { force: true, recursive: true })
}
