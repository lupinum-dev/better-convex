#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'

import { getPackageArtifactCoordinates } from './package-artifact-coordinates.mjs'

const arguments_ = process.argv.slice(2)
if (arguments_.length !== 4 || arguments_[0] !== '--package' || arguments_[2] !== '--tag') {
  throw new Error(
    'Usage: publish-registry-package --package <reviewed-package-id> --tag candidate-<workflow-run-id>',
  )
}

const packageId = arguments_[1]
const tag = arguments_[3]
if (!/^candidate-[1-9]\d*$/u.test(tag)) {
  throw new Error('Candidate publication requires a workflow-run-specific candidate tag.')
}

const coordinates = getPackageArtifactCoordinates(packageId)
const registry = 'https://registry.npmjs.org'
const specification = `${coordinates.packageName}@${coordinates.version}`
const lookup = spawnSync(
  'npm',
  ['view', specification, 'version', '--json', '--registry', registry],
  {
    cwd: coordinates.repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

if (lookup.status === 0) {
  const publishedVersion = JSON.parse(lookup.stdout)
  if (publishedVersion !== coordinates.version) {
    throw new Error(`Registry lookup returned an unexpected version for ${specification}.`)
  }
  console.log(
    `${specification} already exists; publication is skipped and byte equality remains mandatory.`,
  )
} else {
  const errorOutput = `${lookup.stdout}\n${lookup.stderr}`
  if (!/"code"\s*:\s*"E404"/u.test(errorOutput) && !/\bE404\b/u.test(errorOutput)) {
    throw new Error(`Registry lookup failed without an authoritative E404:\n${errorOutput.trim()}`)
  }
  execFileSync(
    'npm',
    [
      'publish',
      coordinates.paths.tarball,
      '--tag',
      tag,
      '--access',
      'public',
      '--registry',
      registry,
    ],
    {
      cwd: coordinates.repositoryRoot,
      stdio: 'inherit',
    },
  )
}
