#!/usr/bin/env node
// The Nuxt 5 lane: runs the repository's own Nuxt checks against the Nuxt 5 nightly pinned in
// test/packed/nuxt5.json. It rewrites package.json, pnpm-workspace.yaml and pnpm-lock.yaml in
// place, so run it only in a throwaway checkout (CI, or a detached worktree; see
// test/TESTING.md). The committed files stay on Nuxt 4 with strict peers.
//
// check-starters.mjs and check-nuxt-lifecycle-consumer.mjs import the helpers below for their
// `--nuxt5` flag, so the aliases and the peer rules are defined once.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '../..')
const { nightly } = JSON.parse(readFileSync(join(import.meta.dirname, 'nuxt5.json'), 'utf8'))
if (!/^5\.0\.0-\d{10}-[0-9a-f]{7}$/.test(nightly)) {
  throw new Error(`test/packed/nuxt5.json: unexpected nightly version ${JSON.stringify(nightly)}`)
}

/** The nightly packages, as pnpm aliases. */
export const nuxt5Aliases = Object.freeze({
  nuxt: `npm:nuxt-nightly@${nightly}`,
  '@nuxt/kit': `npm:@nuxt/kit-nightly@${nightly}`,
  '@nuxt/schema': `npm:@nuxt/schema-nightly@${nightly}`,
})

// @nuxt/cli (3.x, through @nuxt/module-builder) and the nightly cli still declare an
// @nuxt/schema peer that excludes 5. Allowed only inside the lane.
const peerRules = {
  '@nuxt/cli-nightly>@nuxt/schema': '^5.0.0-0',
  '@nuxt/cli>@nuxt/schema': '^4.4.6 || ^5.0.0-0',
}
// pnpm 10 cannot match the nightlies' aliased peers (`nuxt: npm:nuxt-nightly@…`) and fails
// strict peers, so every lane install uses the repository's pnpm 11. pnpm 11 also installs
// nuxt-nightly's required rolldown peer on its own.
const { packageManager } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/**
 * Moves an app manifest to the nightly: every `nuxt`, `@nuxt/kit` and `@nuxt/schema` entry it
 * already has becomes the alias, and it installs with the repository's pnpm.
 */
export function toNuxt5Manifest(manifest) {
  for (const section of [manifest.dependencies, manifest.devDependencies]) {
    for (const name of Object.keys(nuxt5Aliases)) {
      if (section?.[name]) section[name] = nuxt5Aliases[name]
    }
  }
  if (!manifest.dependencies?.nuxt && !manifest.devDependencies?.nuxt) {
    throw new Error(`${manifest.name}: no nuxt dependency to move to the nightly`)
  }
  manifest.packageManager = packageManager
  return manifest
}

/**
 * Adds the overrides for `names` and the peer rules to a pnpm-workspace.yaml text. The text must
 * not already carry peer rules (the committed files have none).
 */
export function toNuxt5Workspace(text, names) {
  if (/^peerDependencyRules:/m.test(text)) {
    throw new Error('pnpm-workspace.yaml already has peerDependencyRules; merge them by hand')
  }
  const overrides = names.map((name) => `  '${name}': '${nuxt5Aliases[name]}'\n`).join('')
  const next = /^overrides:\n/m.test(text)
    ? text.replace(/^overrides:\n/m, `overrides:\n${overrides}`)
    : `${text.replace(/\n*$/, '\n')}overrides:\n${overrides}`
  const rules = Object.entries(peerRules)
    .map(([selector, range]) => `    '${selector}': '${range}'\n`)
    .join('')
  return `${next.replace(/\n*$/, '\n')}peerDependencyRules:\n  allowedVersions:\n${rules}`
}

const rewritten = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']

function step(command, args) {
  console.log(`\n=== ${command} ${args.join(' ')} ===`)
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

function rewriteRoot() {
  // Refuse a primary checkout outside CI: a linked worktree has its own git dir.
  const gitDir = git(['rev-parse', '--path-format=absolute', '--git-dir']).trim()
  const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
  if (gitDir === commonDir && process.env.CI !== 'true') {
    throw new Error(
      'The Nuxt 5 lane rewrites package.json, pnpm-workspace.yaml and pnpm-lock.yaml and ' +
        'reinstalls node_modules; run it in a throwaway worktree (test/TESTING.md):\n' +
        '  git worktree add --detach ../better-convex-nuxt5-lane HEAD && cd ../better-convex-nuxt5-lane\n' +
        '  pnpm install --frozen-lockfile && pnpm build && node test/packed/nuxt5-lane.mjs',
    )
  }
  // Refuse a checkout with other local changes: the lane leaves it on the nightly.
  const changed = git(['status', '--porcelain'])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3))
    .filter((path) => !rewritten.includes(path))
  if (changed.length > 0) {
    throw new Error(
      `The Nuxt 5 lane rewrites files in place; run it in a throwaway checkout. Changed: ${changed.join(', ')}`,
    )
  }

  const manifestPath = join(root, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  writeFileSync(manifestPath, `${JSON.stringify(toNuxt5Manifest(manifest), null, 2)}\n`)

  const workspacePath = join(root, 'pnpm-workspace.yaml')
  const workspace = readFileSync(workspacePath, 'utf8')
  // A second run in the same checkout keeps the first rewrite.
  if (!workspace.includes(nuxt5Aliases.nuxt)) {
    writeFileSync(workspacePath, toNuxt5Workspace(workspace, Object.keys(nuxt5Aliases)))
  }
}

function buildPlayground() {
  const command = ['exec', 'nuxi', 'build', 'playground']
  console.log(`\n=== pnpm ${command.join(' ')} ===`)
  const result = spawnSync('pnpm', command, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  process.stdout.write(output)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`nuxi build playground exited ${result.status}`)
  // NUXT_B8013: Nuxt disabled a module whose compatibility range excludes it (only a warning).
  // NUXT_B9003: module server code needs the Nitro v2 compatibility layer.
  // NUXT_B9005: project server code uses Nitro v2 or h3 v1 APIs.
  const legacy = output.match(/NUXT_B(?:8013|900[35])/g)
  if (legacy) {
    throw new Error(`The playground build reported ${[...new Set(legacy)].join(', ')}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Nuxt 5 lane on nuxt-nightly@${nightly}`)
  rewriteRoot()
  step('pnpm', ['install', '--no-frozen-lockfile'])
  step('pnpm', ['--filter', './packages/*', 'build'])
  step('pnpm', ['exec', 'nuxt-module-build', 'prepare'])
  step('pnpm', ['typecheck:prepared'])
  // The server helpers inside a `nuxt/server` handler, typed against the nightly's RequestEvent
  // and NuxtError (the fixture reads the built dist, like test:packed does on Nuxt 4).
  step('pnpm', ['exec', 'nuxi', 'prepare', '--cwd', 'test/fixtures/consumer-smoke'])
  step('pnpm', ['exec', 'nuxi', 'typecheck', '--cwd', 'test/fixtures/consumer-smoke'])
  step('pnpm', ['exec', 'vitest', 'run', '--project', 'nuxt'])
  buildPlayground()
  step(process.execPath, ['test/packed/check-auth-disabled-build-graph.mjs'])
  step('pnpm', ['test:e2e'])
  console.log(`\nNuxt 5 lane passed on nuxt-nightly@${nightly}.`)
}
