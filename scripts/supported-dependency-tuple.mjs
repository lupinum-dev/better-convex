import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/**
 * Exact versions exercised by this repository. Published peer ranges are a
 * separate contract: consumers may move within a reviewed major while CI keeps
 * one reproducible floor/latest tuple.
 */
export const supportedDependencyTuple = Object.freeze({
  '@better-auth/core': requiredOptionalPeerDependency('@better-auth/core'),
  '@better-auth/oauth-provider': requiredOptionalPeerDependency('@better-auth/oauth-provider'),
  '@nuxt/kit': requiredRuntimeDependency('@nuxt/kit'),
  'better-auth': requiredOptionalPeerDependency('better-auth'),
  convex: requiredDevDependency('convex'),
  'convex-helpers': requiredRuntimeDependency('convex-helpers'),
  nuxt: requiredDevDependency('nuxt'),
})

export const supportedPeerRanges = Object.freeze({
  convex: requiredPeerDependency('convex'),
  nuxt: requiredPeerDependency('nuxt'),
})

export const requiredStatefulPeerNames = Object.freeze(['better-auth', 'convex'])
export const requiredPhysicalRuntimeNames = Object.freeze([
  'better-auth',
  '@better-auth/core',
  '@better-auth/oauth-provider',
  'convex',
])

validateTuple()

function requiredRuntimeDependency(name) {
  const version = packageJson.dependencies?.[name]
  if (typeof version !== 'string') {
    throw new TypeError(`package.json must declare ${name} as a runtime dependency.`)
  }
  return version
}

function requiredDevDependency(name) {
  const version = packageJson.devDependencies?.[name]
  if (typeof version !== 'string') {
    throw new TypeError(`package.json must declare ${name} as a development dependency.`)
  }
  return version
}

function requiredPeerDependency(name) {
  const version = packageJson.peerDependencies?.[name]
  if (typeof version !== 'string') {
    throw new TypeError(`package.json must declare ${name} as a peer dependency.`)
  }
  return version
}

function requiredOptionalPeerDependency(name) {
  const version = requiredPeerDependency(name)
  if (packageJson.peerDependenciesMeta?.[name]?.optional !== true) {
    throw new TypeError(`package.json must declare ${name} as an optional peer dependency.`)
  }
  return version
}

function assertExact(name, version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`${name} must use one exact supported version; received ${version}.`)
  }
}

function parseExactVersion(name, version) {
  assertExact(name, version)
  const [core] = version.split('-', 1)
  return core.split('.').map(Number)
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index] - right[index]
    if (difference !== 0) return difference
  }
  return 0
}

function assertBoundedMajorPeer(name, range, testedVersion) {
  const match = /^>=(\d+\.\d+\.\d+) <(\d+)$/u.exec(range)
  if (!match) {
    throw new Error(`${name} must use a bounded >=floor <next-major peer range; received ${range}.`)
  }
  const floor = parseExactVersion(`${name} peer floor`, match[1])
  const tested = parseExactVersion(`${name} tested version`, testedVersion)
  const upperMajor = Number(match[2])
  if (compareVersions(tested, floor) < 0 || tested[0] >= upperMajor || floor[0] >= upperMajor) {
    throw new Error(`${name}@${testedVersion} is outside its supported peer range ${range}.`)
  }
}

function validateTuple() {
  for (const [name, version] of Object.entries(supportedDependencyTuple)) {
    assertExact(name, version)
  }

  const betterAuthVersion = supportedDependencyTuple['better-auth']
  for (const name of ['@better-auth/core', '@better-auth/oauth-provider']) {
    if (supportedDependencyTuple[name] !== betterAuthVersion) {
      throw new Error(
        `${name}@${supportedDependencyTuple[name]} must match better-auth@${betterAuthVersion}.`,
      )
    }
  }

  for (const name of requiredStatefulPeerNames) {
    const developmentVersion = packageJson.devDependencies?.[name]
    if (developmentVersion !== supportedDependencyTuple[name]) {
      throw new Error(
        `package.json devDependencies must exercise ${name}@${supportedDependencyTuple[name]}; received ${developmentVersion ?? '<missing>'}.`,
      )
    }
    if (packageJson.dependencies?.[name] !== undefined) {
      throw new Error(`${name} must remain consumer-owned and cannot be a runtime dependency.`)
    }
  }

  for (const name of ['convex', 'nuxt']) {
    assertBoundedMajorPeer(name, supportedPeerRanges[name], supportedDependencyTuple[name])
  }

  for (const name of ['better-auth', '@better-auth/core', '@better-auth/oauth-provider']) {
    if (packageJson.peerDependenciesMeta?.[name]?.optional !== true) {
      throw new Error(`${name} must remain optional for Convex-only consumers.`)
    }
  }

  if (supportedDependencyTuple['@nuxt/kit'] !== supportedDependencyTuple.nuxt) {
    throw new Error(
      `@nuxt/kit@${supportedDependencyTuple['@nuxt/kit']} must match nuxt@${supportedDependencyTuple.nuxt}.`,
    )
  }

  for (const name of ['@better-auth/core', '@better-auth/oauth-provider']) {
    if (
      packageJson.devDependencies?.[name] !== supportedDependencyTuple[name] ||
      packageJson.peerDependencies?.[name] !== supportedDependencyTuple[name] ||
      packageJson.dependencies?.[name] !== undefined
    ) {
      throw new Error(`${name} must be an exact optional peer exercised in development.`)
    }
  }

  if (
    packageJson.dependencies?.kysely !== undefined ||
    packageJson.devDependencies?.kysely !== undefined ||
    packageJson.peerDependencies?.kysely !== undefined
  ) {
    throw new Error('Kysely is owned transitively by Better Auth and must not be redeclared.')
  }
}
