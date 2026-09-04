import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getPackageArtifactCoordinates } from './package-artifact-coordinates.mjs'
import {
  assertPackedRuntimeFingerprintBinding,
  bindPackageRuntimeFingerprintBuild,
  derivePackageRuntimeFingerprint,
  getPackageRuntimeFingerprintProfile,
} from './package-runtime-fingerprint-profile.mjs'

export function buildReleasePackage(packageId, { repositoryRoot, environment = process.env } = {}) {
  const coordinates = getPackageArtifactCoordinates(packageId, {
    ...(repositoryRoot ? { repositoryRoot } : {}),
  })
  rmSync(join(coordinates.sourceDirectory, 'dist'), { force: true, recursive: true })
  rmSync(join(coordinates.sourceDirectory, '.nuxt'), { force: true, recursive: true })
  console.log(`\n> pnpm run prepack (${coordinates.packageDirectory})`)
  execFileSync('pnpm', ['run', 'prepack'], {
    cwd: coordinates.sourceDirectory,
    env: {
      ...environment,
      npm_config_verify_deps_before_run: 'false',
      PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false',
    },
    stdio: 'inherit',
  })
  return coordinates
}

/**
 * Pack one already-built reviewed package without running lifecycle scripts.
 */
function packReleaseTarball(
  packageId,
  destination,
  { repositoryRoot, environment = process.env } = {},
) {
  const coordinates = getPackageArtifactCoordinates(packageId, {
    ...(repositoryRoot ? { repositoryRoot } : {}),
  })
  const packageJson = JSON.parse(readFileSync(coordinates.manifestPath, 'utf8'))
  const packResult = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], {
      cwd: coordinates.sourceDirectory,
      encoding: 'utf8',
      env: environment,
      stdio: ['ignore', 'pipe', 'inherit'],
    }),
  )
  if (!Array.isArray(packResult) || packResult.length !== 1) {
    throw new Error('npm pack must produce exactly one package result.')
  }
  const result = packResult[0]
  if (result.filename !== coordinates.files.tarball) {
    throw new Error(`npm pack produced unexpected artifact filename: ${String(result.filename)}.`)
  }
  if (result.name !== packageJson.name || result.version !== coordinates.version) {
    throw new Error(
      `npm pack produced unexpected identity: ${String(result.name)}@${String(result.version)}.`,
    )
  }
  const tarballPath = join(destination, result.filename)
  if (!existsSync(tarballPath)) throw new Error(`Expected tarball is missing: ${tarballPath}`)
  return Object.freeze({ packResult, tarballPath })
}

/**
 * Canonical build + bind + pack path shared by preflight and release.
 *
 * Ordinary package builds deliberately retain the placeholder. Only this
 * release path derives a diagnostic coordinate from the complete normalized
 * packed payload, binds that coordinate, and creates the final tarball. The
 * generated build file is restored so a source-built host cannot impersonate
 * an immutable release candidate.
 *
 * @param {string} packageId
 * @param {string} destination
 * @param {{ repositoryRoot?: string, environment?: NodeJS.ProcessEnv }} [options]
 */
export function buildAndPackReleaseTarball(
  packageId,
  destination,
  { repositoryRoot, environment = process.env } = {},
) {
  const coordinates = buildReleasePackage(packageId, { repositoryRoot, environment })
  const { profile } = getPackageRuntimeFingerprintProfile(packageId)
  if (profile.mode === 'forbidden') {
    const packed = packReleaseTarball(packageId, destination, { repositoryRoot, environment })
    const runtimeFingerprint = assertPackedRuntimeFingerprintBinding(
      packageId,
      coordinates.version,
      packed.tarballPath,
    )
    return Object.freeze({ ...packed, runtimeFingerprint })
  }

  const preimageDirectory = mkdtempSync(join(tmpdir(), 'bcn-release-pack-preimage-'))
  const originalBuildFiles = new Map()
  try {
    for (const relativePath of profile.buildFiles) {
      const path = join(coordinates.sourceDirectory, relativePath)
      originalBuildFiles.set(path, readFileSync(path))
    }
    const preimage = packReleaseTarball(packageId, preimageDirectory, {
      repositoryRoot,
      environment,
    })
    const runtimeFingerprint = derivePackageRuntimeFingerprint(
      packageId,
      coordinates.version,
      preimage.tarballPath,
    )
    bindPackageRuntimeFingerprintBuild(packageId, runtimeFingerprint, coordinates.sourceDirectory)
    const packed = packReleaseTarball(packageId, destination, { repositoryRoot, environment })
    if (
      assertPackedRuntimeFingerprintBinding(packageId, coordinates.version, packed.tarballPath) !==
      runtimeFingerprint
    ) {
      throw new Error('Final artifact does not match its normalized packed-payload fingerprint.')
    }
    return Object.freeze({ ...packed, runtimeFingerprint })
  } finally {
    for (const [path, contents] of originalBuildFiles) writeFileSync(path, contents)
    rmSync(preimageDirectory, { force: true, recursive: true })
  }
}
