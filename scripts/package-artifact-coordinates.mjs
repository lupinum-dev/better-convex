import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getPackageCertificationDescriptor } from './package-certification-manifest.mjs'

const defaultRepositoryRoot = realpathSync(resolve(fileURLToPath(new URL('..', import.meta.url))))
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const numericVersionIdentifierPattern = /^(?:0|[1-9]\d*)$/u
const prereleaseIdentifierPattern = /^[0-9A-Za-z-]+$/u
const numericPrereleaseIdentifierPattern = /^\d+$/u
const safeFilenamePattern = /^[\dA-Za-z][\w.-]*$/u
const maximumFilesystemComponentBytes = 255
const maximumNpmPackageNameBytes = 214
const fullGitCommitPattern = /^[0-9a-f]{40}$/u
const retiredUnpublishedVersions = Object.freeze({
  '@better-convex/mcp': Object.freeze([
    '0.1.0-beta.0',
    '0.1.0-beta.1',
    '0.1.0-beta.2',
    '0.1.0-beta.3',
    '0.1.0-beta.4',
    '0.1.0-beta.5',
    '0.1.0-beta.6',
  ]),
  'better-convex-nuxt': Object.freeze([
    '0.8.0-beta.6',
    '0.8.0-beta.7',
    '0.8.0-beta.8',
    '0.8.0-beta.9',
    '0.8.0-beta.10',
    '0.8.0-beta.11',
    '0.8.0-beta.12',
    '0.8.0-beta.13',
    '0.8.0-beta.14',
    '0.8.0-beta.16',
    '0.8.0-beta.17',
    '0.8.0-beta.18',
  ]),
  'better-convex-vue': Object.freeze([
    '0.8.0-beta.6',
    '0.8.0-beta.7',
    '0.8.0-beta.8',
    '0.8.0-beta.9',
    '0.8.0-beta.10',
    '0.8.0-beta.11',
    '0.8.0-beta.12',
    '0.8.0-beta.13',
    '0.8.0-beta.14',
    '0.8.0-beta.16',
    '0.8.0-beta.17',
    '0.8.0-beta.18',
  ]),
})

/**
 * Resolve one reviewed package to its only release-artifact location.
 * Callers select a closed descriptor ID; no path, package name, version, or
 * artifact root is accepted from CI or artifact evidence.
 */
export function getPackageArtifactCoordinates(
  packageId,
  { repositoryRoot = defaultRepositoryRoot } = {},
) {
  const root = resolveRealDirectory(repositoryRoot, 'Repository root')
  const descriptor = getPackageCertificationDescriptor(packageId, {
    repositoryRoot: root,
  })
  const sourceDirectory = resolve(root, descriptor.packageDirectory)
  const manifestPath = join(sourceDirectory, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const version = validatePackageArtifactVersion(manifest.version)
  assertReleaseEligiblePackageVersion(descriptor.packageName, version)
  const files = Object.freeze({
    contents: 'contents.json',
    evidence: 'artifact.json',
    sbom: 'sbom.cdx.json',
    tarball: canonicalNpmTarballFilename(descriptor.packageName, version),
  })
  assertUniqueSafeFilenames(Object.values(files))

  const relativeDirectory = posix.join('.release-artifacts', descriptor.id, version)
  const artifactRoot = resolve(root, '.release-artifacts')
  const packageArtifactDirectory = resolve(artifactRoot, descriptor.id)
  const directory = resolve(packageArtifactDirectory, version)
  assertContained(root, artifactRoot, 'Artifact root')
  assertContained(artifactRoot, packageArtifactDirectory, 'Package artifact directory')
  assertContained(packageArtifactDirectory, directory, 'Package version artifact directory')

  const relativePaths = Object.freeze(
    Object.fromEntries(
      Object.entries(files).map(([kind, filename]) => [
        kind,
        posix.join(relativeDirectory, filename),
      ]),
    ),
  )
  const paths = Object.freeze(
    Object.fromEntries(
      Object.entries(files).map(([kind, filename]) => [kind, resolve(directory, filename)]),
    ),
  )
  if (new Set(Object.values(paths)).size !== Object.keys(paths).length) {
    throw new Error('Package artifact coordinates contain duplicate output paths.')
  }

  return Object.freeze({
    packageId: descriptor.id,
    packageName: descriptor.packageName,
    packageDirectory: descriptor.packageDirectory,
    profiles: descriptor.profiles,
    version,
    repositoryRoot: root,
    sourceDirectory,
    manifestPath,
    artifactRoot,
    packageArtifactDirectory,
    directory,
    relativeDirectory,
    files,
    paths,
    relativePaths,
  })
}

export function validatePackageArtifactVersion(version) {
  if (
    typeof version !== 'string' ||
    Buffer.byteLength(version) > maximumFilesystemComponentBytes ||
    !isCanonicalSemverWithoutBuildMetadata(version)
  ) {
    throw new TypeError(`Invalid package version for artifact coordinates: ${String(version)}`)
  }
  return version
}

/** Reject source identities retired by an explicit stabilization decision. */
export function assertReleaseEligiblePackageVersion(packageName, version) {
  const retiredVersions = retiredUnpublishedVersions[packageName] ?? []
  if (retiredVersions.includes(version)) {
    throw new Error(
      `${packageName}@${version} is a retired unpublished source identity and cannot produce an artifact.`,
    )
  }
  return version
}

function isCanonicalSemverWithoutBuildMetadata(version) {
  const prereleaseSeparator = version.indexOf('-')
  const core = prereleaseSeparator === -1 ? version : version.slice(0, prereleaseSeparator)
  const prerelease = prereleaseSeparator === -1 ? undefined : version.slice(prereleaseSeparator + 1)
  const coreIdentifiers = core.split('.')
  if (
    coreIdentifiers.length !== 3 ||
    !coreIdentifiers.every((identifier) => numericVersionIdentifierPattern.test(identifier))
  ) {
    return false
  }
  if (prerelease === undefined) return true
  const identifiers = prerelease.split('.')
  return identifiers.every(
    (identifier) =>
      prereleaseIdentifierPattern.test(identifier) &&
      (!numericPrereleaseIdentifierPattern.test(identifier) ||
        numericVersionIdentifierPattern.test(identifier)),
  )
}

export function canonicalNpmTarballFilename(packageName, version) {
  if (
    typeof packageName !== 'string' ||
    Buffer.byteLength(packageName) > maximumNpmPackageNameBytes ||
    !packageNamePattern.test(packageName)
  ) {
    throw new TypeError(`Invalid npm package name for artifact filename: ${String(packageName)}`)
  }
  const canonicalVersion = validatePackageArtifactVersion(version)
  const packageStem = packageName.startsWith('@')
    ? packageName.slice(1).replace('/', '-')
    : packageName
  const filename = `${packageStem}-${canonicalVersion}.tgz`
  if (
    basename(filename) !== filename ||
    !safeFilenamePattern.test(filename) ||
    Buffer.byteLength(filename) > maximumFilesystemComponentBytes
  ) {
    throw new TypeError(`Invalid npm tarball filename: ${filename}`)
  }
  return filename
}

/**
 * Fail before a release writes or removes anything if an artifact ancestor is
 * aliased or if this immutable package/version coordinate already exists.
 */
export function assertPackageArtifactWriteTarget(
  packageId,
  { repositoryRoot = defaultRepositoryRoot } = {},
) {
  const coordinates = getPackageArtifactCoordinates(packageId, {
    repositoryRoot,
  })
  for (const [label, path] of [
    ['Artifact root', coordinates.artifactRoot],
    ['Package artifact directory', coordinates.packageArtifactDirectory],
  ]) {
    const stats = lstatIfPresent(path)
    if (!stats) continue
    if (stats.isSymbolicLink()) {
      throw new Error(`${label} must be a real directory, not a symlink: ${path}`)
    }
    if (!stats.isDirectory() || realpathSync(path) !== path) {
      throw new Error(`${label} must be a real directory: ${path}`)
    }
  }
  if (lstatIfPresent(coordinates.directory)) {
    throw new Error(`Immutable package artifact directory already exists: ${coordinates.directory}`)
  }
  return coordinates
}

/** Require the reviewed package and workspace manifests to match one Git commit exactly. */
export function assertPackageManifestMatchesCommit(
  packageId,
  commit,
  { repositoryRoot = defaultRepositoryRoot } = {},
) {
  if (typeof commit !== 'string' || !fullGitCommitPattern.test(commit)) {
    throw new TypeError('Package artifact source commit must be a full lowercase Git SHA.')
  }
  const coordinates = getPackageArtifactCoordinates(packageId, {
    repositoryRoot,
  })
  const gitManifestPath =
    coordinates.packageDirectory === '.'
      ? 'package.json'
      : `${coordinates.packageDirectory}/package.json`
  for (const relativeManifestPath of new Set(['package.json', gitManifestPath])) {
    let committedManifest
    try {
      committedManifest = execFileSync('git', ['show', `${commit}:${relativeManifestPath}`], {
        cwd: coordinates.repositoryRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      throw new Error('Reviewed package manifest cannot be read from the source commit.')
    }
    if (
      readFileSync(join(coordinates.repositoryRoot, relativeManifestPath), 'utf8') !==
      committedManifest
    ) {
      throw new Error('Reviewed package manifest bytes do not match the source commit.')
    }
  }
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return undefined
    throw error
  }
}

function assertUniqueSafeFilenames(filenames) {
  if (new Set(filenames).size !== filenames.length) {
    throw new Error('Package artifact coordinates contain duplicate filenames.')
  }
  for (const filename of filenames) {
    if (
      basename(filename) !== filename ||
      !safeFilenamePattern.test(filename) ||
      Buffer.byteLength(filename) > maximumFilesystemComponentBytes
    ) {
      throw new Error(`Package artifact filename is unsafe: ${filename}`)
    }
  }
}

function resolveRealDirectory(directory, label) {
  if (
    typeof directory !== 'string' ||
    !existsSync(directory) ||
    !lstatSync(directory).isDirectory()
  ) {
    throw new Error(`${label} must be an existing directory.`)
  }
  return realpathSync(directory)
}

function assertContained(parent, candidate, label) {
  const fromParent = relative(parent, candidate)
  if (
    fromParent.length === 0 ||
    isAbsolute(fromParent) ||
    fromParent === '..' ||
    fromParent.startsWith(`..${sep}`)
  ) {
    throw new Error(`${label} is not a strict child of its reviewed parent.`)
  }
}
