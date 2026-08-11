#!/usr/bin/env node

import { relative, sep } from 'node:path'

import { candidateSetPackageIds, getCandidateSetCoordinates } from './package-candidate-set.mjs'

if (process.argv.length !== 2) {
  throw new Error('Usage: print-candidate-set-coordinates')
}

const coordinates = getCandidateSetCoordinates(process.cwd())
const packageCoordinates = Object.fromEntries(
  coordinates.packages.map((entry) => [entry.packageId, entry]),
)
const artifactDirectory = relative(
  coordinates.root,
  packageCoordinates[candidateSetPackageIds[0]].artifactRoot,
)
const outputs = {
  artifact_name: 'release-candidate-vue-nuxt-set',
  directory: artifactDirectory.split(sep).join('/'),
  evidence: relative(coordinates.root, coordinates.manifest).split(sep).join('/'),
  ...Object.fromEntries(
    candidateSetPackageIds.map((packageId) => [
      `${packageId}_directory`,
      packageCoordinates[packageId].relativeDirectory,
    ]),
  ),
  set_directory: relative(coordinates.root, coordinates.directory).split(sep).join('/'),
}

for (const [name, value] of Object.entries(outputs)) {
  if (/\r|\n/u.test(value)) throw new Error(`Candidate-set coordinate ${name} is not line-safe.`)
  console.log(`${name}=${value}`)
}
