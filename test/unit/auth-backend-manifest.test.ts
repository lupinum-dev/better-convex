import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  loadBackendManifest,
  selectBackendArtifact,
  validateBackendManifest,
  verifyBackendBinary,
} from '../../scripts/check-auth-backend.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('local Convex backend manifest', () => {
  it('pins the release backend for Darwin development and Linux CI', async () => {
    const manifest = await loadBackendManifest()

    expect(manifest).toMatchObject({
      backendVersion: 'precompiled-2026-07-06-44f7aa7',
      convexVersion: '1.42.2',
      schemaVersion: 1,
    })
    expect(selectBackendArtifact(manifest, 'darwin', 'arm64').sha256).toBe(
      '3d28873cf24019877146367c539104d54a05a9b8ec1b501e503077474c84415d',
    )
    expect(selectBackendArtifact(manifest, 'darwin', 'arm64').archiveSha256).toBe(
      '764f2f430b3de5b4debe7a613529d2531ccfd125d22b269c8e3664807f318d5d',
    )
    expect(selectBackendArtifact(manifest, 'linux', 'x64').sha256).toBe(
      '162b0e7f1128991ed115b2a9e608bfd0c631198f66c95f3c15303680ec2297a0',
    )
    expect(selectBackendArtifact(manifest, 'linux', 'x64').archiveSha256).toBe(
      '704f08b3b46d6aef371767b3ed59d5dad89b280e102216d59b7891bb5b033d53',
    )
  })

  it('rejects duplicate platform records and tuple drift', async () => {
    const manifest = await loadBackendManifest()
    const duplicate = {
      ...manifest,
      artifacts: [...manifest.artifacts, manifest.artifacts[0]],
    }

    expect(() =>
      validateBackendManifest(duplicate, {
        devDependencies: { convex: '1.42.2' },
        peerDependencies: { convex: '1.42.2' },
      }),
    ).toThrow('duplicate artifact')
    expect(() =>
      validateBackendManifest(manifest, {
        devDependencies: { convex: '1.42.3' },
        peerDependencies: { convex: '1.42.3' },
      }),
    ).toThrow('must equal the exact peer and development dependency')
    expect(() =>
      validateBackendManifest(
        {
          ...manifest,
          artifacts: [{ ...manifest.artifacts[0], archiveSha256: 'not-reviewed' }],
        },
        {
          devDependencies: { convex: '1.42.2' },
          peerDependencies: { convex: '1.42.2' },
        },
      ),
    ).toThrow('invalid archive SHA-256')
  })

  it('fails closed when the cached binary does not match the reviewed digest', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'bcn-backend-manifest-'))
    temporaryDirectories.push(directory)
    const filename = path.join(directory, 'convex-local-backend')
    await writeFile(filename, 'not the reviewed backend')
    const manifest = await loadBackendManifest()

    await expect(
      verifyBackendBinary(manifest, { arch: 'arm64', filename, platform: 'darwin' }),
    ).rejects.toThrow('SHA-256 mismatch')
  })

  it('directs a clean machine to the verified installer instead of executing an unreviewed cache', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'bcn-backend-missing-'))
    temporaryDirectories.push(directory)
    const manifest = await loadBackendManifest()

    await expect(
      verifyBackendBinary(manifest, {
        arch: 'arm64',
        filename: path.join(directory, 'missing-backend'),
        platform: 'darwin',
      }),
    ).rejects.toThrow('pnpm check:auth-backend --install')
  })
})
