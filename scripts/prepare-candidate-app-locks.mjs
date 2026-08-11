#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { withReleasePreflightTarballs } from './release-preflight-tarballs.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')

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

export function verifyCandidateAppLocks(mode, tarballs) {
  if (!['check', 'update'].includes(mode)) {
    throw new Error('Candidate lock mode must be check or update.')
  }
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
}

export function prepareCandidateAppLocks(mode) {
  return withReleasePreflightTarballs((tarballs) => verifyCandidateAppLocks(mode, tarballs), {
    repositoryRoot,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv[2]
  if (!['check', 'update'].includes(mode) || process.argv.length !== 3) {
    throw new Error('Usage: prepare-candidate-app-locks.mjs check|update')
  }
  prepareCandidateAppLocks(mode)
}
