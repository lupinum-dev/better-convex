#!/usr/bin/env node

import { getPackageArtifactCoordinates } from './package-artifact-coordinates.mjs'

const arguments_ = process.argv.slice(2)

if (arguments_.length !== 2 || arguments_[0] !== '--package') {
  throw new Error('Usage: print-package-artifact-coordinates --package <reviewed-package-id>')
}

const coordinates = getPackageArtifactCoordinates(arguments_[1])
const outputs = {
  artifact_name: `release-candidate-${coordinates.packageId}`,
  directory: coordinates.relativeDirectory,
  evidence: coordinates.relativePaths.evidence,
  package_id: coordinates.packageId,
  package_name: coordinates.packageName,
  tarball: coordinates.relativePaths.tarball,
  tarball_filename: coordinates.files.tarball,
  version: coordinates.version,
}

for (const [name, value] of Object.entries(outputs)) {
  if (/\r|\n/u.test(value)) throw new Error(`Artifact coordinate ${name} is not line-safe.`)
  console.log(`${name}=${value}`)
}
