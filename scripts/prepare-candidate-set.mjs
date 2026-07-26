#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

import {
  assertCandidateSetManifest,
  candidateSetPackageIds,
  createCandidateSetEvidence,
  getCandidateSetCoordinates,
} from './package-candidate-set.mjs'

const root = resolve(import.meta.dirname, '..')
const command = process.argv[2]
const suppliedManifest = process.argv[3]
if (
  !['artifact', 'family', 'prepare', 'verify'].includes(command) ||
  (command === 'verify' ? process.argv.length !== 4 : process.argv.length !== 3)
) {
  throw new Error(
    'Usage: prepare-candidate-set.mjs artifact|family|prepare | verify <artifact-set.json>',
  )
}

function run(executable, args, options = {}) {
  console.log(`\n> ${[executable, ...args].join(' ')}`)
  return execFileSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
}

function ensureClean() {
  const status = run('git', ['status', '--porcelain'], { capture: true }).trim()
  if (status) throw new Error(`Candidate-set creation requires a clean working tree:\n${status}`)
}

function verifySet(manifest) {
  const evidence = assertCandidateSetManifest(manifest, root)
  for (const entry of evidence.packages) {
    run('node', ['scripts/release.mjs', 'verify', entry.evidence, '--package', entry.packageId])
  }
  return evidence
}

function createSet() {
  ensureClean()
  const coordinates = getCandidateSetCoordinates(root)
  const occupied = [
    ...coordinates.packages.map((entry) => entry.directory),
    coordinates.directory,
  ].filter(existsSync)
  if (occupied.length > 0) {
    throw new Error(`Immutable candidate-set output already exists: ${occupied.join(', ')}`)
  }

  const createdPackageDirectories = []
  let stagingDirectory
  let committed = false
  try {
    for (const packageId of candidateSetPackageIds) {
      run('node', ['scripts/release.mjs', 'artifact', '--package', packageId])
      createdPackageDirectories.push(
        coordinates.packages.find((entry) => entry.packageId === packageId).directory,
      )
    }
    const evidence = createCandidateSetEvidence(root)
    mkdirSync(coordinates.parentDirectory, { recursive: true })
    const parentStats = lstatSync(coordinates.parentDirectory)
    if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
      throw new Error('Candidate-set parent must be a real directory.')
    }
    stagingDirectory = mkdtempSync(
      join(coordinates.parentDirectory, `.tmp-${coordinates.version}-`),
    )
    writeFileSync(
      join(stagingDirectory, 'artifact-set.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
    )
    ensureClean()
    renameSync(stagingDirectory, coordinates.directory)
    committed = true
    return coordinates.manifest
  } catch (error) {
    if (!committed) {
      if (stagingDirectory) rmSync(stagingDirectory, { recursive: true, force: true })
      for (const directory of createdPackageDirectories) {
        rmSync(directory, { recursive: true, force: true })
      }
    }
    throw error
  }
}

if (command === 'family') {
  run('node', ['scripts/release.mjs', 'prepare', '--package', 'mcp'])
  run('node', ['scripts/prepare-candidate-set.mjs', 'prepare'])
  console.log('\nPrepared the immutable MCP + Vue/Nuxt release family.')
} else if (command === 'verify') {
  verifySet(suppliedManifest)
} else {
  const manifest = createSet()
  if (command === 'prepare') {
    const evidence = verifySet(manifest)
    for (const entry of evidence.packages) {
      run('node', [
        'scripts/verify-release.mjs',
        '--package',
        entry.packageId,
        '--artifact-manifest',
        entry.evidence,
      ])
    }
    verifySet(manifest)
  }
  console.log(`\nImmutable candidate set: ${manifest}`)
}
