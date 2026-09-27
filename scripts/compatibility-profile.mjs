import { readFileSync } from 'node:fs'

import {
  sharedPackageRuntimes,
  supportedDependencyTuple,
  supportedPeerRanges,
} from './supported-dependency-tuple.mjs'

const vuePackage = JSON.parse(
  readFileSync(new URL('../packages/vue/package.json', import.meta.url), 'utf8'),
)
const vueFloor = requiredVersion(vuePackage.devDependencies, 'vue', 'Vue development dependency')
const vueRange = requiredVersion(vuePackage.peerDependencies, 'vue', 'Vue peer dependency')

export const compatibilityProfiles = Object.freeze({
  floor: Object.freeze({
    '@nuxt/schema': supportedDependencyTuple.nuxt,
    convex: supportedDependencyTuple.convex,
    nuxt: supportedDependencyTuple.nuxt,
    vue: vueFloor,
  }),
  'latest-compatible': Object.freeze({
    '@nuxt/schema': supportedPeerRanges.nuxt,
    convex: supportedPeerRanges.convex,
    nuxt: supportedPeerRanges.nuxt,
    vue: vueRange,
  }),
})

function requiredVersion(section, name, label) {
  const version = section?.[name]
  if (typeof version !== 'string') throw new TypeError(`${label} ${name} is required.`)
  return version
}

export const compatibilityProfileNames = Object.freeze(Object.keys(compatibilityProfiles))

export function applyCompatibilityProfile(manifest, profileName) {
  if (profileName === undefined) return manifest
  const profile = compatibilityProfiles[profileName]
  if (!profile) {
    throw new Error(
      `Unknown compatibility profile ${String(profileName)}; expected ${compatibilityProfileNames.join(' or ')}`,
    )
  }

  for (const sectionName of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const section = manifest[sectionName]
    if (!section) continue
    for (const [packageName, version] of Object.entries(profile)) {
      if (Object.hasOwn(section, packageName)) section[packageName] = version
    }
  }
  return manifest
}

const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u

/**
 * A committed application follows the exact tuple of its pinned published releases. Its
 * candidate copy installs the candidate tarballs, so it declares their exact peers and their
 * shared runtimes instead.
 */
export function adoptCandidateTuple(manifest, candidateManifests) {
  const requirements = new Map()
  for (const candidate of candidateManifests) {
    for (const [name, version] of Object.entries(candidate.peerDependencies ?? {})) {
      if (exactVersionPattern.test(version)) requirements.set(name, version)
    }
    for (const name of sharedPackageRuntimes[candidate.name] ?? []) {
      const version = candidate.dependencies?.[name]
      if (!exactVersionPattern.test(version ?? '')) {
        throw new Error(`${candidate.name} must declare one exact shared ${name} runtime`)
      }
      requirements.set(name, version)
    }
  }
  for (const sectionName of ['dependencies', 'devDependencies']) {
    const section = manifest[sectionName]
    if (!section) continue
    for (const [name, version] of requirements) {
      if (Object.hasOwn(section, name)) section[name] = version
    }
  }
  return manifest
}
