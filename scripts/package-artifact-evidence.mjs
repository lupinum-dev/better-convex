import { basename } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import {
  assertRuntimeFingerprintEvidence,
  getPackageRuntimeFingerprintProfile,
} from './package-runtime-fingerprint-profile.mjs'

export const packageArtifactEvidenceSchemaVersion = 3

const artifactEvidenceFields = Object.freeze([
  'schemaVersion',
  'packageId',
  'packageName',
  'packageDirectory',
  'version',
  'profiles',
  'sourceCommit',
  'packageManager',
  'node',
  'npm',
  'pnpm',
  'sourceTree',
  'runtimeFingerprint',
  'tarball',
  'contents',
  'sbom',
])
const fileEvidenceFields = Object.freeze(['file', 'bytes', 'sha256'])
const tarballEvidenceFields = Object.freeze([...fileEvidenceFields, 'integrity'])
const fullGitCommitPattern = /^[0-9a-f]{40}$/u
const sha256Pattern = /^[0-9a-f]{64}$/u

/**
 * Parse the one strict artifact-evidence schema and bind it to a closed,
 * repository-owned package descriptor. Evidence never selects a package,
 * profile, path, or command.
 */
export function parsePackageArtifactEvidence(value, coordinates) {
  const { profile: runtimeFingerprintProfile } = getPackageRuntimeFingerprintProfile(
    coordinates.packageId,
  )
  if (
    !hasExactFields(value, artifactEvidenceFields) ||
    value.schemaVersion !== packageArtifactEvidenceSchemaVersion ||
    value.packageId !== coordinates.packageId ||
    value.packageName !== coordinates.packageName ||
    value.packageDirectory !== coordinates.packageDirectory ||
    value.version !== coordinates.version ||
    !isDeepStrictEqual(value.profiles, coordinates.profiles) ||
    !matches(value.sourceCommit, fullGitCommitPattern) ||
    !isNonemptyString(value.packageManager) ||
    !isNonemptyString(value.node) ||
    !isNonemptyString(value.npm) ||
    !isNonemptyString(value.pnpm) ||
    value.sourceTree !== 'clean'
  ) {
    throw new Error('Artifact identity does not match the checked-out package and source commit.')
  }
  try {
    assertRuntimeFingerprintEvidence(runtimeFingerprintProfile, value.runtimeFingerprint)
  } catch {
    throw new Error('Artifact identity does not match the checked-out package and source commit.')
  }

  assertFileEvidence(value.tarball, 'tarball', coordinates.files.tarball, {
    fields: tarballEvidenceFields,
    requireIntegrity: true,
  })
  assertFileEvidence(value.contents, 'content manifest', coordinates.files.contents)
  assertFileEvidence(value.sbom, 'SBOM', coordinates.files.sbom)
  return value
}

/** Bind syntactically valid evidence to the exact build environment that produced it. */
export function assertPackageArtifactBuildIdentity(
  evidence,
  { sourceCommit, packageManager, node, npm, pnpm },
) {
  if (
    evidence.sourceCommit !== sourceCommit ||
    evidence.packageManager !== packageManager ||
    evidence.node !== node ||
    evidence.npm !== npm ||
    evidence.pnpm !== pnpm
  ) {
    throw new Error('Artifact identity does not match the checked-out package and source commit.')
  }
}

/** Return only the allowlisted artifact identity consumed by protected cloud evidence. */
export function selectPackageArtifactRuntimeIdentity(evidence) {
  return Object.freeze({
    integrity: evidence.tarball.integrity,
    package: evidence.packageName,
    runtimeFingerprint: evidence.runtimeFingerprint,
    sourceCommit: evidence.sourceCommit,
    tarballSha256: evidence.tarball.sha256,
    version: evidence.version,
  })
}

function assertFileEvidence(
  value,
  label,
  expectedFile,
  { fields = fileEvidenceFields, requireIntegrity = false } = {},
) {
  if (
    !hasExactFields(value, fields) ||
    value.file !== expectedFile ||
    basename(value.file) !== value.file ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    !matches(value.sha256, sha256Pattern) ||
    (requireIntegrity && !isCanonicalSha512Integrity(value.integrity))
  ) {
    throw new Error(`Artifact ${label} evidence is malformed.`)
  }
}

function hasExactFields(value, fields) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field)),
  )
}

function isNonemptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function matches(value, pattern) {
  return typeof value === 'string' && pattern.test(value)
}

function isCanonicalSha512Integrity(value) {
  if (typeof value !== 'string' || !value.startsWith('sha512-')) return false
  const encoded = value.slice('sha512-'.length)
  if (encoded.length !== 88) return false
  const decoded = Buffer.from(encoded, 'base64')
  return decoded.length === 64 && decoded.toString('base64') === encoded
}
