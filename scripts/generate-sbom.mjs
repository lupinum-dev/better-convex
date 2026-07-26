#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getPackageCertificationDescriptor } from './package-certification-manifest.mjs'
import { productionManifestContractDigest } from './package-check/production-manifest-contract.mjs'
import { derivePackagePhysicalVersions } from './reviewed-runtime-versions.mjs'
import {
  requiredPhysicalRuntimeNames,
  requiredStatefulPeerNames,
  supportedDependencyTuple,
} from './supported-dependency-tuple.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const options = parseArguments(process.argv.slice(2))
const descriptor = getPackageCertificationDescriptor(options.packageId)
const rootManifestPath = resolve(
  repositoryRoot,
  options.rootManifest ?? join(descriptor.packageDirectory, 'package.json'),
)
if (!existsSync(rootManifestPath) || !lstatSync(rootManifestPath).isFile()) {
  throw new Error(`SBOM root manifest must be a regular file: ${rootManifestPath}`)
}
const pkg = JSON.parse(readFileSync(rootManifestPath, 'utf8'))
if (
  pkg.name !== descriptor.packageName ||
  typeof pkg.version !== 'string' ||
  pkg.version.length === 0
) {
  throw new TypeError(`SBOM root manifest has an invalid package identity: ${rootManifestPath}`)
}
const reviewedPackageManifest = JSON.parse(
  readFileSync(resolve(repositoryRoot, descriptor.packageDirectory, 'package.json'), 'utf8'),
)

const sbomProfiles = Object.freeze({
  'nuxt-production-dependencies': Object.freeze({
    componentPropertyNamespace: 'better-convex-nuxt',
    generatorName: 'better-convex-nuxt-sbom-generator',
    requiredComponents: Object.freeze([
      ...new Set([...requiredStatefulPeerNames, ...requiredPhysicalRuntimeNames, 'convex-helpers']),
    ]),
    requiredPhysicalVersions: Object.freeze(
      Object.fromEntries(
        requiredPhysicalRuntimeNames.map((name) => [name, supportedDependencyTuple[name]]),
      ),
    ),
  }),
  'vue-production-dependencies': Object.freeze({
    componentPropertyNamespace: 'better-convex-vue',
    generatorName: 'better-convex-vue-sbom-generator',
    requiredComponents: Object.freeze(['convex', 'ohash', 'vue']),
  }),
  'mcp-production-dependencies': Object.freeze({
    componentPropertyNamespace: 'better-convex-mcp',
    generatorName: 'better-convex-mcp-sbom-generator',
    requiredComponents: Object.freeze(['@modelcontextprotocol/server']),
  }),
})
const sbomProfile = resolveSbomProfile(descriptor)
const requiredPhysicalVersions =
  sbomProfile.requiredPhysicalVersions ??
  derivePackagePhysicalVersions(descriptor.id, reviewedPackageManifest)

function parseArguments(args) {
  const values = new Map()
  let check = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--check') {
      if (check) throw new Error('Duplicate --check argument.')
      check = true
      continue
    }
    if (!['--package', '--root-manifest', '--output'].includes(argument)) {
      throw new Error(`Unknown SBOM argument: ${String(argument)}`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`)
    if (values.has(argument)) throw new Error(`Duplicate ${argument} argument.`)
    values.set(argument, value)
    index += 1
  }
  if (!values.has('--package') || check === values.has('--output')) {
    throw new Error(
      'Usage: generate-sbom.mjs --package <reviewed-id> [--root-manifest <package.json>] (--output <path> | --check)',
    )
  }
  return {
    check,
    output: values.get('--output'),
    packageId: values.get('--package'),
    rootManifest: values.get('--root-manifest'),
  }
}

function resolveSbomProfile(packageDescriptor) {
  const profile = sbomProfiles[packageDescriptor.profiles.sbom]
  if (!profile) {
    throw new Error(`Package ${packageDescriptor.id} has no reviewed SBOM profile.`)
  }
  return profile
}

function purl(name, version) {
  const encodedName = name.startsWith('@') ? `%40${name.slice(1)}` : encodeURIComponent(name)
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`
}

// A published package does not carry its lockfile or a resolved node_modules
// graph. Release verification therefore first proves that the extracted
// candidate's production manifest contract is exactly equal as JSON to the
// reviewed source contract, then uses that candidate as this
// SBOM's root while resolving transitive production components from the
// frozen-lock checkout. A consuming application's peer/transitive closure
// belongs in that application's own resolved SBOM.
const listed = JSON.parse(
  execFileSync(
    'pnpm',
    ['list', '--filter', descriptor.packageName, '--prod', '--json', '--depth', 'Infinity'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
    },
  ),
)
if (!Array.isArray(listed) || listed.length !== 1 || listed[0]?.name !== descriptor.packageName) {
  throw new Error(
    `Frozen workspace graph did not resolve exactly one ${descriptor.packageName} root.`,
  )
}
const resolvedRootDependencies = listed[0].dependencies ?? {}
for (const dependencyName of Object.keys(pkg.dependencies ?? {})) {
  if (!resolvedRootDependencies[dependencyName]) {
    throw new Error(`Frozen workspace graph cannot resolve candidate dependency ${dependencyName}.`)
  }
}
const components = new Map()

function addComponent(name, version, dependencyKind) {
  const bomRef = purl(name, version)
  const existing = components.get(bomRef)
  if (existing) {
    if (dependencyKind && !existing.properties) {
      existing.properties = [
        {
          name: `${sbomProfile.componentPropertyNamespace}:dependency-kind`,
          value: dependencyKind,
        },
      ]
    }
    return existing
  }

  const component = {
    type: 'library',
    'bom-ref': bomRef,
    name,
    version,
    purl: bomRef,
    ...(dependencyKind
      ? {
          properties: [
            {
              name: `${sbomProfile.componentPropertyNamespace}:dependency-kind`,
              value: dependencyKind,
            },
          ],
        }
      : {}),
  }
  components.set(bomRef, component)
  return component
}

function collect(dependencies) {
  for (const [name, dependency] of Object.entries(dependencies ?? {})) {
    if (!dependency.version) continue
    addComponent(name, dependency.version)
    collect(dependency.dependencies)
  }
}

for (const dependencyName of Object.keys(pkg.dependencies ?? {})) {
  const dependency = resolvedRootDependencies[dependencyName]
  addComponent(dependencyName, dependency.version)
  collect(dependency.dependencies)
}

// Better Auth and Convex are exact required peers so the consuming application
// owns one physical runtime tuple. `pnpm list --prod` correctly omits them from
// this package's dependency closure, but they remain required production
// components of the published contract and must be visible in its SBOM. Their
// transitive closure belongs to the consuming application's resolved SBOM.
for (const [name, version] of Object.entries(pkg.peerDependencies ?? {})) {
  const dependencyKind = pkg.peerDependenciesMeta?.[name]?.optional
    ? 'optional-peer'
    : 'required-peer'
  addComponent(name, requiredPhysicalVersions[name] ?? version, dependencyKind)
}
for (const [name, version] of Object.entries(requiredPhysicalVersions)) {
  addComponent(name, version, pkg.peerDependencies?.[name] ? 'required-peer' : 'required-runtime')
}

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: {
      components: [
        {
          type: 'application',
          name: sbomProfile.generatorName,
          version: pkg.version,
        },
      ],
    },
    component: {
      type: 'library',
      name: pkg.name,
      version: pkg.version,
      purl: purl(pkg.name, pkg.version),
      properties: [
        {
          name: `${sbomProfile.componentPropertyNamespace}:production-manifest-contract-sha256`,
          value: productionManifestContractDigest(descriptor.id, pkg),
        },
      ],
    },
  },
  components: [...components.values()].sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref'])),
}

if (bom.components.length === 0) throw new Error('SBOM contains no production dependencies.')
for (const required of sbomProfile.requiredComponents) {
  if (!bom.components.some((component) => component.name === required)) {
    throw new Error(`SBOM is missing required production component ${required}.`)
  }
}

if (options.check) {
  console.log(`CycloneDX SBOM check passed (${bom.components.length} production components).`)
} else {
  writeFileSync(resolve(repositoryRoot, options.output), `${JSON.stringify(bom, null, 2)}\n`)
  console.log(`Generated CycloneDX SBOM at ${options.output}`)
}
