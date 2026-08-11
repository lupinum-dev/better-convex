#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { getPackageArtifactCoordinates } from './package-artifact-coordinates.mjs'
import { parsePackageArtifactEvidence } from './package-artifact-evidence.mjs'

const root = path.resolve(import.meta.dirname, '..')
const arguments_ = process.argv.slice(2)

function fail(message) {
  throw new Error(`[release-verify] ${message}`)
}

function run(command, args, options = {}) {
  console.log(`\n> ${[command, ...args].join(' ')}`)
  execFileSync(command, args, {
    cwd: root,
    env: options.env ?? process.env,
    stdio: 'inherit',
  })
}

function failMissingRetainedCompanion(packageId, relativePath) {
  fail(
    `retained ${packageId} companion artifact is missing: ${relativePath}; produce it with \`pnpm release:prepare\` from an empty .release-artifacts directory`,
  )
}

function readRetainedCompanionFile(packageId, relativePath, file) {
  let stats
  try {
    stats = lstatSync(file)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      failMissingRetainedCompanion(packageId, relativePath)
    }
    throw error
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(`retained ${packageId} companion artifact must be a regular file: ${relativePath}`)
  }
  try {
    return { bytes: readFileSync(file), size: stats.size }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      failMissingRetainedCompanion(packageId, relativePath)
    }
    throw error
  }
}

function verifyRetainedCompanionArtifact(packageId) {
  const coordinates = getPackageArtifactCoordinates(packageId, { repositoryRoot: root })
  const evidenceFile = readRetainedCompanionFile(
    packageId,
    coordinates.relativePaths.evidence,
    coordinates.paths.evidence,
  )
  const evidence = parsePackageArtifactEvidence(
    JSON.parse(evidenceFile.bytes.toString('utf8')),
    coordinates,
  )
  for (const [kind, fileEvidence] of Object.entries({
    contents: evidence.contents,
    sbom: evidence.sbom,
    tarball: evidence.tarball,
  })) {
    const file = coordinates.paths[kind]
    const { bytes, size } = readRetainedCompanionFile(
      packageId,
      coordinates.relativePaths[kind],
      file,
    )
    if (
      size !== fileEvidence.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== fileEvidence.sha256
    ) {
      fail(`retained ${packageId} ${kind} bytes do not match immutable evidence`)
    }
    if (
      kind === 'tarball' &&
      `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== fileEvidence.integrity
    ) {
      fail(`retained ${packageId} tarball SRI does not match immutable evidence`)
    }
  }
  return coordinates
}

function main() {
  const values = new Map()
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (!['--package', '--artifact-manifest'].includes(argument) || values.has(argument)) {
      fail(
        'usage: pnpm release:verify [--package <reviewed-id>] --artifact-manifest <artifact.json>',
      )
    }
    const value = arguments_[index + 1]
    if (!value || value.startsWith('--')) {
      fail(
        'usage: pnpm release:verify [--package <reviewed-id>] --artifact-manifest <artifact.json>',
      )
    }
    values.set(argument, value)
    index += 1
  }
  if (!values.has('--artifact-manifest')) {
    fail('usage: pnpm release:verify [--package <reviewed-id>] --artifact-manifest <artifact.json>')
  }
  const releasePackageId = values.get('--package') ?? 'nuxt'

  const artifactCoordinates = getPackageArtifactCoordinates(releasePackageId, {
    repositoryRoot: root,
  })
  const evidencePath = path.resolve(root, values.get('--artifact-manifest'))
  if (evidencePath !== artifactCoordinates.paths.evidence) {
    fail(
      `artifact manifest must be the reviewed ${releasePackageId} coordinate: ${artifactCoordinates.relativePaths.evidence}`,
    )
  }
  run('node', ['scripts/release.mjs', 'verify', evidencePath, '--package', releasePackageId])
  const tarball = artifactCoordinates.paths.tarball

  if (releasePackageId === 'vue' || releasePackageId === 'mcp') {
    console.log(
      `\n[release-verify] ${releasePackageId} artifact-dependent package and consumer gates`,
    )
    run(
      'node',
      ['scripts/check-package-exports.mjs', '--package', releasePackageId, '--tarball', tarball],
      {
        env: { ...process.env, BCN_RELEASE_PRODUCTION_AUDIT: 'true' },
      },
    )
    run('node', [
      'scripts/check-candidate-apps.mjs',
      '--package',
      releasePackageId,
      '--tarball',
      tarball,
    ])
    console.log(
      `\n[release-verify] PASS: ${releasePackageId} artifact-dependent gates consumed ${tarball}; no gate repacked the candidate.`,
    )
    return
  }

  const vueCoordinates = getPackageArtifactCoordinates('vue', { repositoryRoot: root })
  const mcpCoordinates = verifyRetainedCompanionArtifact('mcp')
  run('node', ['scripts/release.mjs', 'verify', vueCoordinates.paths.evidence, '--package', 'vue'])
  run('node', [
    'scripts/check-package-exports.mjs',
    '--package',
    'mcp',
    '--tarball',
    mcpCoordinates.paths.tarball,
  ])

  console.log('\n[release-verify] Artifact-only package and clean-consumer gates')
  run(
    'node',
    [
      'scripts/check-package-exports.mjs',
      '--package',
      releasePackageId,
      '--tarball',
      tarball,
      '--vue-tarball',
      vueCoordinates.paths.tarball,
    ],
    {
      env: { ...process.env, BCN_RELEASE_PRODUCTION_AUDIT: 'true' },
    },
  )
  run('node', ['scripts/check-auth-provenance.mjs', '--tarball', tarball])
  run('node', [
    'scripts/check-candidate-apps.mjs',
    '--package',
    releasePackageId,
    '--tarball',
    tarball,
    '--vue-tarball',
    vueCoordinates.paths.tarball,
    '--mcp-tarball',
    mcpCoordinates.paths.tarball,
  ])

  console.log(
    `\n[release-verify] PASS: artifact-dependent gates consumed ${tarball}; no source suite ran and no gate repacked the candidate.`,
  )
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
