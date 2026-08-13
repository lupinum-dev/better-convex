import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { getPackageArtifactCoordinates } from '../../scripts/package-artifact-coordinates.mjs'
import { packageArtifactEvidenceSchemaVersion } from '../../scripts/package-artifact-evidence.mjs'
import {
  candidateSetSchemaVersion,
  createCandidateSetEvidence,
  getCandidateSetCoordinates,
  parseCandidateSetEvidence,
} from '../../scripts/package-candidate-set.mjs'

const temporaryDirectories: string[] = []
const sourceCommit = 'a'.repeat(40)
const integrity = `sha512-${Buffer.alloc(64).toString('base64')}`

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createRepository(version = '0.8.0-beta.40') {
  const root = mkdtempSync(join(tmpdir(), 'bcn-candidate-set-'))
  temporaryDirectories.push(root)
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({
      name: '@lupinum/better-convex-nuxt',
      repository: {
        type: 'git',
        url: 'https://github.com/lupinum-dev/better-convex',
      },
      version,
    })}\n`,
  )
  mkdirSync(join(root, 'packages/vue'), { recursive: true })
  writeFileSync(
    join(root, 'packages/vue/package.json'),
    `${JSON.stringify({
      name: '@lupinum/better-convex-vue',
      repository: {
        type: 'git',
        url: 'https://github.com/lupinum-dev/better-convex',
      },
      version,
    })}\n`,
  )
  for (const packageId of ['vue', 'nuxt'] as const) {
    const coordinates = getPackageArtifactCoordinates(packageId, {
      repositoryRoot: root,
    })
    const evidencePath = coordinates.paths.evidence
    if (!evidencePath) throw new Error(`Missing ${packageId} evidence coordinate`)
    mkdirSync(dirname(evidencePath), { recursive: true })
    writeFileSync(
      evidencePath,
      `${JSON.stringify({
        schemaVersion: packageArtifactEvidenceSchemaVersion,
        packageId: coordinates.packageId,
        packageName: coordinates.packageName,
        packageDirectory: coordinates.packageDirectory,
        version,
        profiles: coordinates.profiles,
        sourceCommit,
        packageManager: 'pnpm@10.30.3',
        node: 'v24.18.0',
        npm: '11.6.2',
        pnpm: '10.30.3',
        sourceTree: 'clean',
        runtimeFingerprint: packageId === 'nuxt' ? `bcn-release-v1-${'0'.repeat(64)}` : null,
        tarball: {
          file: coordinates.files.tarball,
          bytes: 1,
          sha256: packageId === 'nuxt' ? '1'.repeat(64) : '2'.repeat(64),
          integrity,
        },
        contents: {
          file: coordinates.files.contents,
          bytes: 1,
          sha256: '3'.repeat(64),
        },
        sbom: {
          file: coordinates.files.sbom,
          bytes: 1,
          sha256: '4'.repeat(64),
        },
      })}\n`,
    )
  }
  return root
}

describe('package candidate set', () => {
  it('prints only the closed artifact root and reviewed Vue/Nuxt coordinates', () => {
    const result = spawnSync(process.execPath, ['scripts/print-candidate-set-coordinates.mjs'], {
      cwd: resolve(import.meta.dirname, '../..'),
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('artifact_name=release-candidate-vue-nuxt-set\n')
    expect(result.stdout).toContain('directory=.release-artifacts\n')
    expect(result.stdout).toContain('vue_directory=.release-artifacts/vue/')
    expect(result.stdout).toContain('nuxt_directory=.release-artifacts/nuxt/')
    expect(result.stdout).toContain('set_directory=.release-artifacts/set/')

    const rejected = spawnSync(
      process.execPath,
      ['scripts/print-candidate-set-coordinates.mjs', '--path', '../unreviewed'],
      { cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf8' },
    )
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain('Usage: print-candidate-set-coordinates')
  })

  it('binds the fixed Vue-first pair to one commit, version, and package manager', () => {
    const root = createRepository()
    const evidence = createCandidateSetEvidence(root)

    expect(evidence).toMatchObject({
      schemaVersion: candidateSetSchemaVersion,
      sourceCommit,
      version: '0.8.0-beta.40',
      packageManager: 'pnpm@10.30.3',
    })
    expect(evidence.packages.map((entry) => entry.packageId)).toEqual(['vue', 'nuxt'])
    expect(parseCandidateSetEvidence(evidence, root)).toEqual(evidence)
    expect(getCandidateSetCoordinates(root).manifest).toBe(
      join(realpathSync(root), '.release-artifacts/set/0.8.0-beta.40/artifact-set.json'),
    )
  })

  it('rejects reordered, path-selected, or extended package-set evidence', () => {
    const root = createRepository()
    const evidence = createCandidateSetEvidence(root)
    const mutations = [
      { ...evidence, packages: [...evidence.packages].reverse() },
      {
        ...evidence,
        packages: evidence.packages.map((entry, index) =>
          index === 0 ? { ...entry, tarball: '../outside.tgz' } : entry,
        ),
      },
      { ...evidence, unreviewed: true },
    ]

    for (const mutation of mutations) {
      expect(() => parseCandidateSetEvidence(mutation, root)).toThrow(
        'does not match the reviewed package artifacts',
      )
    }
  })

  it('rejects package version drift before creating set coordinates', () => {
    const root = createRepository()
    writeFileSync(
      join(root, 'packages/vue/package.json'),
      `${JSON.stringify({
        name: '@lupinum/better-convex-vue',
        repository: {
          type: 'git',
          url: 'https://github.com/lupinum-dev/better-convex',
        },
        version: '0.8.0-beta.41',
      })}\n`,
    )

    expect(() => getCandidateSetCoordinates(root)).toThrow('must use one exact version')
  })
})
