import { lstatSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { parse } from 'yaml'

import { getMaintainedCandidateProfile } from './maintained-candidate-apps.mjs'
import { getPackageCertificationDescriptor } from './package-certification-manifest.mjs'

const defaultRepositoryRoot = resolve(import.meta.dirname, '..')
const integrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/u
const candidatePublishedAt = '2000-01-01T00:00:00.000Z'
const packageNames = Object.freeze(
  Object.fromEntries(
    ['mcp', 'nuxt', 'vue'].map((packageId) => {
      const descriptor = getPackageCertificationDescriptor(packageId)
      return [packageId, descriptor.packageName]
    }),
  ),
)

const { profile: nuxtCandidateProfile } = getMaintainedCandidateProfile('nuxt')
const nuxtPackageLanes = ['nuxt', ...nuxtCandidateProfile.companionPackages]

export const candidateAppLockProfiles = Object.freeze(
  [
    {
      directory: 'demo',
      packageIds: nuxtPackageLanes,
      strictPeerDependencies: false,
    },
    ...nuxtCandidateProfile.pnpmApps.map((app) => ({
      directory: app.path,
      packageIds: [...nuxtPackageLanes, ...(app.companionPackages ?? [])],
      strictPeerDependencies: true,
    })),
  ].map((profile) =>
    Object.freeze({ ...profile, packageIds: Object.freeze([...new Set(profile.packageIds)]) }),
  ),
)

/** Exact install command policy for one maintained application lock. */
export function candidateAppInstallArgs(profile, frozen) {
  if (!candidateAppLockProfiles.includes(profile) || typeof frozen !== 'boolean') {
    throw new TypeError('Candidate app install arguments require a maintained profile and mode.')
  }
  const args = frozen
    ? ['install', '--frozen-lockfile', '--ignore-scripts']
    : ['install', '--lockfile-only', '--no-frozen-lockfile', '--ignore-scripts']
  if (profile.strictPeerDependencies) args.push('--strict-peer-dependencies')
  return args
}

/** Build the npm metadata served for one local release candidate. */
export function createCandidateRegistryMetadata({
  integrity,
  packageJson,
  registry,
  tarballPathname,
}) {
  const metadata = {
    name: packageJson.name,
    'dist-tags': { latest: packageJson.version },
    time: {
      created: candidatePublishedAt,
      modified: candidatePublishedAt,
      [packageJson.version]: candidatePublishedAt,
    },
    versions: {
      [packageJson.version]: {
        ...packageJson,
        dist: {
          integrity,
          tarball: new URL(tarballPathname.slice(1), registry).href,
        },
      },
    },
  }
  assertCandidateRegistryTime(metadata, packageJson.version)
  return metadata
}

/** Reject metadata that cannot satisfy pnpm's dependency-age policy. */
export function assertCandidateRegistryTime(metadata, version) {
  if (
    metadata?.time?.created !== candidatePublishedAt ||
    metadata.time.modified !== candidatePublishedAt ||
    metadata.time[version] !== candidatePublishedAt
  ) {
    throw new Error(`Candidate registry metadata has invalid publication time for ${version}.`)
  }
}

/** Assert one pnpm lock binds an exact reviewed package tarball SRI. */
export function assertCandidateAppLockTextBindsArtifact(lockSource, profile, artifact) {
  assertArtifactIdentity(artifact)
  if (!profile.packageIds.includes(artifact.packageId)) {
    throw new Error(`${profile.directory} does not require package lane ${artifact.packageId}.`)
  }
  let lock
  try {
    lock = parse(lockSource)
  } catch {
    throw new Error(`${profile.directory}/pnpm-lock.yaml is not valid YAML.`)
  }
  const packageKey = `${artifact.packageName}@${artifact.version}`
  const packageEntries = lock?.packages
  const matchingKeys =
    packageEntries && typeof packageEntries === 'object'
      ? Object.keys(packageEntries).filter((key) => key.startsWith(`${artifact.packageName}@`))
      : []
  if (
    matchingKeys.length !== 1 ||
    matchingKeys[0] !== packageKey ||
    packageEntries[packageKey]?.resolution?.integrity !== artifact.integrity
  ) {
    const observedIntegrity = packageEntries?.[packageKey]?.resolution?.integrity ?? '(missing)'
    throw new Error(
      `${profile.directory}/pnpm-lock.yaml does not bind ${packageKey} to the exact staged artifact integrity: expected ${artifact.integrity}, observed ${String(observedIntegrity)}.`,
    )
  }
  if (artifact.packageId === 'mcp') {
    assertDirectSnapshot(lock, profile, packageNames.mcp, artifact.version)
    return
  }
  if (artifact.packageId === 'nuxt') {
    const nuxtSnapshot = assertDirectSnapshot(lock, profile, packageNames.nuxt, artifact.version)
    assertNuxtSnapshotReachesVue(lock, profile, nuxtSnapshot)
    return
  }
  const nuxtVersion = uniqueLockedPackageVersion(lock, profile, packageNames.nuxt)
  const nuxtSnapshot = assertDirectSnapshot(lock, profile, packageNames.nuxt, nuxtVersion)
  assertNuxtSnapshotReachesVue(lock, profile, nuxtSnapshot, artifact.version)
}

/** Fail before immutable rename when any maintained standalone lock has drifted. */
export function assertCandidateAppLocksBindArtifact(
  artifact,
  { repositoryRoot = defaultRepositoryRoot } = {},
) {
  assertArtifactIdentity(artifact)
  const applicableProfiles = candidateAppLockProfiles.filter((profile) =>
    profile.packageIds.includes(artifact.packageId),
  )
  if (applicableProfiles.length === 0) {
    throw new Error(`No candidate app lock requires package lane ${artifact.packageId}.`)
  }
  for (const profile of applicableProfiles) {
    const lockPath = join(repositoryRoot, profile.directory, 'pnpm-lock.yaml')
    const stats = lstatSync(lockPath)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`${profile.directory}/pnpm-lock.yaml must be a regular file.`)
    }
    assertCandidateAppLockTextBindsArtifact(readFileSync(lockPath, 'utf8'), profile, artifact)
  }
  return applicableProfiles.length
}

export function packageArtifactIdentity(packageId, version, integrity) {
  const descriptor = getPackageCertificationDescriptor(packageId)
  return Object.freeze({
    integrity,
    packageId: descriptor.id,
    packageName: descriptor.packageName,
    version,
  })
}

function assertArtifactIdentity(artifact) {
  const descriptor = getPackageCertificationDescriptor(artifact?.packageId)
  if (
    artifact.packageName !== descriptor.packageName ||
    typeof artifact.version !== 'string' ||
    artifact.version.length === 0 ||
    typeof artifact.integrity !== 'string' ||
    !integrityPattern.test(artifact.integrity)
  ) {
    throw new Error('Candidate app lock artifact identity is invalid.')
  }
  const encoded = artifact.integrity.slice('sha512-'.length)
  if (Buffer.from(encoded, 'base64').toString('base64') !== encoded) {
    throw new Error('Candidate app lock artifact identity is invalid.')
  }
}

function assertDirectSnapshot(lock, profile, packageName, expectedVersion) {
  const dependency = lock?.importers?.['.']?.dependencies?.[packageName]
  const resolution = dependency?.version
  const snapshotKey =
    typeof resolution === 'string' && resolutionBindsVersion(resolution, expectedVersion)
      ? `${packageName}@${resolution}`
      : undefined
  if (
    dependency?.specifier !== expectedVersion ||
    !snapshotKey ||
    !Object.hasOwn(lock?.snapshots ?? {}, snapshotKey)
  ) {
    throw new Error(
      `${profile.directory}/pnpm-lock.yaml does not reach ${packageName}@${expectedVersion} from its direct importer and exact snapshot.`,
    )
  }
  return lock.snapshots[snapshotKey]
}

function assertNuxtSnapshotReachesVue(lock, profile, nuxtSnapshot, expectedVersion) {
  const vueResolution = nuxtSnapshot?.dependencies?.[packageNames.vue]
  const vueVersion = expectedVersion ?? uniqueLockedPackageVersion(lock, profile, packageNames.vue)
  const vueSnapshotKey =
    typeof vueResolution === 'string' && resolutionBindsVersion(vueResolution, vueVersion)
      ? `${packageNames.vue}@${vueResolution}`
      : undefined
  if (!vueSnapshotKey || !Object.hasOwn(lock?.snapshots ?? {}, vueSnapshotKey)) {
    throw new Error(
      `${profile.directory}/pnpm-lock.yaml does not reach ${packageNames.vue}@${vueVersion} from the exact Nuxt snapshot.`,
    )
  }
}

function uniqueLockedPackageVersion(lock, profile, packageName) {
  const prefix = `${packageName}@`
  const matchingKeys = Object.keys(lock?.packages ?? {}).filter((key) => key.startsWith(prefix))
  if (matchingKeys.length !== 1) {
    throw new Error(
      `${profile.directory}/pnpm-lock.yaml must contain exactly one ${packageName} package resolution.`,
    )
  }
  return matchingKeys[0].slice(prefix.length)
}

function resolutionBindsVersion(resolution, version) {
  return resolution === version || resolution.startsWith(`${version}(`)
}
