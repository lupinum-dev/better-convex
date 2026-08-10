import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import { getPackageCertificationDescriptor } from '../package-certification-manifest.mjs'

const productionManifestContractSchemaVersion = 1
const releaseManifestPolicy = Object.freeze({
  forbiddenLifecycleScripts: Object.freeze([
    'preinstall',
    'install',
    'postinstall',
    'prepublish',
    'prepublishOnly',
    'preprepare',
    'prepare',
    'postprepare',
    'predependencies',
    'dependencies',
    'postdependencies',
    'postpack',
    'publish',
    'postpublish',
  ]),
  requiredLifecycleScripts: Object.freeze(['prepack']),
})

/**
 * Package-specific policy selected only through a closed certification
 * descriptor. Required fields cannot disappear from both source and candidate;
 * forbidden fields need an intentional policy change before they can alter
 * installation behavior. Raw export fields are bound here; P2-007 separately
 * owns their entry-level semantics and runtime/type purity.
 */
const contractProfiles = Object.freeze({
  'nuxt-production-dependencies': Object.freeze({
    requiredPackageFields: Object.freeze([
      'name',
      'version',
      'type',
      'main',
      'typesVersions',
      'exports',
      'bin',
      'files',
      'dependencies',
      'peerDependencies',
      'peerDependenciesMeta',
      'engines',
      'packageManager',
    ]),
    forbiddenPackageFields: Object.freeze([
      'private',
      'module',
      'browser',
      'types',
      'typings',
      'imports',
      'man',
      'directories',
      'gypfile',
      'sideEffects',
      'optionalDependencies',
      'bundleDependencies',
      'bundledDependencies',
      'os',
      'cpu',
      'libc',
      'publishConfig',
    ]),
    ...releaseManifestPolicy,
    validate: assertNuxtManifestShapes,
  }),
  'vue-production-dependencies': Object.freeze({
    requiredPackageFields: Object.freeze([
      'name',
      'version',
      'description',
      'license',
      'files',
      'type',
      'sideEffects',
      'exports',
      'dependencies',
      'peerDependencies',
      'peerDependenciesMeta',
      'engines',
    ]),
    forbiddenPackageFields: Object.freeze([
      'private',
      'main',
      'module',
      'browser',
      'types',
      'typings',
      'typesVersions',
      'imports',
      'bin',
      'man',
      'directories',
      'gypfile',
      'optionalDependencies',
      'bundleDependencies',
      'bundledDependencies',
      'os',
      'cpu',
      'libc',
      'publishConfig',
      'packageManager',
    ]),
    ...releaseManifestPolicy,
    validate: assertVueManifestShapes,
  }),
  'mcp-production-dependencies': Object.freeze({
    requiredPackageFields: Object.freeze([
      'name',
      'version',
      'description',
      'license',
      'files',
      'type',
      'sideEffects',
      'exports',
      'dependencies',
      'engines',
    ]),
    forbiddenPackageFields: Object.freeze([
      'private',
      'main',
      'module',
      'browser',
      'types',
      'typings',
      'typesVersions',
      'imports',
      'bin',
      'man',
      'directories',
      'gypfile',
      'optionalDependencies',
      'peerDependencies',
      'peerDependenciesMeta',
      'bundleDependencies',
      'bundledDependencies',
      'os',
      'cpu',
      'libc',
      'publishConfig',
      'packageManager',
    ]),
    ...releaseManifestPolicy,
    validate: assertMcpManifestShapes,
  }),
})

export function selectProductionManifestContract(packageId, manifest) {
  assertPlainObject(manifest)
  const { descriptor, profile, profileId } = resolveProductionManifestProfile(packageId)
  if (manifest.name !== descriptor.packageName) {
    throw new Error(
      `Production package manifest name ${String(manifest.name)} does not match ${descriptor.packageName}.`,
    )
  }
  for (const field of profile.requiredPackageFields) {
    if (!Object.hasOwn(manifest, field)) {
      throw new Error(`Production package manifest is missing required field ${field}.`)
    }
  }
  for (const field of profile.forbiddenPackageFields) {
    if (Object.hasOwn(manifest, field)) {
      throw new Error(`Production package manifest uses forbidden field ${field}.`)
    }
  }
  if (descriptor.packageDirectory !== '.' && Object.hasOwn(manifest, 'packageManager')) {
    throw new Error('Nested packages must not declare a package-local package manager.')
  }
  profile.validate(manifest, profile)
  const lifecycleScripts = Object.fromEntries(
    profile.requiredLifecycleScripts.map((script) => [script, manifest.scripts[script]]),
  )

  return {
    schemaVersion: productionManifestContractSchemaVersion,
    profile: profileId,
    manifest: {
      ...Object.fromEntries(profile.requiredPackageFields.map((field) => [field, manifest[field]])),
      scripts: lifecycleScripts,
    },
  }
}

export function assertProductionManifestContract(packageId, candidate, reviewed) {
  if (
    !isDeepStrictEqual(
      selectProductionManifestContract(packageId, candidate),
      selectProductionManifestContract(packageId, reviewed),
    )
  ) {
    throw new Error(
      'Packed production manifest contract does not exactly match the reviewed source manifest.',
    )
  }
}

export function productionManifestContractDigest(packageId, manifest) {
  const canonical = canonicalizeJson(selectProductionManifestContract(packageId, manifest))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function resolveProductionManifestProfile(packageId) {
  const descriptor = getPackageCertificationDescriptor(packageId)
  const profileId = descriptor.profiles.sbom
  const profile = contractProfiles[profileId]
  if (!profile) {
    throw new Error(`Package ${descriptor.id} has no reviewed production-manifest profile.`)
  }
  const allFields = [...profile.requiredPackageFields, ...profile.forbiddenPackageFields]
  if (
    new Set(allFields).size !== allFields.length ||
    new Set([...profile.requiredLifecycleScripts, ...profile.forbiddenLifecycleScripts]).size !==
      profile.requiredLifecycleScripts.length + profile.forbiddenLifecycleScripts.length ||
    typeof profile.validate !== 'function'
  ) {
    throw new Error(`Package ${descriptor.id} production-manifest profile is invalid.`)
  }
  return { descriptor, profile, profileId }
}

function assertNuxtManifestShapes(manifest, profile) {
  for (const field of ['name', 'version', 'type', 'main', 'packageManager']) {
    if (typeof manifest[field] !== 'string' || manifest[field].length === 0) {
      throw new Error(`Production package manifest field ${field} must be a non-empty string.`)
    }
  }
  for (const field of ['typesVersions', 'exports']) {
    assertPlainRecord(manifest[field], field)
  }
  for (const field of ['bin', 'dependencies', 'peerDependencies', 'engines']) {
    assertStringMap(manifest[field], field)
  }
  assertPlainRecord(manifest.peerDependenciesMeta, 'peerDependenciesMeta')
  if (
    !isDeepStrictEqual(manifest.peerDependenciesMeta, {
      '@better-auth/oauth-provider': { optional: true },
      'better-auth': { optional: true },
    }) ||
    manifest.peerDependencies['@better-auth/oauth-provider'] !== '1.7.0-rc.2' ||
    manifest.peerDependencies['better-auth'] !== '1.7.0-rc.2'
  ) {
    throw new Error('Nuxt auth packages must be exact optional peers.')
  }
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0 ||
    manifest.files.some((file) => typeof file !== 'string' || file.length === 0)
  ) {
    throw new Error('Production package manifest field files must be non-empty strings.')
  }
  assertReleaseManifestPolicy(manifest, profile)
}

function assertVueManifestShapes(manifest, profile) {
  for (const field of ['name', 'version', 'description', 'license', 'type']) {
    if (typeof manifest[field] !== 'string' || manifest[field].length === 0) {
      throw new Error(`Production package manifest field ${field} must be a non-empty string.`)
    }
  }
  if (manifest.type !== 'module' || manifest.sideEffects !== false) {
    throw new Error('Vue package must be ESM-only and side-effect free.')
  }
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length !== 1 ||
    manifest.files[0] !== 'dist'
  ) {
    throw new Error('Vue package files must contain only dist.')
  }
  for (const field of ['exports']) assertPlainRecord(manifest[field], field)
  for (const field of ['dependencies', 'peerDependencies', 'engines']) {
    assertStringMap(manifest[field], field)
  }
  assertPlainRecord(manifest.peerDependenciesMeta, 'peerDependenciesMeta')
  if (
    !isDeepStrictEqual(manifest.peerDependenciesMeta, {
      '@modelcontextprotocol/ext-apps': { optional: true },
      '@modelcontextprotocol/sdk': { optional: true },
      zod: { optional: true },
    }) ||
    manifest.peerDependencies['@modelcontextprotocol/ext-apps'] !== '1.7.5' ||
    manifest.peerDependencies['@modelcontextprotocol/sdk'] !== '1.30.0' ||
    manifest.peerDependencies.zod !== '4.4.3'
  ) {
    throw new Error('Vue MCP App packages must be exact optional peers.')
  }
  assertReleaseManifestPolicy(manifest, profile)
}

function assertMcpManifestShapes(manifest, profile) {
  for (const field of ['name', 'version', 'description', 'license', 'type']) {
    if (typeof manifest[field] !== 'string' || manifest[field].length === 0) {
      throw new Error(`Production package manifest field ${field} must be a non-empty string.`)
    }
  }
  if (manifest.type !== 'module' || manifest.sideEffects !== false) {
    throw new Error('MCP package must be ESM-only and side-effect free.')
  }
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length !== 1 ||
    manifest.files[0] !== 'dist'
  ) {
    throw new Error('MCP package files must contain only dist.')
  }
  assertPlainRecord(manifest.exports, 'exports')
  for (const field of ['dependencies', 'engines']) assertStringMap(manifest[field], field)
  assertReleaseManifestPolicy(manifest, profile)
  if (
    Object.keys(manifest.dependencies).length !== 1 ||
    !Object.hasOwn(manifest.dependencies, '@modelcontextprotocol/server')
  ) {
    throw new Error('MCP package must pin exactly one official server SDK dependency.')
  }
}

function assertReleaseManifestPolicy(manifest, profile) {
  if (Object.keys(manifest.engines).length !== 1 || typeof manifest.engines.node !== 'string') {
    throw new Error('Production package manifest engines must declare only node.')
  }
  assertStringMap(manifest.scripts, 'scripts')
  for (const script of profile.requiredLifecycleScripts) {
    if (!Object.hasOwn(manifest.scripts, script)) {
      throw new Error(`Production package manifest is missing required lifecycle script ${script}.`)
    }
  }
  for (const script of profile.forbiddenLifecycleScripts) {
    if (Object.hasOwn(manifest.scripts, script)) {
      throw new Error(`Production package manifest uses forbidden lifecycle script ${script}.`)
    }
  }
}

function assertStringMap(value, field) {
  assertPlainRecord(value, field)
  if (
    Object.entries(value).some(
      ([key, entry]) => key.length === 0 || typeof entry !== 'string' || entry.length === 0,
    )
  ) {
    throw new Error(`Production package manifest field ${field} must be a string map.`)
  }
}

function assertPlainRecord(value, field) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Object.keys(value).length === 0
  ) {
    throw new Error(`Production package manifest field ${field} must be a non-empty object.`)
  }
}

function assertPlainObject(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError('Production package manifest must be a plain JSON object.')
  }
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeJson(value[key])]),
  )
}
