#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { verifyCandidateAppLocks } from './prepare-candidate-app-locks.mjs'
import { withReleasePreflightTarballs } from './release-preflight-tarballs.mjs'

const root = resolve(import.meta.dirname, '..')

function run(command, args, environment = process.env) {
  console.log(`\n> ${[command, ...args].join(' ')}`)
  execFileSync(command, args, { cwd: root, env: environment, stdio: 'inherit' })
}

function ensureClean() {
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  if (status) throw new Error(`Release smoke requires a clean working tree:\n${status}`)
}

ensureClean()
run('node', ['scripts/check-workspace-dependency-alignment.mjs'])

withReleasePreflightTarballs((tarballs) => {
  verifyCandidateAppLocks('check', tarballs)
  run('node', ['scripts/check-package-exports.mjs', '--package', 'vue', '--tarball', tarballs.vue])
  run('node', [
    'scripts/check-package-exports.mjs',
    '--package',
    'nuxt',
    '--tarball',
    tarballs.nuxt,
    '--vue-tarball',
    tarballs.vue,
  ])
  run('node', ['scripts/check-package-exports.mjs', '--package', 'mcp', '--tarball', tarballs.mcp])
})

run('pnpm', [
  'exec',
  'vitest',
  'run',
  'test/unit/release-changelog.test.ts',
  'test/unit/release-workflow.test.ts',
])
ensureClean()
console.log(
  '\n[release-smoke] PASS: locks, release-equivalent packages, consumers, and regressions.',
)
