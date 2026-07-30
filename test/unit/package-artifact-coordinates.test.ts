import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertPackageArtifactWriteTarget,
  assertPackageManifestMatchesCommit,
  assertReleaseEligiblePackageVersion,
  canonicalNpmTarballFilename,
  getPackageArtifactCoordinates,
  validatePackageArtifactVersion,
} from '../../scripts/package-artifact-coordinates.mjs'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'bcn-artifact-coordinates-'))
  temporaryDirectories.push(root)
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'better-convex-nuxt', version: '0.8.0-beta.27' })}\n`,
  )
  return root
}

describe('package artifact coordinates', () => {
  it.each([
    ['better-convex-nuxt', '0.8.0-beta.0'],
    ['better-convex-nuxt', '0.8.0-beta.15'],
    ['better-convex-nuxt', '0.8.0-beta.20'],
    ['better-convex-vue', '0.8.0-beta.20'],
    ['better-convex-mcp', '0.1.0-beta.0'],
    ['better-convex-mcp', '0.1.0-beta.8'],
  ])('rejects every identity below the release floor for %s@%s', (packageName, version) => {
    expect(() => assertReleaseEligiblePackageVersion(packageName, version)).toThrow(
      'predates the minimum releasable version',
    )
  })

  it('accepts the release floor, successors, and unrelated package versions', () => {
    expect(assertReleaseEligiblePackageVersion('better-convex-nuxt', '0.8.0-beta.27')).toBe(
      '0.8.0-beta.27',
    )
    expect(assertReleaseEligiblePackageVersion('better-convex-vue', '0.8.0-beta.27')).toBe(
      '0.8.0-beta.27',
    )
    expect(assertReleaseEligiblePackageVersion('better-convex-mcp', '0.1.0-beta.15')).toBe(
      '0.1.0-beta.15',
    )
    expect(assertReleaseEligiblePackageVersion('better-convex-mcp', '0.1.0')).toBe('0.1.0')
    expect(assertReleaseEligiblePackageVersion('unrelated-package', '0.8.0-beta.6')).toBe(
      '0.8.0-beta.6',
    )
  })

  it('resolves the root Nuxt package to one qualified immutable directory', () => {
    const root = createRepository()
    const coordinates = getPackageArtifactCoordinates('nuxt', {
      repositoryRoot: root,
    })

    expect(coordinates).toMatchObject({
      packageId: 'nuxt',
      packageName: 'better-convex-nuxt',
      packageDirectory: '.',
      profiles: {
        build: 'nuxt-module-build',
        exports: 'nuxt-public-entries',
        packedFiles: 'nuxt-runtime-artifact',
        sbom: 'nuxt-production-dependencies',
        provenance: 'nuxt-auth-upstream',
        candidateTests: 'nuxt-maintained-consumers',
        runtimeFingerprint: 'nuxt-runtime-binding',
      },
      version: '0.8.0-beta.27',
      relativeDirectory: '.release-artifacts/nuxt/0.8.0-beta.27',
      files: {
        contents: 'contents.json',
        evidence: 'artifact.json',
        sbom: 'sbom.cdx.json',
        tarball: 'better-convex-nuxt-0.8.0-beta.27.tgz',
      },
    })
    expect(coordinates.relativePaths).toEqual({
      contents: '.release-artifacts/nuxt/0.8.0-beta.27/contents.json',
      evidence: '.release-artifacts/nuxt/0.8.0-beta.27/artifact.json',
      sbom: '.release-artifacts/nuxt/0.8.0-beta.27/sbom.cdx.json',
      tarball: '.release-artifacts/nuxt/0.8.0-beta.27/better-convex-nuxt-0.8.0-beta.27.tgz',
    })
    expect(new Set(Object.values(coordinates.paths)).size).toBe(4)
    for (const path of Object.values(coordinates.paths)) {
      const fromRoot = relative(coordinates.repositoryRoot, path)
      expect(isAbsolute(fromRoot)).toBe(false)
      expect(fromRoot.split(/[\\/]/u)).not.toContain('..')
      expect(dirname(path)).toBe(coordinates.directory)
    }
    expect(Object.isFrozen(coordinates)).toBe(true)
    expect(Object.isFrozen(coordinates.profiles)).toBe(true)
    expect(Object.isFrozen(coordinates.files)).toBe(true)
    expect(Object.isFrozen(coordinates.paths)).toBe(true)
    expect(Object.isFrozen(coordinates.relativePaths)).toBe(true)
  })

  it.each([
    'better-convex-nuxt',
    'NUXT',
    '.',
    './nuxt',
    '../nuxt',
    'packages/nuxt',
    'nuxt/..',
    'nuxt\\..',
    '%2e%2e',
  ])('rejects unknown or path-like selector %j', (selector) => {
    expect(() => getPackageArtifactCoordinates(selector)).toThrow(
      `Unknown package certification descriptor: ${selector}`,
    )
  })

  it.each(['0.0.0', '1.2.3', '0.7.0-beta.1', '1.0.0-rc.1', '1.0.0-alpha-1', '1.0.0-0A'])(
    'accepts canonical package version %j',
    (version) => {
      expect(validatePackageArtifactVersion(version)).toBe(version)
    },
  )

  it.each([
    undefined,
    null,
    1,
    '',
    'v1.0.0',
    '01.0.0',
    '1.01.0',
    '1.0.01',
    '1.0',
    '1.0.0.0',
    '1.0.0-',
    '1.0.0-alpha..1',
    '1.0.0-01',
    '1.0.0+build',
    ' 1.0.0',
    '1.0.0\n',
    '1.0.0/../../outside',
    '1.0.0\\outside',
  ])('rejects unsafe or noncanonical package version %j', (version) => {
    expect(() => validatePackageArtifactVersion(version)).toThrow('Invalid package version')
  })

  it('rejects a version that cannot fit a filesystem component or tarball basename', () => {
    expect(() => validatePackageArtifactVersion(`1.0.0-${'a'.repeat(256)}`)).toThrow(
      'Invalid package version',
    )
    expect(() =>
      canonicalNpmTarballFilename('better-convex-nuxt', `1.0.0-${'a'.repeat(230)}`),
    ).toThrow('Invalid npm tarball filename')
  })

  it('derives npm canonical tarball basenames without using them as package directories', () => {
    expect(canonicalNpmTarballFilename('better-convex-mcp', '1.2.3-beta.4')).toBe(
      'better-convex-mcp-1.2.3-beta.4.tgz',
    )
    expect(canonicalNpmTarballFilename('better-convex-vue', '1.0.0-RC.1')).toBe(
      'better-convex-vue-1.0.0-RC.1.tgz',
    )
    expect(canonicalNpmTarballFilename('@scope/name', '1.0.0')).toBe(
      canonicalNpmTarballFilename('scope-name', '1.0.0'),
    )
    expect(join('mcp', canonicalNpmTarballFilename('@scope/name', '1.0.0'))).not.toBe(
      join('legacy-mcp', canonicalNpmTarballFilename('scope-name', '1.0.0')),
    )
  })

  it('preserves sibling and legacy artifacts and rejects an existing immutable target', () => {
    const root = createRepository()
    const coordinates = getPackageArtifactCoordinates('nuxt', {
      repositoryRoot: root,
    })
    const sibling = join(root, '.release-artifacts', 'vue', '1.0.0', 'sentinel')
    const legacy = join(root, '.release-artifacts', 'v0.7.0-beta.1.artifact.json')
    mkdirSync(dirname(sibling), { recursive: true })
    writeFileSync(sibling, 'vue-candidate')
    writeFileSync(legacy, 'immutable-beta-evidence')

    expect(assertPackageArtifactWriteTarget('nuxt', { repositoryRoot: root })).toEqual(coordinates)
    expect(readFileSync(sibling, 'utf8')).toBe('vue-candidate')
    expect(readFileSync(legacy, 'utf8')).toBe('immutable-beta-evidence')

    mkdirSync(coordinates.directory, { recursive: true })
    expect(() => assertPackageArtifactWriteTarget('nuxt', { repositoryRoot: root })).toThrow(
      'already exists',
    )
  })

  it.each(['artifact-root', 'package-root'])('rejects a %s symlink alias', (location) => {
    const root = createRepository()
    const outside = mkdtempSync(join(tmpdir(), 'bcn-artifact-outside-'))
    temporaryDirectories.push(outside)
    const artifactRoot = join(root, '.release-artifacts')
    if (location === 'artifact-root') {
      symlinkSync(outside, artifactRoot)
    } else {
      mkdirSync(artifactRoot)
      symlinkSync(outside, join(artifactRoot, 'nuxt'))
    }
    expect(() => assertPackageArtifactWriteTarget('nuxt', { repositoryRoot: root })).toThrow(
      'must be a real directory, not a symlink',
    )
  })

  it('rejects a dangling symlink at the immutable package-version coordinate', () => {
    const root = createRepository()
    const coordinates = getPackageArtifactCoordinates('nuxt', {
      repositoryRoot: root,
    })
    mkdirSync(coordinates.packageArtifactDirectory, { recursive: true })
    symlinkSync(join(root, 'missing-target'), coordinates.directory)

    expect(() => assertPackageArtifactWriteTarget('nuxt', { repositoryRoot: root })).toThrow(
      'already exists',
    )
  })

  it('rejects a regular file in the artifact directory chain', () => {
    const root = createRepository()
    writeFileSync(join(root, '.release-artifacts'), 'not a directory')
    expect(() => assertPackageArtifactWriteTarget('nuxt', { repositoryRoot: root })).toThrow(
      'must be a real directory',
    )
  })

  it('binds the reviewed package manifest to exact committed bytes', () => {
    const root = createRepository()
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    execFileSync('git', ['add', 'package.json'], { cwd: root })
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Better Convex Tests',
        '-c',
        'user.email=tests@better-convex.invalid',
        'commit',
        '--quiet',
        '-m',
        'test fixture',
      ],
      { cwd: root },
    )
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()

    expect(() =>
      assertPackageManifestMatchesCommit('nuxt', commit, {
        repositoryRoot: root,
      }),
    ).not.toThrow()
    writeFileSync(
      join(root, 'package.json'),
      `${readFileSync(join(root, 'package.json'), 'utf8')}\n`,
    )
    expect(() =>
      assertPackageManifestMatchesCommit('nuxt', commit, {
        repositoryRoot: root,
      }),
    ).toThrow('manifest bytes do not match the source commit')
    expect(() =>
      assertPackageManifestMatchesCommit('nuxt', 'not-a-commit', {
        repositoryRoot: root,
      }),
    ).toThrow('must be a full lowercase Git SHA')
  })
})
