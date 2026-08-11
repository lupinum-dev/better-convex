import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { buildAndPackReleaseTarball } from './pack-release-tarball.mjs'

const defaultRepositoryRoot = resolve(import.meta.dirname, '..')

export function withReleasePreflightTarballs(callback, options = {}) {
  const repositoryRoot = options.repositoryRoot ?? defaultRepositoryRoot
  const scratchDirectory = mkdtempSync(join(tmpdir(), 'bcn-release-preflight-'))
  try {
    const tarballs = Object.freeze(
      Object.fromEntries(
        ['vue', 'nuxt', 'mcp'].map((packageId) => {
          const packed = buildAndPackReleaseTarball(packageId, scratchDirectory, {
            repositoryRoot,
          })
          return [packageId, packed.tarballPath]
        }),
      ),
    )
    return callback(tarballs)
  } finally {
    rmSync(scratchDirectory, { force: true, recursive: true })
  }
}
