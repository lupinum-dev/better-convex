import { readFileSync } from 'node:fs'

import { supportedDependencyTuple, supportedPeerRanges } from './supported-dependency-tuple.mjs'

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
