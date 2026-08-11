import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { getPackageArtifactCoordinates } from './package-artifact-coordinates.mjs'
import { parsePackageArtifactEvidence } from './package-artifact-evidence.mjs'

export const candidateSetSchemaVersion = 1
export const candidateSetPackageIds = Object.freeze(['vue', 'nuxt'])

const setFields = Object.freeze([
  'schemaVersion',
  'sourceCommit',
  'version',
  'packageManager',
  'packages',
])
const packageFields = Object.freeze(['packageId', 'packageName', 'evidence', 'tarball'])

function exactFields(value, fields) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field)),
  )
}

export function getCandidateSetCoordinates(repositoryRoot) {
  const root = realpathSync(repositoryRoot)
  const packages = candidateSetPackageIds.map((packageId) =>
    getPackageArtifactCoordinates(packageId, { repositoryRoot: root }),
  )
  const versions = new Set(packages.map((entry) => entry.version))
  if (versions.size !== 1) throw new Error('Candidate-set packages must use one exact version.')
  const version = packages[0].version
  const parentDirectory = resolve(root, '.release-artifacts', 'set')
  const directory = resolve(parentDirectory, version)
  const manifest = resolve(directory, 'artifact-set.json')
  for (const path of [parentDirectory, directory, manifest]) {
    const pathFromRoot = relative(root, path)
    if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)) {
      throw new Error('Candidate-set coordinate escapes the repository.')
    }
  }
  return Object.freeze({ root, version, packages, parentDirectory, directory, manifest })
}

export function readCandidateSetPackageEvidence(repositoryRoot) {
  const coordinates = getCandidateSetCoordinates(repositoryRoot)
  return coordinates.packages.map((entry) => {
    const evidence = parsePackageArtifactEvidence(
      JSON.parse(readFileSync(entry.paths.evidence, 'utf8')),
      entry,
    )
    return { coordinates: entry, evidence }
  })
}

export function createCandidateSetEvidence(repositoryRoot) {
  const entries = readCandidateSetPackageEvidence(repositoryRoot)
  const sourceCommits = new Set(entries.map(({ evidence }) => evidence.sourceCommit))
  const packageManagers = new Set(entries.map(({ evidence }) => evidence.packageManager))
  if (sourceCommits.size !== 1 || packageManagers.size !== 1) {
    throw new Error('Candidate-set artifacts must share one source commit and package manager.')
  }
  const root = realpathSync(repositoryRoot)
  return {
    schemaVersion: candidateSetSchemaVersion,
    sourceCommit: entries[0].evidence.sourceCommit,
    version: entries[0].evidence.version,
    packageManager: entries[0].evidence.packageManager,
    packages: entries.map(({ coordinates }) => ({
      packageId: coordinates.packageId,
      packageName: coordinates.packageName,
      evidence: relative(root, coordinates.paths.evidence).split(sep).join('/'),
      tarball: relative(root, coordinates.paths.tarball).split(sep).join('/'),
    })),
  }
}

export function parseCandidateSetEvidence(value, repositoryRoot) {
  const expected = createCandidateSetEvidence(repositoryRoot)
  if (
    !exactFields(value, setFields) ||
    value.schemaVersion !== candidateSetSchemaVersion ||
    !Array.isArray(value.packages) ||
    value.packages.length !== candidateSetPackageIds.length ||
    value.packages.some((entry) => !exactFields(entry, packageFields)) ||
    !isDeepStrictEqual(value, expected)
  ) {
    throw new Error('Candidate-set evidence does not match the reviewed package artifacts.')
  }
  return value
}

export function assertCandidateSetManifest(path, repositoryRoot) {
  const coordinates = getCandidateSetCoordinates(repositoryRoot)
  const resolvedPath = resolve(repositoryRoot, path)
  if (resolvedPath !== coordinates.manifest) {
    throw new Error('Candidate-set manifest is not at the reviewed artifact coordinate.')
  }
  const stats = existsSync(resolvedPath) ? lstatSync(resolvedPath) : undefined
  if (!stats?.isFile() || stats.isSymbolicLink() || statSync(resolvedPath).size < 1) {
    throw new Error('Candidate-set manifest must be a nonempty regular file.')
  }
  return parseCandidateSetEvidence(JSON.parse(readFileSync(resolvedPath, 'utf8')), repositoryRoot)
}
