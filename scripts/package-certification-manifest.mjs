import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = realpathSync(resolve(fileURLToPath(new URL('..', import.meta.url))))
const descriptorFields = Object.freeze(['id', 'packageName', 'packageDirectory', 'profiles'])
const profileFields = Object.freeze([
  'build',
  'exports',
  'packedFiles',
  'sbom',
  'provenance',
  'candidateTests',
  'runtimeFingerprint',
])
const identifierPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const packageDirectoryPattern = /^(?:\.|packages\/[a-z0-9]+(?:-[a-z0-9]+)*)$/u
const repositoryUrl = 'https://github.com/lupinum-dev/better-convex-nuxt'

const reviewedDescriptors = [
  {
    id: 'nuxt',
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
  },
  {
    id: 'vue',
    packageName: 'better-convex-vue',
    packageDirectory: 'packages/vue',
    profiles: {
      build: 'vue-unbuild',
      exports: 'vue-public-entries',
      packedFiles: 'vue-runtime-artifact',
      sbom: 'vue-production-dependencies',
      provenance: 'vue-repository-origin',
      candidateTests: 'vue-maintained-consumers',
      runtimeFingerprint: 'vue-no-runtime-fingerprint',
    },
  },
  {
    id: 'mcp',
    packageName: 'better-convex-mcp',
    packageDirectory: 'packages/mcp',
    profiles: {
      build: 'mcp-unbuild',
      exports: 'mcp-public-entries',
      packedFiles: 'mcp-runtime-artifact',
      sbom: 'mcp-production-dependencies',
      provenance: 'mcp-repository-origin',
      candidateTests: 'mcp-maintained-consumers',
      runtimeFingerprint: 'mcp-no-runtime-fingerprint',
    },
  },
]

const reviewedProfileIds = Object.freeze(
  Object.fromEntries(
    profileFields.map((profile) => [
      profile,
      Object.freeze([
        ...new Set(reviewedDescriptors.map((descriptor) => descriptor.profiles[profile])),
      ]),
    ]),
  ),
)

/**
 * Validate and detach the closed release-control manifest from its caller.
 *
 * This is an internal test seam. Release commands must select from
 * `packageCertificationDescriptors`; they must never validate and execute a
 * descriptor supplied by CI or artifact evidence.
 */
export function validatePackageCertificationDescriptors(
  descriptors,
  { repositoryRoot: requestedRepositoryRoot = repositoryRoot } = {},
) {
  const canonicalDescriptors = canonicalizeDescriptors(descriptors)
  assertReviewedDescriptors(canonicalDescriptors)
  validatePackageBindings(canonicalDescriptors, requestedRepositoryRoot)
  return freezeDescriptors(canonicalDescriptors)
}

const canonicalReviewedDescriptors = canonicalizeDescriptors(reviewedDescriptors)
validatePackageBindings(canonicalReviewedDescriptors, repositoryRoot)
export const packageCertificationDescriptors = freezeDescriptors(canonicalReviewedDescriptors)

/** Select and bind one reviewed package by its closed internal identifier. */
export function getPackageCertificationDescriptor(
  id,
  { repositoryRoot: requestedRepositoryRoot = repositoryRoot } = {},
) {
  const descriptor = packageCertificationDescriptors.find((candidate) => candidate.id === id)
  if (!descriptor) throw new Error(`Unknown package certification descriptor: ${String(id)}`)
  const root = resolveRealDirectory(requestedRepositoryRoot, 'Repository root')
  validatePackageBinding(descriptor, root)
  return descriptor
}

function canonicalizeDescriptors(descriptors) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    throw new TypeError('Package certification descriptors must be a non-empty array.')
  }

  const canonicalDescriptors = descriptors.map((descriptor, index) => {
    assertPlainObject(descriptor, `descriptor at index ${index}`)
    const label =
      typeof descriptor.id === 'string' && descriptor.id.length > 0
        ? `descriptor ${descriptor.id}`
        : `descriptor at index ${index}`
    assertExactFields(descriptor, descriptorFields, label)
    if (typeof descriptor.id !== 'string' || !identifierPattern.test(descriptor.id)) {
      throw new TypeError(`${label} has invalid id.`)
    }
    if (
      typeof descriptor.packageName !== 'string' ||
      !packageNamePattern.test(descriptor.packageName)
    ) {
      throw new TypeError(`${label} has invalid packageName.`)
    }
    if (
      typeof descriptor.packageDirectory !== 'string' ||
      !packageDirectoryPattern.test(descriptor.packageDirectory)
    ) {
      throw new TypeError(`${label} has invalid packageDirectory.`)
    }
    assertPlainObject(descriptor.profiles, `${label} profiles`)
    assertExactFields(descriptor.profiles, profileFields, `${label} profiles`)
    for (const profile of profileFields) {
      if (
        typeof descriptor.profiles[profile] !== 'string' ||
        !identifierPattern.test(descriptor.profiles[profile])
      ) {
        throw new TypeError(`${label} has invalid ${profile} profile.`)
      }
    }
    return {
      id: descriptor.id,
      packageName: descriptor.packageName,
      packageDirectory: descriptor.packageDirectory,
      profiles: Object.fromEntries(
        profileFields.map((profile) => [profile, descriptor.profiles[profile]]),
      ),
    }
  })

  assertUnique(canonicalDescriptors, 'id', 'descriptor id')
  assertUnique(canonicalDescriptors, 'packageName', 'package name')
  assertUnique(canonicalDescriptors, 'packageDirectory', 'package directory')

  for (const descriptor of canonicalDescriptors) {
    for (const profile of profileFields) {
      if (!reviewedProfileIds[profile].includes(descriptor.profiles[profile])) {
        throw new Error(`Package descriptor ${descriptor.id} has unreviewed ${profile} profile.`)
      }
    }
  }
  return canonicalDescriptors
}

function freezeDescriptors(canonicalDescriptors) {
  for (const descriptor of canonicalDescriptors) {
    Object.freeze(descriptor.profiles)
    Object.freeze(descriptor)
  }
  return Object.freeze(canonicalDescriptors)
}

function assertReviewedDescriptors(descriptors) {
  if (descriptors.length !== packageCertificationDescriptors.length) {
    throw new Error('Package certification manifest does not match the reviewed descriptor set.')
  }
  for (const descriptor of descriptors) {
    const reviewed = packageCertificationDescriptors.find(
      (candidate) => candidate.id === descriptor.id,
    )
    if (!reviewed) {
      throw new Error(`Unreviewed package certification descriptor id: ${descriptor.id}`)
    }
    if (descriptor.packageName !== reviewed.packageName) {
      throw new Error(`Package descriptor ${descriptor.id} has unreviewed packageName.`)
    }
    if (descriptor.packageDirectory !== reviewed.packageDirectory) {
      throw new Error(`Package descriptor ${descriptor.id} has unreviewed packageDirectory.`)
    }
    for (const profile of profileFields) {
      if (descriptor.profiles[profile] !== reviewed.profiles[profile]) {
        throw new Error(`Package descriptor ${descriptor.id} has unreviewed ${profile} profile.`)
      }
    }
  }
}

function validatePackageBindings(descriptors, requestedRepositoryRoot) {
  const root = resolveRealDirectory(requestedRepositoryRoot, 'Repository root')
  for (const descriptor of descriptors) validatePackageBinding(descriptor, root)
}

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(`Package certification ${label} must be a plain object.`)
  }
}

function assertExactFields(value, expectedFields, label) {
  const actualFields = Object.keys(value)
  const missing = expectedFields.filter((field) => !actualFields.includes(field))
  const unexpected = actualFields.filter((field) => !expectedFields.includes(field))
  if (missing.length > 0) {
    throw new TypeError(`Package certification ${label}: missing fields: ${missing.join(', ')}`)
  }
  if (unexpected.length > 0) {
    throw new TypeError(
      `Package certification ${label}: unexpected fields: ${unexpected.join(', ')}`,
    )
  }
}

function assertUnique(descriptors, field, label) {
  const seen = new Set()
  for (const descriptor of descriptors) {
    if (seen.has(descriptor[field])) {
      throw new Error(`Package certification manifest has duplicate ${label}: ${descriptor[field]}`)
    }
    seen.add(descriptor[field])
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

function validatePackageBinding(descriptor, root) {
  const packageDirectory = resolve(root, descriptor.packageDirectory)
  const relativeDirectory = relative(root, packageDirectory)
  if (
    isAbsolute(relativeDirectory) ||
    relativeDirectory === '..' ||
    relativeDirectory.startsWith(`..${sep}`)
  ) {
    throw new Error(`Package descriptor ${descriptor.id} resolves outside the repository.`)
  }
  if (!existsSync(packageDirectory)) {
    throw new Error(`Package descriptor ${descriptor.id} packageDirectory is missing.`)
  }
  const packageDirectoryStat = lstatSync(packageDirectory)
  if (packageDirectoryStat.isSymbolicLink()) {
    throw new Error(
      `Package descriptor ${descriptor.id} packageDirectory must not be a symlink alias.`,
    )
  }
  if (!packageDirectoryStat.isDirectory() || realpathSync(packageDirectory) !== packageDirectory) {
    throw new Error(
      `Package descriptor ${descriptor.id} packageDirectory must be a real directory.`,
    )
  }

  const manifestPath = join(packageDirectory, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`Package descriptor ${descriptor.id} package.json is missing.`)
  }
  const manifestStat = lstatSync(manifestPath)
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error(
      `Package descriptor ${descriptor.id} package.json must be a regular in-package file.`,
    )
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new Error(`Package descriptor ${descriptor.id} package.json is not valid JSON.`)
  }
  assertPlainObject(manifest, `descriptor ${descriptor.id} package.json`)
  if (manifest.name !== descriptor.packageName) {
    throw new Error(
      `Package ${descriptor.packageDirectory}/package.json declares ${String(manifest.name)}; descriptor ${descriptor.id} requires ${descriptor.packageName}.`,
    )
  }
  if (manifest.private === true) {
    throw new Error(`Package descriptor ${descriptor.id} cannot certify a private package.`)
  }
  if (manifest.repository?.url !== repositoryUrl) {
    throw new Error(
      `Package descriptor ${descriptor.id} requires repository.url ${repositoryUrl} for npm provenance.`,
    )
  }
}
