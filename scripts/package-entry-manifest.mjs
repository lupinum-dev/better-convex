/**
 * Canonical publishable package contracts, selected through the reviewed
 * certification descriptor rather than a caller-supplied profile or path.
 *
 * Keep tool-specific behavior (AST probes and purity implementations) in the
 * consuming scripts. Paths and public names live here so package verification
 * and generated API documentation cannot maintain competing allowlists.
 */
import { getPackageCertificationDescriptor } from './package-certification-manifest.mjs'

const nuxtPackageEntries = [
  {
    kind: 'runtime',
    subpath: '.',
    distJs: 'dist/module.mjs',
    distDts: 'dist/types.d.mts',
    valueExports: ['default'],
    typeExports: [
      'BaseAuthClient',
      'ConvexAuthMode',
      'ConvexAuthOptions',
      'ConvexAuthClientRegistry',
      'ConvexAuthStatus',
      'ConvexCallErrorKind',
      'ConvexClientHandle',
      'ConvexRuntimeConfig',
      'ConvexUser',
      'InferRegisteredConvexAuthClient',
      'ModuleOptions',
      'ServerConvexOptions',
      'UploadProgressInfo',
      'UploadStatus',
      'UploadUrlMutation',
      'UseConvexAuthReturn',
      'UseConvexFileUploadOptions',
      'UseConvexFileUploadReturn',
      'UseConvexMutationOptions',
      'UseConvexPaginatedQueryOptions',
      'UseConvexQueryOptions',
    ],
    exactDeclaredExports: true,
    forbiddenNames: [
      'usePermissions',
      'createPermissions',
      'createBetterConvexAuthClient',
      'resolveBetterConvexAuthBaseURL',
      'useConvexCall',
      'getQueryKey',
      'BetterConvexAuthClientOptions',
      'BetterConvexAuthClientPluginList',
      'ConvexPublicRuntimeConfig',
    ],
  },
  {
    kind: 'runtime',
    subpath: './errors',
    distJs: 'dist/runtime/errors/index.js',
    distDts: 'dist/runtime/errors/index.d.ts',
    valueExports: ['ConvexCallError', 'normalizeConvexError', 'isSerializedConvexCallError'],
    typeExports: [
      'CallResult',
      'ConvexCallErrorKind',
      'ConvexCallErrorInput',
      'SerializedConvexCallError',
    ],
    exactDeclaredExports: true,
    forbiddenNames: ['toError'],
  },
  {
    kind: 'runtime',
    subpath: './auth-client',
    distJs: 'dist/runtime/auth-client/index.js',
    distDts: 'dist/runtime/auth-client/index.d.ts',
    valueExports: ['defineConvexAuthClient'],
    typeExports: [
      'BaseAuthClient',
      'ConvexAuthClientDefinition',
      'ConvexAuthClientRegistry',
      'InferRegisteredConvexAuthClient',
    ],
    exactDeclaredExports: true,
    forbiddenNames: [],
  },
  {
    kind: 'runtime',
    subpath: './convex-auth',
    distJs: 'dist/runtime/convex-auth/index.js',
    distDts: 'dist/runtime/convex-auth/index.d.ts',
    valueExports: [
      'convexAuth',
      'createBetterAuthMcpAccessVerifier',
      'createAuthComponent',
      'defineAuthAdapterFunctions',
      'getConvexAuthProvider',
      'requireAuthOrigin',
      'verifyOAuthBearerToken',
    ],
    typeExports: [
      'AuthComponentTriggers',
      'AuthCtx',
      'AuthFunctions',
      'BetterAuthMcpAccessVerifierOptions',
      'CreateAuth',
      'VerifyOAuthBearerTokenOptions',
    ],
    exactDeclaredExports: true,
    forbiddenNames: [],
  },
  {
    kind: 'runtime',
    subpath: './convex-auth/convex.config',
    distJs: 'dist/runtime/convex-auth/component/convex.config.js',
    distDts: 'dist/runtime/convex-auth/component/convex.config.d.ts',
    valueExports: ['default'],
    typeExports: [],
    exactDeclaredExports: true,
    forbiddenNames: [],
  },
  {
    kind: 'types-only',
    subpath: './convex-auth/_generated/component.js',
    distDts: 'dist/runtime/convex-auth/component/_generated/component.d.ts',
    valueExports: [],
    typeExports: ['ComponentApi'],
    exactDeclaredExports: true,
    forbiddenNames: [],
  },
  {
    kind: 'runtime',
    subpath: './convex-auth/test',
    distJs: 'dist/runtime/convex-auth/test.js',
    distDts: 'dist/runtime/convex-auth/test.d.ts',
    valueExports: ['default', 'register'],
    typeExports: [],
    exactDeclaredExports: true,
    forbiddenNames: [],
  },
  {
    kind: 'runtime',
    subpath: './server',
    distJs: 'dist/runtime/server/index.js',
    distDts: 'dist/runtime/server/index.d.ts',
    valueExports: ['serverConvex'],
    typeExports: ['ServerConvexCaller', 'ServerConvexOptions'],
    exactDeclaredExports: true,
    forbiddenNames: [
      'serverConvexQuery',
      'serverConvexMutation',
      'serverConvexAction',
      'fetchQuery',
      'fetchMutation',
      'fetchAction',
    ],
  },
  {
    kind: 'runtime',
    subpath: './server/createUserSyncTriggers',
    distJs: 'dist/runtime/server/createUserSyncTriggers.js',
    distDts: 'dist/runtime/server/createUserSyncTriggers.d.ts',
    valueExports: ['createUserSyncTriggers'],
    typeExports: ['BetterAuthUserDocLike', 'CreateUserSyncTriggersOptions'],
    exactDeclaredExports: true,
    forbiddenNames: [],
  },
]

const nuxtPackageBins = {
  'better-convex-nuxt-auth-schema': './dist/runtime/cli/auth-schema.js',
  'better-convex-nuxt-convex': './dist/runtime/cli/convex.js',
}

const vuePackageEntries = [
  {
    kind: 'runtime',
    subpath: '.',
    distJs: 'dist/index.mjs',
    distDts: 'dist/index.d.mts',
    valueExports: [
      'ConvexCallError',
      'createBetterConvex',
      'useConvex',
      'useConvexAction',
      'useConvexConnectionState',
      'useConvexMutation',
      'useConvexPaginatedQuery',
      'useConvexQuery',
    ],
    typeExports: [
      'BetterConvexAuthAdapter',
      'BetterConvexAuthSnapshot',
      'BetterConvexIdentitySnapshot',
      'CallResult',
      'ConvexAuthMode',
      'ConvexCallErrorKind',
      'ConvexClientHandle',
      'ConvexQueryArgs',
      'CreateBetterConvexOptions',
      'PaginatedQueryArgs',
      'PaginatedQueryItem',
      'PaginatedQueryReference',
      'UseConvexActionOptions',
      'UseConvexCallableReturn',
      'UseConvexMutationOptions',
      'UseConvexPaginatedQueryOptions',
      'UseConvexQueryOptions',
    ],
    exactDeclaredExports: true,
    forbiddenNames: [
      'attachClientIdentity',
      'createBetterConvexBrowserRuntime',
      'createCallableController',
      'createClientOwner',
      'createPaginationController',
      'createQueryController',
    ],
  },
  {
    kind: 'runtime',
    subpath: './errors',
    distJs: 'dist/errors.mjs',
    distDts: 'dist/errors.d.mts',
    valueExports: ['ConvexCallError', 'isSerializedConvexCallError', 'normalizeConvexError'],
    typeExports: [
      'CallResult',
      'ConvexCallErrorInput',
      'ConvexCallErrorKind',
      'SerializedConvexCallError',
    ],
    exactDeclaredExports: true,
    forbiddenNames: ['isConvexApplicationError', 'readStructuredData'],
  },
  {
    kind: 'runtime',
    subpath: './embedded',
    distJs: 'dist/embedded.mjs',
    distDts: 'dist/embedded.d.mts',
    valueExports: ['createBetterConvexAttachment'],
    typeExports: [
      'BetterConvexAttachedRuntime',
      'BetterConvexIdentityObserver',
      'BetterConvexIdentitySnapshot',
      'ConvexClientHandle',
    ],
    exactDeclaredExports: true,
    forbiddenNames: ['attachClientIdentity', 'createAttachedBrowserFacade'],
  },
  {
    kind: 'runtime',
    subpath: './mcp-app',
    distJs: 'dist/mcp-app.mjs',
    distDts: 'dist/mcp-app.d.mts',
    valueExports: ['useMcpApp'],
    typeExports: [],
    exactDeclaredExports: true,
    forbiddenNames: [
      'callTool',
      'createMcpAppPlugin',
      'openLink',
      'useMcpHostContext',
      'useMcpToolInput',
      'useMcpToolResult',
    ],
  },
]

const mcpPackageEntries = [
  {
    kind: 'runtime',
    subpath: '.',
    distJs: 'dist/index.mjs',
    distDts: 'dist/index.d.mts',
    valueExports: ['handleMcpRequest', 'runMcpTool'],
    typeExports: [
      'HandleMcpRequestOptions',
      'McpAccessContext',
      'McpAccessVerifier',
      'VerifiedMcpAccess',
    ],
    exactDeclaredExports: true,
    forbiddenNames: [
      'McpPrincipal',
      'definePermissions',
      'registerConvexTools',
      'requireMcpScope',
      'withBetterConvex',
    ],
  },
]

const entryKinds = new Set(['runtime', 'types-only'])
const runtimeEntryFields = new Set([
  'kind',
  'subpath',
  'distJs',
  'distDts',
  'valueExports',
  'typeExports',
  'exactDeclaredExports',
  'forbiddenNames',
])
const typesOnlyEntryFields = new Set([
  'kind',
  'subpath',
  'distDts',
  'valueExports',
  'typeExports',
  'exactDeclaredExports',
  'forbiddenNames',
])
const packageRelativePathPattern = /^[\w.-]+(?:\/[\w.-]+)*$/u

const entryProfiles = {
  'nuxt-public-entries': {
    entries: nuxtPackageEntries,
    bins: nuxtPackageBins,
  },
  'vue-public-entries': {
    entries: vuePackageEntries,
    bins: {},
  },
  'mcp-public-entries': {
    entries: mcpPackageEntries,
    bins: {},
  },
}

function validatePackageEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError('Package entries must be a non-empty array')
  }
  const subpaths = new Set()
  const artifactPaths = new Set()

  for (const entry of entries) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      (Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null)
    ) {
      throw new TypeError('Package entry must be a plain object')
    }
    if (!entryKinds.has(entry.kind)) {
      throw new TypeError(
        `Package entry ${entry.subpath ?? '<missing>'} has invalid kind ${entry.kind}`,
      )
    }
    const expectedFields = entry.kind === 'runtime' ? runtimeEntryFields : typesOnlyEntryFields
    const actualFields = Object.keys(entry)
    const missingFields = [...expectedFields].filter((field) => !actualFields.includes(field))
    const unexpectedFields = actualFields.filter((field) => !expectedFields.has(field))
    if (missingFields.length > 0 || unexpectedFields.length > 0) {
      throw new TypeError(
        `Package entry ${entry.subpath ?? '<missing>'} has invalid fields` +
          `${missingFields.length > 0 ? `; missing: ${missingFields.join(', ')}` : ''}` +
          `${unexpectedFields.length > 0 ? `; unexpected: ${unexpectedFields.join(', ')}` : ''}`,
      )
    }
    if (
      typeof entry.subpath !== 'string' ||
      (entry.subpath !== '.' &&
        (!entry.subpath.startsWith('./') || !isCanonicalPackagePath(entry.subpath.slice(2))))
    ) {
      throw new TypeError(`Package entry subpath must be canonical: ${entry.subpath}`)
    }
    if (subpaths.has(entry.subpath)) {
      throw new Error(`Package entry subpath must be unique: ${entry.subpath}`)
    }
    subpaths.add(entry.subpath)

    if (!isCanonicalDistPath(entry.distDts) || !/\.d\.m?ts$/u.test(entry.distDts)) {
      throw new TypeError(`Package entry ${entry.subpath} must declare canonical distDts`)
    }
    for (const property of ['valueExports', 'typeExports', 'forbiddenNames']) {
      const names = entry[property]
      if (
        !Array.isArray(names) ||
        names.some((name) => typeof name !== 'string' || name.length === 0) ||
        new Set(names).size !== names.length
      ) {
        throw new TypeError(`Package entry ${entry.subpath} must declare unique string ${property}`)
      }
    }
    if (typeof entry.exactDeclaredExports !== 'boolean') {
      throw new TypeError(`Package entry ${entry.subpath} exactDeclaredExports must be boolean`)
    }
    if (
      entry.kind === 'runtime' &&
      (!isCanonicalDistPath(entry.distJs) || !/\.m?js$/u.test(entry.distJs))
    ) {
      throw new TypeError(`Runtime package entry ${entry.subpath} must declare canonical distJs`)
    }
    if (entry.kind === 'types-only' && ('distJs' in entry || entry.valueExports.length > 0)) {
      throw new TypeError(
        `Types-only package entry ${entry.subpath} cannot declare JavaScript or values`,
      )
    }
    if (
      entry.kind === 'runtime' &&
      ((entry.distJs.endsWith('.mjs') && !entry.distDts.endsWith('.d.mts')) ||
        (entry.distJs.endsWith('.js') && !entry.distDts.endsWith('.d.ts')))
    ) {
      throw new TypeError(
        `Runtime package entry ${entry.subpath} must pair its JavaScript and declaration module kinds`,
      )
    }

    const publicNames = new Set([...entry.valueExports, ...entry.typeExports])
    if (publicNames.size !== entry.valueExports.length + entry.typeExports.length) {
      throw new TypeError(`Package entry ${entry.subpath} repeats a public export name`)
    }
    if (entry.forbiddenNames.some((name) => publicNames.has(name))) {
      throw new TypeError(`Package entry ${entry.subpath} allows and forbids the same export name`)
    }

    for (const artifactPath of [entry.distJs, entry.distDts].filter(Boolean)) {
      if (artifactPaths.has(artifactPath)) {
        throw new Error(`Package entry artifact path must be unique: ${artifactPath}`)
      }
      artifactPaths.add(artifactPath)
    }
  }

  return entries
}

function validatePackageBins(bins) {
  if (bins === null || typeof bins !== 'object' || Array.isArray(bins)) {
    throw new TypeError('Package bins must be a command map')
  }
  for (const [command, target] of Object.entries(bins)) {
    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(command)) {
      throw new TypeError(`Package bin command must be canonical: ${command}`)
    }
    if (
      typeof target !== 'string' ||
      !target.startsWith('./dist/') ||
      !isCanonicalDistPath(target.slice(2)) ||
      !/\.m?js$/u.test(target)
    ) {
      throw new TypeError(`Package bin target must be canonical JavaScript in dist: ${target}`)
    }
  }
  return bins
}

function isCanonicalDistPath(path) {
  return typeof path === 'string' && path.startsWith('dist/') && isCanonicalPackagePath(path)
}

function isCanonicalPackagePath(path) {
  return (
    typeof path === 'string' &&
    packageRelativePathPattern.test(path) &&
    path.split('/').every((segment) => segment !== '.' && segment !== '..')
  )
}

function deepFreezeProfile(profile) {
  for (const entry of profile.entries) {
    Object.freeze(entry.valueExports)
    Object.freeze(entry.typeExports)
    Object.freeze(entry.forbiddenNames)
    Object.freeze(entry)
  }
  Object.freeze(profile.entries)
  Object.freeze(profile.bins)
  return Object.freeze(profile)
}

for (const profile of Object.values(entryProfiles)) {
  validatePackageEntries(profile.entries)
  validatePackageBins(profile.bins)
  deepFreezeProfile(profile)
}
Object.freeze(entryProfiles)

export function getPackageEntryManifest(packageId, options) {
  const descriptor = getPackageCertificationDescriptor(packageId, options)
  const profileId = descriptor.profiles.exports
  const profile = entryProfiles[profileId]
  if (!profile) {
    throw new Error(`Package ${descriptor.id} has no reviewed package-entry profile.`)
  }
  return Object.freeze({
    packageId: descriptor.id,
    packageName: descriptor.packageName,
    packageDirectory: descriptor.packageDirectory,
    profileId,
    entries: profile.entries,
    bins: profile.bins,
  })
}

export function getPackageEntry(packageId, subpath, options) {
  const manifest = getPackageEntryManifest(packageId, options)
  const entry = manifest.entries.find((candidate) => candidate.subpath === subpath)
  if (!entry) throw new Error(`Unknown package entry for ${manifest.packageId}: ${subpath}`)
  return entry
}

export { validatePackageEntries }
