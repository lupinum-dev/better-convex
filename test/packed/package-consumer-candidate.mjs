import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Reads a packed tarball's manifest and checks that a consumer installed that tarball. */
export function inspectConsumerCandidate({ packageName, tarballPath }) {
  if (!existsSync(tarballPath)) throw new Error(`Tarball is missing: ${tarballPath}`)
  const manifest = JSON.parse(
    execFileSync('tar', ['-xOzf', tarballPath, 'package/package.json'], { encoding: 'utf8' }),
  )
  if (manifest.name !== packageName) {
    throw new Error(`Tarball contains ${String(manifest.name)}, expected ${packageName}`)
  }
  return Object.freeze({
    manifest,
    tarballPath,
    assertInstalled(installedDirectory) {
      const installed = JSON.parse(readFileSync(join(installedDirectory, 'package.json'), 'utf8'))
      if (installed.name !== manifest.name || installed.version !== manifest.version) {
        throw new Error(
          `${installedDirectory} is not the packed ${packageName}@${manifest.version}`,
        )
      }
    },
  })
}
