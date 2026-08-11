import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as tar from 'tar'

import { getPackageCertificationDescriptor } from './package-certification-manifest.mjs'
import { inspectTarballArchive } from './package-check/tarball.mjs'

export const runtimeFingerprintPattern = /^bcn-release-v1-[0-9a-f]{64}$/u
const runtimeFingerprintDomain = 'better-convex/packed-runtime-fingerprint/v1\0'
const maxPackedFingerprintFileBytes = 16 * 1024 * 1024
const runtimeFingerprintSearchPattern = /bcn-release-v1-[0-9a-f]{64}/gu

const runtimeFingerprintProfiles = Object.freeze({
  'nuxt-runtime-binding': Object.freeze({
    buildFiles: Object.freeze(['dist/runtime/shared/release-fingerprint.js']),
    mode: 'required',
    moduleBindings: Object.freeze([
      Object.freeze({
        helperImport: '../dist/runtime/shared/release-fingerprint.js',
        packedFile: 'dist/module.mjs',
      }),
    ]),
    packedFiles: Object.freeze(['dist/runtime/shared/release-fingerprint.js']),
    token: '__BCN_RELEASE_RUNTIME_FINGERPRINT__',
  }),
  'vue-no-runtime-fingerprint': Object.freeze({ mode: 'forbidden' }),
  'mcp-no-runtime-fingerprint': Object.freeze({ mode: 'forbidden' }),
})

function assertExactFields(value, fields, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    !fields.every((field) => Object.hasOwn(value, field))
  ) {
    throw new Error(`${label} is invalid.`)
  }
}

export function assertRuntimeFingerprintProfile(profile) {
  if (profile?.mode === 'forbidden') {
    assertExactFields(profile, ['mode'], 'Forbidden runtime-fingerprint profile')
    return profile
  }
  assertExactFields(
    profile,
    ['buildFiles', 'mode', 'moduleBindings', 'packedFiles', 'token'],
    'Required runtime-fingerprint profile',
  )
  if (
    profile.mode !== 'required' ||
    !Array.isArray(profile.buildFiles) ||
    profile.buildFiles.length === 0 ||
    !Array.isArray(profile.packedFiles) ||
    profile.packedFiles.length === 0 ||
    !Array.isArray(profile.moduleBindings) ||
    profile.moduleBindings.length === 0 ||
    typeof profile.token !== 'string' ||
    runtimeFingerprintPattern.test(profile.token) ||
    [...profile.buildFiles, ...profile.packedFiles].some(
      (path) => typeof path !== 'string' || !/^dist\/[\w./-]+$/u.test(path),
    ) ||
    profile.moduleBindings.some(
      (binding) =>
        !binding ||
        typeof binding !== 'object' ||
        Object.keys(binding).sort().join(',') !== 'helperImport,packedFile' ||
        typeof binding.helperImport !== 'string' ||
        !/^\.\.\/dist\/[\w./-]+$/u.test(binding.helperImport) ||
        typeof binding.packedFile !== 'string' ||
        !/^dist\/[\w./-]+$/u.test(binding.packedFile),
    )
  ) {
    throw new Error('Required runtime-fingerprint profile is invalid.')
  }
  return profile
}

export function getPackageRuntimeFingerprintProfile(packageId) {
  const descriptor = getPackageCertificationDescriptor(packageId)
  const profileId = descriptor.profiles.runtimeFingerprint
  const profile = runtimeFingerprintProfiles[profileId]
  if (!profile) {
    throw new Error(`Package ${descriptor.id} has no reviewed runtime-fingerprint profile.`)
  }
  assertRuntimeFingerprintProfile(profile)
  return Object.freeze({ descriptor, profile })
}

/**
 * Derive the public runtime coordinate from the normalized packed payload.
 *
 * The fingerprint is diagnostic, not secret or authoritative: artifact SRI is
 * the byte authority. Keeping this value deterministic lets standalone locks
 * bind the same tarball that the protected release workflow later mints.
 */
export function derivePackageRuntimeFingerprint(packageId, version, tarballPath) {
  const { descriptor, profile } = getPackageRuntimeFingerprintProfile(packageId)
  if (profile.mode === 'forbidden') return null
  if (
    typeof version !== 'string' ||
    version.length === 0 ||
    version.includes('\0') ||
    typeof tarballPath !== 'string' ||
    tarballPath.length === 0
  ) {
    throw new TypeError('Runtime fingerprint requires a package version and packed payload.')
  }
  const digest = createHash('sha256')
    .update(runtimeFingerprintDomain)
    .update(descriptor.packageName)
    .update('\0')
    .update(version)
    .update('\0')
    .update(descriptor.profiles.runtimeFingerprint)
    .update('\0')
  const scratchDirectory = mkdtempSync(join(tmpdir(), 'bcn-fingerprint-payload-'))
  try {
    const archiveEntries = inspectTarballArchive(packageId, tarballPath).sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )
    const extractDirectory = join(scratchDirectory, 'extracted')
    mkdirSync(extractDirectory)
    tar.x({ cwd: extractDirectory, file: tarballPath, strict: true, sync: true })
    for (const entry of archiveEntries) {
      const relativePath = entry.path.slice('package/'.length)
      let bytes = readFileSync(join(extractDirectory, entry.path))
      if (profile.packedFiles.includes(relativePath)) {
        bytes = Buffer.from(normalizeFingerprintSource(bytes.toString('utf8'), profile))
      }
      digest
        .update(`${relativePath}\0${(entry.mode & 0o777).toString(8)}\0${bytes.length}\0`)
        .update(bytes)
        .update('\0')
    }
    return `bcn-release-v1-${digest.digest('hex')}`
  } finally {
    rmSync(scratchDirectory, { force: true, recursive: true })
  }
}

/** Replace the one generated build token with the deterministic coordinate. */
export function bindPackageRuntimeFingerprintBuild(packageId, runtimeFingerprint, packageRoot) {
  const { profile } = getPackageRuntimeFingerprintProfile(packageId)
  if (profile.mode === 'forbidden') return null
  if (
    typeof runtimeFingerprint !== 'string' ||
    !runtimeFingerprintPattern.test(runtimeFingerprint)
  ) {
    throw new TypeError('Runtime fingerprint build binding requires a valid coordinate.')
  }
  for (const relativePath of profile.buildFiles) {
    const path = join(packageRoot, relativePath)
    const source = readFileSync(path, 'utf8')
    if (source.split(profile.token).length !== 2 || source.includes(runtimeFingerprint)) {
      throw new Error(`Release fingerprint token must occur exactly once in ${path}.`)
    }
    writeFileSync(path, source.replace(profile.token, runtimeFingerprint))
  }
  return runtimeFingerprint
}

/** Prove the deterministic coordinate is bound throughout one packed tarball. */
export function assertPackedRuntimeFingerprintBinding(packageId, version, tarballPath) {
  const { profile } = getPackageRuntimeFingerprintProfile(packageId)
  const runtimeFingerprint = derivePackageRuntimeFingerprint(packageId, version, tarballPath)
  if (profile.mode === 'forbidden') return runtimeFingerprint
  for (const packagePath of profile.packedFiles) {
    const source = readPackedText(tarballPath, packagePath)
    if (source.split(runtimeFingerprint).length !== 2 || source.includes(profile.token)) {
      throw new Error(`Artifact runtime fingerprint is not bound to packed ${packagePath}.`)
    }
  }
  for (const binding of profile.moduleBindings) {
    const moduleSource = readPackedText(tarballPath, binding.packedFile)
    const escapedImport = binding.helperImport.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const importPattern = new RegExp(
      `import\\s*\\{\\s*getPackedRuntimeFingerprint\\s*\\}\\s*from\\s*['"]${escapedImport}['"]`,
      'gu',
    )
    if (
      (moduleSource.match(importPattern) ?? []).length !== 1 ||
      moduleSource.includes(profile.token)
    ) {
      throw new Error(
        `Artifact runtime fingerprint helper is not bound to packed ${binding.packedFile}.`,
      )
    }
  }
  return runtimeFingerprint
}

function readPackedText(tarballPath, packagePath) {
  try {
    return execFileSync('tar', ['-xOf', tarballPath, `package/${packagePath}`], {
      encoding: 'utf8',
      maxBuffer: maxPackedFingerprintFileBytes,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error(`Artifact tarball is missing bounded fingerprint input ${packagePath}.`)
  }
}

function normalizeFingerprintSource(source, profile) {
  const tokenCount = source.split(profile.token).length - 1
  const boundFingerprints = source.match(runtimeFingerprintSearchPattern) ?? []
  if (tokenCount === 1 && boundFingerprints.length === 0) return source
  if (tokenCount === 0 && boundFingerprints.length === 1) {
    return source.replace(boundFingerprints[0], profile.token)
  }
  throw new Error('Packed runtime fingerprint input is not uniquely normalizable.')
}

export function assertRuntimeFingerprintEvidence(profile, value) {
  assertRuntimeFingerprintProfile(profile)
  if (profile.mode === 'forbidden') {
    if (value !== null) {
      throw new Error('Runtime fingerprint is forbidden for this package profile.')
    }
    return
  }
  if (typeof value !== 'string' || !runtimeFingerprintPattern.test(value)) {
    throw new Error('Runtime fingerprint is required for this package profile.')
  }
}
