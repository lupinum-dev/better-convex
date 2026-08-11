#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

const root = process.cwd()
const e2eRoot = resolve(root, 'test/e2e')
const playgroundRoot = resolve(root, 'playground')
const includeExtended = process.argv.includes('--full')

function discover(directory, recursive) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!recursive || entry.name === 'extended') return []
        return discover(path, true)
      }
      return entry.name.endsWith('.e2e.test.ts') ? [path] : []
    })
    .sort()
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${String(result.status ?? 1)}`)
  }
}

function isolatePlaygroundConvexState() {
  const backupRoot = mkdtempSync(join(tmpdir(), 'bcn-e2e-playground-state-'))
  const moved = []
  for (const name of ['.convex', '.env.local']) {
    const source = join(playgroundRoot, name)
    if (!existsSync(source)) continue
    renameSync(source, join(backupRoot, name))
    moved.push(name)
  }
  return () => {
    for (const name of ['.convex', '.env.local']) {
      rmSync(join(playgroundRoot, name), { force: true, recursive: true })
    }
    for (const name of moved) {
      renameSync(join(backupRoot, name), join(playgroundRoot, name))
    }
    rmSync(backupRoot, { force: true, recursive: true })
  }
}

const restorePlaygroundState = isolatePlaygroundConvexState()
try {
  // E2E imports module source as well as the playground. Prepare both generated
  // type roots so this gate is reproducible after a clean checkout or a packed
  // contract probe that removes the root `.nuxt` directory.
  run('pnpm', ['exec', 'nuxt-module-build', 'prepare'])
  run('pnpm', ['exec', 'nuxt-module-build', 'build'])
  run('pnpm', ['exec', 'nuxi', 'prepare', '--cwd', 'playground', '--dotenv', '.env.local'])

  const files = [
    ...discover(e2eRoot, false),
    ...(includeExtended ? discover(join(e2eRoot, 'extended'), true) : []),
  ]
  if (files.length === 0) throw new Error('No E2E files discovered.')

  console.log(`Running ${files.length} E2E file(s) in isolated Vitest processes.`)
  for (const file of files) {
    const display = relative(root, file)
    console.log(`\n=== ${display} ===`)
    run('pnpm', ['exec', 'vitest', 'run', '--project=e2e', display], {
      CONVEX_E2E_AUTO_START: process.env.CONVEX_E2E_AUTO_START ?? 'true',
      BCN_E2E_REQUIRE_LOCAL: 'true',
    })
  }

  console.log(`\nE2E isolation gate passed (${files.length} file(s)).`)
} finally {
  restorePlaygroundState()
}
