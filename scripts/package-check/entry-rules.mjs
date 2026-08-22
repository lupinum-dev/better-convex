import { getPackageEntryManifest } from '../package-entry-manifest.mjs'
import {
  probeAuthClientTyping,
  probeCreateUserProjectionTriggers,
  probeErrorsEntry,
  probeRootEntry,
  probeServerEntry,
} from './probes.mjs'

// ---------------------------------------------------------------------------
// Table-driven entries (architecture invariant)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} PurityRule
 * @property {string[]} runtimeExternalSpecifiers - exact external specifiers reachable from emitted JavaScript
 * @property {string[]} typeExternalSpecifiers - exact external specifiers reachable from emitted declarations
 *
 * @typedef {object} CheckerEntryRule
 * @property {string} subpath - the package.json `exports` key
 * @property {PurityRule} purity - exact packed runtime and declaration dependency surfaces
 * @property {(ctx: ProbeContext) => void} [packedProbe] - packed consumer probe, run against the extracted tarball
 */

/** @type {CheckerEntryRule[]} */
const NUXT_CHECKER_ENTRY_RULES = [
  {
    subpath: '.',
    purity: {
      runtimeExternalSpecifiers: ['@nuxt/kit', 'defu', 'node:fs'],
      typeExternalSpecifiers: [
        '@nuxt/schema',
        '@lupinum/better-convex-vue',
        '@lupinum/better-convex-vue/errors',
        'convex/browser',
        'convex/server',
        'convex/values',
        'vue',
      ],
    },
    packedProbe: probeRootEntry,
  },
  {
    subpath: './errors',
    purity: {
      runtimeExternalSpecifiers: ['@lupinum/better-convex-vue/errors'],
      typeExternalSpecifiers: ['@lupinum/better-convex-vue/errors'],
    },
    packedProbe: probeErrorsEntry,
  },
  {
    subpath: './better-auth/client',
    purity: {
      runtimeExternalSpecifiers: [],
      typeExternalSpecifiers: [
        '@better-auth/oauth-provider/client',
        'better-auth/client',
        'better-auth/client/plugins',
        'better-auth/vue',
      ],
    },
    packedProbe: probeAuthClientTyping,
  },
  {
    subpath: './better-auth/server',
    purity: {
      runtimeExternalSpecifiers: [
        '@better-auth/oauth-provider',
        '@better-auth/oauth-provider/resource-client',
        'better-auth',
        'better-auth/adapters',
        'better-auth/api',
        'better-auth/crypto',
        'better-auth/oauth2',
        'better-auth/plugins',
        'convex-helpers/server/stream',
        'convex/server',
        'convex/values',
      ],
      typeExternalSpecifiers: [
        '@better-auth/oauth-provider',
        'better-auth',
        'better-auth/adapters',
        'better-auth/plugins',
        'better-auth/plugins/jwt',
        'convex/server',
        'convex/values',
      ],
    },
    packedProbe: probeCreateUserProjectionTriggers,
  },
  {
    subpath: './better-auth/convex.config',
    purity: {
      runtimeExternalSpecifiers: ['convex/server'],
      typeExternalSpecifiers: ['convex/server'],
    },
  },
  {
    subpath: './better-auth/_generated/component.js',
    purity: {
      runtimeExternalSpecifiers: [],
      typeExternalSpecifiers: ['convex/server'],
    },
  },
  {
    subpath: './better-auth/test',
    purity: {
      runtimeExternalSpecifiers: [
        'better-auth/plugins',
        'convex-helpers/server/stream',
        'convex/server',
        'convex/values',
      ],
      typeExternalSpecifiers: ['convex/server', 'convex/values'],
    },
  },
  {
    subpath: './server',
    purity: {
      // Boundary rule for `/server` (architecture invariant): the public entry must be
      // directly importable by Node because server integrations can load it at
      // request time, outside Nuxt's transform pipeline. Lazy Nitro runtime
      // APIs remain valid for authenticated cache operations after import.
      runtimeExternalSpecifiers: ['@lupinum/better-convex-vue/errors', 'convex/browser'],
      typeExternalSpecifiers: ['@lupinum/better-convex-vue/errors', 'convex/server', 'h3'],
    },
    packedProbe: probeServerEntry,
  },
]

const VUE_CHECKER_ENTRY_RULES = [
  {
    subpath: '.',
    purity: {
      runtimeExternalSpecifiers: [
        'convex/browser',
        'convex/server',
        'convex/values',
        'ohash',
        'vue',
      ],
      typeExternalSpecifiers: ['convex/browser', 'convex/server', 'vue'],
    },
  },
  {
    subpath: './errors',
    purity: {
      runtimeExternalSpecifiers: ['convex/values'],
      typeExternalSpecifiers: [],
    },
  },
  {
    subpath: './embedded',
    purity: {
      runtimeExternalSpecifiers: ['convex/values', 'vue'],
      typeExternalSpecifiers: ['convex/browser'],
    },
  },
]

const MCP_CHECKER_ENTRY_RULES = [
  {
    subpath: '.',
    purity: {
      runtimeExternalSpecifiers: ['@modelcontextprotocol/server'],
      typeExternalSpecifiers: ['@modelcontextprotocol/server'],
    },
  },
  {
    subpath: './vue',
    purity: {
      runtimeExternalSpecifiers: ['@modelcontextprotocol/ext-apps', 'vue'],
      typeExternalSpecifiers: ['@modelcontextprotocol/ext-apps', 'vue'],
    },
  },
]

const checkerProfiles = {
  'nuxt-public-entries': {
    manifestPolicy: { requireLegacyRootFields: true },
    sourceRoots: ['src/module.ts', 'src/runtime'],
    sourceScan: {
      allowedVirtualImports: ['#app', '#imports', '#build', '#components', 'nitropack/runtime'],
      allowedVirtualPrefixes: ['#app/', '#build/', '#components/', '#convex/'],
      allowedFrameworkPackages: ['vue', 'vue-router'],
    },
    rules: NUXT_CHECKER_ENTRY_RULES,
  },
  'vue-public-entries': {
    manifestPolicy: { requireLegacyRootFields: false },
    sourceRoots: ['src'],
    sourceScan: {
      allowedVirtualImports: [],
      allowedVirtualPrefixes: [],
      allowedFrameworkPackages: ['vue'],
    },
    rules: VUE_CHECKER_ENTRY_RULES,
  },
  'mcp-public-entries': {
    manifestPolicy: { requireLegacyRootFields: false },
    sourceRoots: ['src'],
    sourceScan: {
      allowedVirtualImports: [],
      allowedVirtualPrefixes: [],
      allowedFrameworkPackages: ['vue'],
    },
    rules: MCP_CHECKER_ENTRY_RULES,
  },
}

const checkerRuleFields = new Set(['subpath', 'purity', 'packedProbe'])
const packageRelativePathPattern = /^[\w.-]+(?:\/[\w.-]+)*$/u

function validateSourceRoots(profileId, sourceRoots) {
  if (
    !Array.isArray(sourceRoots) ||
    sourceRoots.length === 0 ||
    sourceRoots.some(
      (sourceRoot) =>
        typeof sourceRoot !== 'string' ||
        !packageRelativePathPattern.test(sourceRoot) ||
        sourceRoot.split('/').some((segment) => segment === '.' || segment === '..'),
    ) ||
    new Set(sourceRoots).size !== sourceRoots.length
  ) {
    throw new TypeError(`Package checker profile ${profileId} has invalid source roots`)
  }
}

function validateSourceScanPolicy(profileId, policy) {
  for (const property of [
    'allowedVirtualImports',
    'allowedVirtualPrefixes',
    'allowedFrameworkPackages',
  ]) {
    const values = policy[property]
    if (
      !Array.isArray(values) ||
      values.some((value) => typeof value !== 'string' || value.length === 0) ||
      new Set(values).size !== values.length
    ) {
      throw new TypeError(`Package checker profile ${profileId} has invalid ${property}`)
    }
  }
}

function freezeCheckerProfile(profileId, profile) {
  validateSourceRoots(profileId, profile.sourceRoots)
  validateSourceScanPolicy(profileId, profile.sourceScan)
  if (
    !profile.manifestPolicy ||
    Object.keys(profile.manifestPolicy).length !== 1 ||
    typeof profile.manifestPolicy.requireLegacyRootFields !== 'boolean'
  ) {
    throw new TypeError(`Package checker profile ${profileId} has invalid manifest policy`)
  }
  Object.freeze(profile.sourceRoots)
  for (const values of Object.values(profile.sourceScan)) Object.freeze(values)
  Object.freeze(profile.sourceScan)
  Object.freeze(profile.manifestPolicy)
  for (const rule of profile.rules) {
    if (rule.purity) {
      Object.freeze(rule.purity.runtimeExternalSpecifiers)
      Object.freeze(rule.purity.typeExternalSpecifiers)
      Object.freeze(rule.purity)
    }
    Object.freeze(rule)
  }
  Object.freeze(profile.rules)
  return Object.freeze(profile)
}

for (const [profileId, profile] of Object.entries(checkerProfiles)) {
  freezeCheckerProfile(profileId, profile)
}
Object.freeze(checkerProfiles)

function joinPackageCheckerEntries(manifest, rules) {
  validatePackageCheckerRules(manifest.entries, rules)
  return Object.freeze(
    manifest.entries.map((contract) => {
      const rule = rules.find((entry) => entry.subpath === contract.subpath)
      return Object.freeze({
        ...rule,
        ...contract,
      })
    }),
  )
}

export function getPackageCheckerProfile(packageId, options) {
  const manifest = getPackageEntryManifest(packageId, options)
  const profile = checkerProfiles[manifest.profileId]
  if (!profile) {
    throw new Error(`Package ${manifest.packageId} has no reviewed package-entry checker profile.`)
  }
  return Object.freeze({
    ...manifest,
    sourceRoots: profile.sourceRoots,
    sourceScan: profile.sourceScan,
    manifestPolicy: profile.manifestPolicy,
    entries: joinPackageCheckerEntries(manifest, profile.rules),
  })
}

export function getPackageCheckerEntries(packageId, options) {
  return getPackageCheckerProfile(packageId, options).entries
}

export function validatePackageCheckerRules(contracts, rules) {
  if (!Array.isArray(contracts) || !Array.isArray(rules)) {
    throw new TypeError('Package entry contracts and checker rules must be arrays')
  }
  const contractSubpaths = new Set()
  for (const contract of contracts) {
    if (
      !contract ||
      typeof contract !== 'object' ||
      typeof contract.subpath !== 'string' ||
      contractSubpaths.has(contract.subpath)
    ) {
      throw new Error(`Package entry contract subpath must be unique: ${String(contract?.subpath)}`)
    }
    contractSubpaths.add(contract.subpath)
  }
  const ruleSubpaths = new Set()
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new TypeError('Package checker rule must be an object')
    }
    const unexpectedFields = Object.keys(rule).filter((field) => !checkerRuleFields.has(field))
    if (unexpectedFields.length > 0) {
      throw new TypeError(
        `Package checker rule ${String(rule.subpath)} has unexpected fields: ${unexpectedFields.join(', ')}`,
      )
    }
    if (typeof rule.subpath !== 'string' || ruleSubpaths.has(rule.subpath)) {
      throw new Error(`Package checker rule subpath must be unique: ${String(rule.subpath)}`)
    }
    ruleSubpaths.add(rule.subpath)
    if (rule.packedProbe !== undefined && typeof rule.packedProbe !== 'function') {
      throw new TypeError(`Package checker rule ${rule.subpath} has invalid packedProbe`)
    }
    if (
      !rule.purity ||
      typeof rule.purity !== 'object' ||
      Array.isArray(rule.purity) ||
      Object.keys(rule.purity).length !== 2 ||
      !Object.hasOwn(rule.purity, 'runtimeExternalSpecifiers') ||
      !Object.hasOwn(rule.purity, 'typeExternalSpecifiers')
    ) {
      throw new TypeError(`Package checker rule ${rule.subpath} has invalid purity policy`)
    }
    for (const property of ['runtimeExternalSpecifiers', 'typeExternalSpecifiers']) {
      const allowed = rule.purity[property]
      if (
        !Array.isArray(allowed) ||
        allowed.some(
          (specifier) =>
            typeof specifier !== 'string' ||
            specifier.length === 0 ||
            specifier.startsWith('.') ||
            /\s/u.test(specifier),
        ) ||
        new Set(allowed).size !== allowed.length
      ) {
        throw new TypeError(`Package checker rule ${rule.subpath} must declare unique ${property}`)
      }
    }
  }
  for (const contract of contracts) {
    if (!ruleSubpaths.has(contract.subpath)) {
      throw new Error(`Missing checker rules for package entry ${contract.subpath}`)
    }
  }
  for (const rule of rules) {
    if (!contractSubpaths.has(rule.subpath)) {
      throw new Error(`Checker rules reference unknown package entry ${rule.subpath}`)
    }
  }
  return rules
}
