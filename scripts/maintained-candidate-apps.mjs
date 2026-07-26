import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  getPackageCertificationDescriptor,
  packageCertificationDescriptors,
} from './package-certification-manifest.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const runnerFields = Object.freeze(['kind', 'runners', 'tarballFilename'])
const appFields = Object.freeze([
  'browserRunners',
  'companionPackages',
  'kind',
  'npmConsumer',
  'pnpmApps',
  'tarballFilename',
])
const fixtureFields = Object.freeze(['name', 'path'])
const fixtureWithCompanionsFields = Object.freeze(['companionPackages', 'name', 'path'])
const identifierPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const fixturePathPattern = /^(?:demo|starters\/[a-z0-9-]+|test\/fixtures\/[a-z0-9-]+)$/u
const tarballFilenamePattern = /^[a-z0-9-]+\.tgz$/u

const candidateTestProfiles = Object.freeze({
  'nuxt-maintained-consumers': Object.freeze({
    kind: 'apps',
    browserRunners: Object.freeze(['scripts/check-nuxt-lifecycle-consumer.mjs']),
    companionPackages: Object.freeze(['vue']),
    npmConsumer: Object.freeze({
      name: 'npm-consumer-smoke',
      path: 'test/fixtures/consumer-smoke',
    }),
    pnpmApps: Object.freeze(
      [
        { name: 'demo', path: 'demo' },
        { name: 'agency', path: 'starters/agency' },
        {
          name: 'mcp-oauth-agent',
          path: 'starters/mcp-oauth-agent',
          companionPackages: Object.freeze(['mcp']),
        },
        { name: 'public', path: 'starters/public' },
        { name: 'team', path: 'starters/team' },
      ].map(Object.freeze),
    ),
    tarballFilename: 'better-convex-nuxt.tgz',
  }),
  'vue-maintained-consumers': Object.freeze({
    kind: 'runners',
    runners: Object.freeze([
      'scripts/check-vue-anonymous-consumer.mjs',
      'scripts/check-vue-auth-consumer.mjs',
      'scripts/check-vue-embedded-consumer.mjs',
    ]),
    tarballFilename: 'better-convex-vue.tgz',
  }),
  'mcp-maintained-consumers': Object.freeze({
    kind: 'runners',
    runners: Object.freeze([
      'scripts/check-mcp-package-consumer.mjs',
      'scripts/check-mcp-better-auth-consumer.mjs',
      'scripts/check-mcp-external-convex-consumer.mjs',
    ]),
    tarballFilename: 'better-convex-mcp.tgz',
  }),
})

function assertExactFields(value, expected, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== expected.join(',')
  ) {
    throw new Error(`${label} has invalid fields.`)
  }
}

function assertUniqueStrings(values, label) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => typeof value !== 'string') ||
    new Set(values).size !== values.length
  ) {
    throw new Error(`${label} must be a non-empty list of unique strings.`)
  }
}

function assertRepositoryEntry(repositoryPath, label, expectedType) {
  const path = join(repositoryRoot, repositoryPath)
  const stats = existsSync(path) ? lstatSync(path) : undefined
  if (
    !stats ||
    stats.isSymbolicLink() ||
    (expectedType === 'file' ? !stats.isFile() : !stats.isDirectory())
  ) {
    throw new Error(`${label} is missing or is not a real ${expectedType}.`)
  }
  return path
}

function readFixtureManifest(fixture, label) {
  const path = assertRepositoryEntry(
    join(fixture.path, 'package.json'),
    `${label} package.json`,
    'file',
  )
  return JSON.parse(readFileSync(path, 'utf8'))
}

function dependencySpecifier(manifest, packageName) {
  return (
    manifest.dependencies?.[packageName] ??
    manifest.devDependencies?.[packageName] ??
    manifest.peerDependencies?.[packageName]
  )
}

function assertCompanionPackages(packageIds, ownerId, label) {
  if (!Array.isArray(packageIds) || new Set(packageIds).size !== packageIds.length) {
    throw new Error(`${label} must be a unique package list.`)
  }
  for (const packageId of packageIds) {
    if (packageId === ownerId) throw new Error(`${label} cannot contain its own package.`)
    getPackageCertificationDescriptor(packageId)
  }
}

function assertRunner(runner, descriptor) {
  const pattern = new RegExp(`^scripts/check-${descriptor.id}-[a-z0-9-]+-consumer\\.mjs$`, 'u')
  if (typeof runner !== 'string' || !pattern.test(runner)) {
    throw new Error(`Candidate runner ${String(runner)} is not owned by package ${descriptor.id}.`)
  }
  assertRepositoryEntry(runner, `Candidate runner ${runner}`, 'file')
}

function assertFixture(fixture, label, descriptor, requireLockfile) {
  const expectedFields =
    fixture && Object.hasOwn(fixture, 'companionPackages')
      ? fixtureWithCompanionsFields
      : fixtureFields
  assertExactFields(fixture, expectedFields, label)
  if (
    typeof fixture.name !== 'string' ||
    !identifierPattern.test(fixture.name) ||
    typeof fixture.path !== 'string' ||
    !fixturePathPattern.test(fixture.path)
  ) {
    throw new Error(`${label} has an invalid name or path.`)
  }

  assertRepositoryEntry(fixture.path, label, 'directory')
  const manifest = readFixtureManifest(fixture, label)
  if (requireLockfile) {
    assertRepositoryEntry(join(fixture.path, 'pnpm-lock.yaml'), `${label} pnpm-lock.yaml`, 'file')
    if (dependencySpecifier(manifest, descriptor.packageName) === undefined) {
      throw new Error(`${label} does not declare ${descriptor.packageName}.`)
    }
  }

  const declaredCompanions = packageCertificationDescriptors
    .filter(
      (candidate) =>
        candidate.id !== descriptor.id &&
        dependencySpecifier(manifest, candidate.packageName) !== undefined,
    )
    .map((candidate) => candidate.id)
    .sort()
  const configuredCompanions = [...(fixture.companionPackages ?? [])].sort()
  assertCompanionPackages(configuredCompanions, descriptor.id, `${label} companionPackages`)
  if (JSON.stringify(configuredCompanions) !== JSON.stringify(declaredCompanions)) {
    throw new Error(`${label} companionPackages do not match its package.json.`)
  }
}

function assertCandidateTestProfile(profile, profileId, descriptor) {
  if (profile?.kind === 'runners') {
    assertExactFields(profile, runnerFields, `Candidate-test profile ${profileId}`)
    assertUniqueStrings(profile.runners, `Candidate-test profile ${profileId} runners`)
    for (const runner of profile.runners) assertRunner(runner, descriptor)
  } else if (profile?.kind === 'apps') {
    assertExactFields(profile, appFields, `Candidate-test profile ${profileId}`)
    assertUniqueStrings(
      profile.browserRunners,
      `Candidate-test profile ${profileId} browserRunners`,
    )
    for (const runner of profile.browserRunners) assertRunner(runner, descriptor)
    assertCompanionPackages(
      profile.companionPackages,
      descriptor.id,
      `Candidate-test profile ${profileId} companionPackages`,
    )
    const packageManifest = JSON.parse(
      readFileSync(join(repositoryRoot, descriptor.packageDirectory, 'package.json'), 'utf8'),
    )
    for (const packageId of profile.companionPackages) {
      const companion = getPackageCertificationDescriptor(packageId)
      if (dependencySpecifier(packageManifest, companion.packageName) === undefined) {
        throw new Error(
          `Package ${descriptor.id} does not declare companion ${companion.packageName}.`,
        )
      }
    }
    if (!Array.isArray(profile.pnpmApps) || profile.pnpmApps.length === 0) {
      throw new Error(`Candidate-test profile ${profileId} requires pnpm apps.`)
    }
    assertFixture(profile.npmConsumer, 'npm consumer', descriptor, false)
    for (const app of profile.pnpmApps) {
      assertFixture(app, `pnpm app ${String(app?.name)}`, descriptor, true)
    }
    const fixtures = [profile.npmConsumer, ...profile.pnpmApps]
    if (
      new Set(fixtures.map((fixture) => fixture.name)).size !== fixtures.length ||
      new Set(fixtures.map((fixture) => fixture.path)).size !== fixtures.length
    ) {
      throw new Error(`Candidate-test profile ${profileId} has duplicate fixtures.`)
    }
  } else {
    throw new Error(`Candidate-test profile ${profileId} has an invalid kind.`)
  }

  if (
    typeof profile.tarballFilename !== 'string' ||
    !tarballFilenamePattern.test(profile.tarballFilename)
  ) {
    throw new Error(`Candidate-test profile ${profileId} has an invalid tarball filename.`)
  }
}

/**
 * Validate candidate descriptors against the closed package manifest and repository.
 *
 * This test seam accepts data, but release commands only select the static matrix above.
 */
export function validateCandidateTestProfiles(profiles) {
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
    throw new TypeError('Candidate-test profiles must be an object.')
  }
  const expectedProfileIds = packageCertificationDescriptors
    .map((descriptor) => descriptor.profiles.candidateTests)
    .sort()
  const actualProfileIds = Object.keys(profiles).sort()
  if (
    actualProfileIds.length !== expectedProfileIds.length ||
    actualProfileIds.some((profileId, index) => profileId !== expectedProfileIds[index])
  ) {
    throw new Error('Candidate-test profile map does not match the package certification manifest.')
  }
  for (const descriptor of packageCertificationDescriptors) {
    const profileId = descriptor.profiles.candidateTests
    assertCandidateTestProfile(profiles[profileId], profileId, descriptor)
  }
}

validateCandidateTestProfiles(candidateTestProfiles)

export function getMaintainedCandidateProfile(packageId) {
  const descriptor = getPackageCertificationDescriptor(packageId)
  const profileId = descriptor.profiles.candidateTests
  const profile = candidateTestProfiles[profileId]
  if (!profile) {
    throw new Error(`Package ${descriptor.id} has no reviewed candidate-test profile.`)
  }
  return Object.freeze({ descriptor, profile })
}
