import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import * as tar from 'tar'
import { describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'

import {
  assertCandidateAppLocksBindArtifact,
  assertCandidateRegistryTime,
  candidateAppInstallArgs,
  candidateAppLockProfiles,
  createCandidateRegistryMetadata,
  packageArtifactIdentity,
} from '../../scripts/candidate-app-locks.mjs'
import { getMaintainedCandidateProfile } from '../../scripts/maintained-candidate-apps.mjs'
import { getPackageArtifactCoordinates } from '../../scripts/package-artifact-coordinates.mjs'

const root = resolve(import.meta.dirname, '../..')
const rootPackageManager = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
).packageManager

function currentArtifact(packageId: 'mcp' | 'nuxt' | 'vue') {
  const coordinates = getPackageArtifactCoordinates(packageId)
  const profile = candidateAppLockProfiles.find((entry) => entry.packageIds.includes(packageId))
  if (!profile) throw new Error(`Missing ${packageId} lock profile`)
  const lock = parse(readFileSync(join(root, profile.directory, 'pnpm-lock.yaml'), 'utf8')) as {
    packages: Record<string, { resolution: { integrity: string } }>
  }
  const key = `${coordinates.packageName}@${coordinates.version}`
  return packageArtifactIdentity(
    packageId,
    coordinates.version,
    lock.packages[key]!.resolution.integrity,
  )
}

function copyLocks(destination: string) {
  for (const profile of candidateAppLockProfiles) {
    const relativePath = join(profile.directory, 'pnpm-lock.yaml')
    const output = join(destination, relativePath)
    mkdirSync(dirname(output), { recursive: true })
    copyFileSync(join(root, relativePath), output)
  }
}

it('emits complete publication times for local candidate registry metadata', () => {
  const version = '1.2.3'
  const metadata = JSON.parse(
    JSON.stringify(
      createCandidateRegistryMetadata({
        integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
        packageJson: { name: '@lupinum/example', version },
        registry: 'http://127.0.0.1:4873/',
        tarballPathname: '/@lupinum/example/-/example-1.2.3.tgz',
      }),
    ),
  )

  expect(metadata.time).toEqual({
    created: '2000-01-01T00:00:00.000Z',
    modified: '2000-01-01T00:00:00.000Z',
    [version]: '2000-01-01T00:00:00.000Z',
  })
  expect(() => assertCandidateRegistryTime(metadata, version)).not.toThrow()

  metadata.time[version] = undefined
  expect(() => assertCandidateRegistryTime(metadata, version)).toThrow(
    'Candidate registry metadata has invalid publication time for 1.2.3.',
  )
})

function writeCandidateTarball(
  directory: string,
  packageId: 'mcp' | 'nuxt' | 'vue',
  placeholder = false,
) {
  const coordinates = getPackageArtifactCoordinates(packageId)
  const packageRoot = join(directory, packageId, 'package')
  mkdirSync(packageRoot, { recursive: true })
  copyFileSync(coordinates.manifestPath, join(packageRoot, 'package.json'))
  if (packageId === 'nuxt') {
    mkdirSync(join(packageRoot, 'dist/runtime/shared'), { recursive: true })
    writeFileSync(
      join(packageRoot, 'dist/runtime/shared/release-fingerprint.js'),
      `const value = '${placeholder ? '__BCN_RELEASE_RUNTIME_FINGERPRINT__' : 'missing'}'\n`,
    )
    writeFileSync(
      join(packageRoot, 'dist/module.mjs'),
      "import { getPackedRuntimeFingerprint } from '../dist/runtime/shared/release-fingerprint.js'\n",
    )
  }
  const output = join(directory, `${packageId}.tgz`)
  tar.c(
    {
      cwd: join(directory, packageId),
      file: output,
      gzip: true,
      noDirRecurse: true,
      portable: true,
      strict: true,
      sync: true,
    },
    packageId === 'nuxt'
      ? [
          'package/dist/module.mjs',
          'package/dist/runtime/shared/release-fingerprint.js',
          'package/package.json',
        ]
      : ['package/package.json'],
  )
  return output
}

describe('candidate app lock contract', () => {
  it('derives all maintained starters and adds only the standalone demo', () => {
    const maintained = getMaintainedCandidateProfile('nuxt').profile.pnpmApps.map(
      (entry: { path: string }) => entry.path,
    )
    expect(candidateAppLockProfiles.map((profile) => profile.directory)).toEqual([
      'demo',
      ...maintained,
    ])
    expect(candidateAppLockProfiles).toMatchObject([
      {
        directory: 'demo',
        packageIds: ['nuxt', 'vue'],
        strictPeerDependencies: false,
      },
      { directory: 'starters/agency', packageIds: ['nuxt', 'vue'] },
      {
        directory: 'starters/mcp-oauth-agent',
        packageIds: ['nuxt', 'vue', 'mcp'],
      },
      { directory: 'starters/public', packageIds: ['nuxt', 'vue'] },
      { directory: 'starters/team', packageIds: ['nuxt', 'vue'] },
    ])
    expect(
      candidateAppLockProfiles.slice(1).every((profile) => profile.strictPeerDependencies),
    ).toBe(true)
    expect(JSON.parse(readFileSync(join(root, 'demo/package.json'), 'utf8')).packageManager).toBe(
      rootPackageManager,
    )
    expect(rootPackageManager).toMatch(/^pnpm@\d+\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/u)
    expect(
      candidateAppLockProfiles
        .slice(1)
        .every(
          ({ directory }) =>
            JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8'))
              .packageManager === rootPackageManager,
        ),
    ).toBe(true)

    const [demoProfile, ...starterProfiles] = candidateAppLockProfiles
    if (!demoProfile) throw new Error('Missing demo lock profile')
    for (const [frozen, baseArgs] of [
      [false, ['install', '--lockfile-only', '--no-frozen-lockfile', '--ignore-scripts']],
      [true, ['install', '--frozen-lockfile', '--ignore-scripts']],
    ] as const) {
      expect(candidateAppInstallArgs(demoProfile, frozen)).toEqual(baseArgs)
      for (const profile of starterProfiles) {
        expect(candidateAppInstallArgs(profile, frozen)).toEqual([
          ...baseArgs,
          '--strict-peer-dependencies',
        ])
      }
    }
  })

  it('rejects orphan package SRI blocks and broken direct or companion snapshots', () => {
    const nuxt = currentArtifact('nuxt')
    const vue = currentArtifact('vue')
    const mcp = currentArtifact('mcp')
    const fixture = mkdtempSync(join(tmpdir(), 'bcn-candidate-lock-graph-negative-'))
    try {
      copyLocks(fixture)
      const demoPath = join(fixture, 'demo/pnpm-lock.yaml')
      const demo = parse(readFileSync(demoPath, 'utf8'))
      demo.importers['.'].dependencies['@lupinum/better-convex-nuxt'].version = '9.9.9'
      writeFileSync(demoPath, stringify(demo))
      expect(() => assertCandidateAppLocksBindArtifact(nuxt, { repositoryRoot: fixture })).toThrow(
        'direct importer and exact snapshot',
      )

      copyFileSync(join(root, 'demo/pnpm-lock.yaml'), demoPath)
      const companion = parse(readFileSync(demoPath, 'utf8'))
      const nuxtResolution =
        companion.importers['.'].dependencies['@lupinum/better-convex-nuxt'].version
      companion.snapshots[`@lupinum/better-convex-nuxt@${nuxtResolution}`].dependencies[
        '@lupinum/better-convex-vue'
      ] = '9.9.9'
      writeFileSync(demoPath, stringify(companion))
      expect(() => assertCandidateAppLocksBindArtifact(vue, { repositoryRoot: fixture })).toThrow(
        'from the exact Nuxt snapshot',
      )

      copyFileSync(join(root, 'demo/pnpm-lock.yaml'), demoPath)
      const mcpPath = join(fixture, 'starters/mcp-oauth-agent/pnpm-lock.yaml')
      const mcpLock = parse(readFileSync(mcpPath, 'utf8'))
      mcpLock.importers['.'].dependencies['@lupinum/better-convex-mcp'].version = '9.9.9'
      writeFileSync(mcpPath, stringify(mcpLock))
      expect(() => assertCandidateAppLocksBindArtifact(mcp, { repositoryRoot: fixture })).toThrow(
        'direct importer and exact snapshot',
      )
    } finally {
      rmSync(fixture, { force: true, recursive: true })
    }
  }, 30_000)

  it('accepts the shared exact SRI and rejects one altered maintained lock', () => {
    const artifacts = ['mcp', 'nuxt', 'vue'].map((packageId) =>
      currentArtifact(packageId as 'mcp' | 'nuxt' | 'vue'),
    )
    for (const artifact of artifacts) {
      expect(
        assertCandidateAppLocksBindArtifact(artifact, { repositoryRoot: root }),
      ).toBeGreaterThan(0)
    }

    const fixture = mkdtempSync(join(tmpdir(), 'bcn-candidate-lock-negative-'))
    try {
      copyLocks(fixture)
      const nuxt = artifacts.find((artifact) => artifact.packageId === 'nuxt')!
      const demoLock = join(fixture, 'demo/pnpm-lock.yaml')
      writeFileSync(
        demoLock,
        readFileSync(demoLock, 'utf8').replace(
          nuxt.integrity,
          `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
        ),
      )
      expect(() => assertCandidateAppLocksBindArtifact(nuxt, { repositoryRoot: fixture })).toThrow(
        'does not bind @lupinum/better-convex-nuxt@',
      )
    } finally {
      rmSync(fixture, { force: true, recursive: true })
    }
  }, 30_000)

  it('rejects an ordinary placeholder Nuxt pack before registry or lock work', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'bcn-candidate-lock-tarballs-'))
    try {
      const nuxt = writeCandidateTarball(fixture, 'nuxt', true)
      const vue = writeCandidateTarball(fixture, 'vue')
      const mcp = writeCandidateTarball(fixture, 'mcp')
      const result = spawnSync(
        process.execPath,
        [
          'scripts/update-candidate-app-locks.mjs',
          '--tarball',
          nuxt,
          '--vue-tarball',
          vue,
          '--mcp-tarball',
          mcp,
          '--check',
        ],
        { cwd: root, encoding: 'utf8' },
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'Artifact runtime fingerprint is not bound to packed dist/runtime/shared/release-fingerprint.js',
      )
    } finally {
      rmSync(fixture, { force: true, recursive: true })
    }
  })
})
