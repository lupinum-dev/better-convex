import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { buildDirectoryContentIdentity, packAndExtract } from './package-check/tarball.mjs'

function contentIdentity({ version, files }) {
  return {
    version,
    files: files
      .filter(({ path }) => path !== 'node_modules' && !path.startsWith('node_modules/'))
      .map(({ path, size, sha256 }) => ({ path, size, sha256 })),
  }
}

/** Closed exact-tarball helper for maintained production consumers. */
export function inspectConsumerCandidate({ packageId, packageName, tarballPath }) {
  if (!existsSync(tarballPath)) throw new Error(`Candidate tarball is missing: ${tarballPath}`)
  const stats = lstatSync(tarballPath)
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Candidate tarball must be one regular file, not a symlink')
  }

  const extracted = packAndExtract(packageId, tarballPath)
  const expected = contentIdentity(buildDirectoryContentIdentity(extracted.packageDir))
  const manifest = JSON.parse(readFileSync(join(extracted.packageDir, 'package.json'), 'utf8'))
  if (manifest.name !== packageName) {
    rmSync(extracted.scratchDir, { force: true, recursive: true })
    throw new Error(`Candidate has unexpected package name: ${String(manifest.name)}`)
  }

  return Object.freeze({
    manifest,
    tarballPath,
    assertInstalled(installedDirectory) {
      const actual = contentIdentity(buildDirectoryContentIdentity(installedDirectory))
      if (JSON.stringify(actual) === JSON.stringify(expected)) return
      const actualFiles = new Map(actual.files.map((file) => [file.path, file]))
      const expectedFiles = new Map(expected.files.map((file) => [file.path, file]))
      const changedPaths = [...new Set([...actualFiles.keys(), ...expectedFiles.keys()])].filter(
        (path) => JSON.stringify(actualFiles.get(path)) !== JSON.stringify(expectedFiles.get(path)),
      )
      throw new Error(`Installed ${packageName} bytes differ: ${changedPaths.join(', ')}`)
    },
    cleanup() {
      rmSync(extracted.scratchDir, { force: true, recursive: true })
    },
  })
}
