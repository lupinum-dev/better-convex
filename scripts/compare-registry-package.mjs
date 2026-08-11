#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getPackageArtifactCoordinates } from './package-artifact-coordinates.mjs'

const arguments_ = process.argv.slice(2)
if (arguments_.length !== 2 || arguments_[0] !== '--package') {
  throw new Error('Usage: compare-registry-package --package <reviewed-package-id>')
}

const coordinates = getPackageArtifactCoordinates(arguments_[1])
const scratch = mkdtempSync(join(tmpdir(), `bcn-registry-${coordinates.packageId}-`))
try {
  const registryDirectory = join(scratch, 'registry')
  mkdirSync(registryDirectory)
  let packed
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      packed = JSON.parse(
        execFileSync(
          'npm',
          [
            'pack',
            `${coordinates.packageName}@${coordinates.version}`,
            '--json',
            '--ignore-scripts',
            '--pack-destination',
            registryDirectory,
            '--registry',
            'https://registry.npmjs.org',
          ],
          {
            cwd: coordinates.repositoryRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      )
      break
    } catch (error) {
      if (attempt === 15) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000)
    }
  }
  if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== 'string') {
    throw new Error('Registry comparison did not produce exactly one tarball.')
  }
  const registryTarball = join(registryDirectory, packed[0].filename)
  if (packed[0].filename !== coordinates.files.tarball) {
    throw new Error('Registry comparison returned an unexpected tarball filename.')
  }
  if (!readFileSync(registryTarball).equals(readFileSync(coordinates.paths.tarball))) {
    throw new Error(`Registry bytes differ for ${coordinates.packageName}@${coordinates.version}.`)
  }
  console.log(`Registry bytes match ${coordinates.packageName}@${coordinates.version}.`)
} finally {
  rmSync(scratch, { force: true, recursive: true })
}
