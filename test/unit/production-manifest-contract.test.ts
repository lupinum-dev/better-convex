import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assertProductionManifestContract,
  productionManifestContractDigest,
  selectProductionManifestContract,
} from '../../scripts/package-check/production-manifest-contract.mjs'

const root = resolve(import.meta.dirname, '../..')
const packageId = 'nuxt'
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const vueManifest = JSON.parse(readFileSync(resolve(root, 'packages/vue/package.json'), 'utf8'))
const mcpManifest = JSON.parse(readFileSync(resolve(root, 'packages/mcp/package.json'), 'utf8'))

function candidate(mutate: (value: Record<string, unknown>) => void) {
  const value = structuredClone(manifest) as Record<string, unknown>
  mutate(value)
  return value
}

describe('production manifest certification profiles', () => {
  it('selects the exact reviewed Nuxt production contract', () => {
    const contract = selectProductionManifestContract(packageId, manifest)
    expect(contract).toMatchObject({
      schemaVersion: 1,
      profile: 'nuxt-production-dependencies',
    })
    expect(Object.keys(contract.manifest)).toEqual([
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
      'scripts',
    ])
  })

  it('selects the minimal Vue exports-only production contract', () => {
    const contract = selectProductionManifestContract('vue', vueManifest)
    expect(contract).toMatchObject({
      schemaVersion: 1,
      profile: 'vue-production-dependencies',
    })
    expect(Object.keys(contract.manifest)).toEqual([
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
      'engines',
      'scripts',
    ])
    expect(contract.manifest).toMatchObject({
      files: ['dist'],
      sideEffects: false,
      scripts: { prepack: 'pnpm run build' },
    })
  })

  it('requires the exact optional auth peer tuple in the reviewed Nuxt contract', () => {
    const contract = selectProductionManifestContract(packageId, manifest)
    expect(contract.manifest).toHaveProperty(
      'peerDependencies',
      expect.objectContaining({
        '@better-auth/core': '1.7.2',
        '@better-auth/oauth-provider': '1.7.2',
        'better-auth': '1.7.2',
      }),
    )
    expect(contract.manifest).toHaveProperty('peerDependenciesMeta', {
      '@better-auth/core': { optional: true },
      '@better-auth/oauth-provider': { optional: true },
      'better-auth': { optional: true },
    })
  })

  it.each([
    ['missing peer', undefined, { optional: true }],
    ['version range', '^1.7.2', { optional: true }],
    ['different exact version', '1.7.1', { optional: true }],
    ['required peer', '1.7.2', { optional: false }],
    ['missing optional metadata', '1.7.2', undefined],
  ])('rejects core with %s even when source and candidate match', (_label, version, metadata) => {
    const unreviewed = candidate((value) => {
      const peers = value.peerDependencies as Record<string, unknown>
      const peerMetadata = value.peerDependenciesMeta as Record<string, unknown>
      if (version === undefined) Reflect.deleteProperty(peers, '@better-auth/core')
      else peers['@better-auth/core'] = version
      if (metadata === undefined) Reflect.deleteProperty(peerMetadata, '@better-auth/core')
      else peerMetadata['@better-auth/core'] = metadata
    })
    expect(() => assertProductionManifestContract(packageId, unreviewed, unreviewed)).toThrow(
      'Nuxt auth packages must be exact optional peers.',
    )
  })

  it('selects the minimal MCP contract with one exact official SDK dependency', () => {
    const contract = selectProductionManifestContract('mcp', mcpManifest)
    expect(contract).toMatchObject({
      schemaVersion: 1,
      profile: 'mcp-production-dependencies',
    })
    expect(Object.keys(contract.manifest)).toEqual([
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
      'scripts',
    ])
    expect(contract.manifest).toMatchObject({
      dependencies: mcpManifest.dependencies,
      files: ['dist'],
      sideEffects: false,
      scripts: { prepack: 'unbuild' },
    })
  })

  it.each(['main', 'typesVersions', 'packageManager', 'publishConfig'])(
    'rejects Vue install-affecting field %s even when source and candidate match',
    (field) => {
      const unreviewed = structuredClone(vueManifest) as Record<string, unknown>
      unreviewed[field] = field === 'publishConfig' ? { registry: 'https://example.invalid' } : 'x'
      expect(() => assertProductionManifestContract('vue', unreviewed, unreviewed)).toThrow(
        `uses forbidden field ${field}`,
      )
    },
  )

  it.each([
    [
      'extra dependency contract',
      (value: Record<string, unknown>) => {
        ;(value.dependencies as Record<string, unknown>)['unreviewed-runtime'] = '1.0.0'
      },
    ],
    [
      'extra export contract',
      (value: Record<string, unknown>) => {
        ;(value.exports as Record<string, unknown>)['./unreviewed'] = './dist/unreviewed.js'
      },
    ],
    [
      'changed engine contract',
      (value: Record<string, unknown>) => {
        value.engines = { node: '>=0' }
      },
    ],
    [
      'changed package-manager contract',
      (value: Record<string, unknown>) => {
        value.packageManager = 'pnpm@0.0.0-forged'
      },
    ],
  ] as const)('rejects a candidate-only %s', (_label, mutate) => {
    const changed = candidate(mutate)
    expect(() => assertProductionManifestContract(packageId, changed, manifest)).toThrow(
      'does not exactly match the reviewed source manifest',
    )
    expect(productionManifestContractDigest(packageId, changed)).not.toBe(
      productionManifestContractDigest(packageId, manifest),
    )
  })

  it.each(['dependencies', 'exports', 'engines', 'packageManager'] as const)(
    'rejects source and candidate when required field %s is jointly missing',
    (field) => {
      const incomplete = candidate((value) => Reflect.deleteProperty(value, field))
      expect(() => selectProductionManifestContract(packageId, incomplete)).toThrow(
        `missing required field ${field}`,
      )
      expect(() => assertProductionManifestContract(packageId, incomplete, incomplete)).toThrow(
        `missing required field ${field}`,
      )
    },
  )

  it.each([
    ['optionalDependencies', { optionalDependencies: { optional: '1.0.0' } }],
    ['bundleDependencies', { bundleDependencies: ['bundled'] }],
    ['os', { os: ['darwin'] }],
    ['publishConfig', { publishConfig: { registry: 'https://example.invalid' } }],
    ['typings', { typings: './dist/unreviewed.d.ts' }],
    ['directories', { directories: { bin: './dist/bin' } }],
    ['gypfile', { gypfile: true }],
  ] as const)('rejects jointly present unreviewed field %s', (field, addition) => {
    const unreviewed = candidate((value) => Object.assign(value, addition))
    expect(() => assertProductionManifestContract(packageId, unreviewed, unreviewed)).toThrow(
      `uses forbidden field ${field}`,
    )
  })

  it('rejects malformed maps even when both manifests match', () => {
    const malformedDependencies = candidate((value) => {
      value.dependencies = []
    })
    expect(() =>
      assertProductionManifestContract(packageId, malformedDependencies, malformedDependencies),
    ).toThrow('field dependencies')

    const extraEngine = candidate((value) => {
      value.engines = { node: '>=22', npm: '>=11' }
    })
    expect(() => assertProductionManifestContract(packageId, extraEngine, extraEngine)).toThrow(
      'engines must declare only node',
    )
  })

  it.each([
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
  ])('rejects lifecycle script %s even when both manifests match', (script) => {
    const hooked = candidate((value) => {
      value.scripts = {
        ...(value.scripts as object),
        [script]: 'node forged.js',
      }
    })
    expect(() => assertProductionManifestContract(packageId, hooked, hooked)).toThrow(
      `uses forbidden lifecycle script ${script}`,
    )
  })

  it('requires and binds the one reviewed packaging lifecycle script', () => {
    const missing = candidate((value) => {
      Reflect.deleteProperty(value.scripts as Record<string, unknown>, 'prepack')
    })
    expect(() => assertProductionManifestContract(packageId, missing, missing)).toThrow(
      'missing required lifecycle script prepack',
    )

    const changed = candidate((value) => {
      ;(value.scripts as Record<string, unknown>).prepack = 'node forged.js'
    })
    expect(() => assertProductionManifestContract(packageId, changed, manifest)).toThrow(
      'does not exactly match the reviewed source manifest',
    )
  })

  it('ignores descriptive, development, and ordinary script metadata in its deterministic digest', () => {
    const reordered = candidate((value) => {
      value.description = 'Descriptive text is not an installation contract.'
      value.devDependencies = { 'ignored-dev-only-change': '1.0.0' }
      value.scripts = {
        ...(value.scripts as object),
        'ignored-dev-only-change': 'true',
      }
      value.dependencies = Object.fromEntries(
        Object.entries(value.dependencies as Record<string, unknown>).reverse(),
      )
    })

    expect(assertProductionManifestContract(packageId, reordered, manifest)).toBeUndefined()
    expect(productionManifestContractDigest(packageId, reordered)).toBe(
      productionManifestContractDigest(packageId, manifest),
    )
    expect(productionManifestContractDigest(packageId, manifest)).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('rejects unknown package selection and malformed manifests without a fallback profile', () => {
    expect(() => selectProductionManifestContract('unknown', manifest)).toThrow(
      'Unknown package certification descriptor',
    )
    expect(() => selectProductionManifestContract(packageId, [])).toThrow('plain JSON object')
    expect(() => selectProductionManifestContract(packageId, new Date())).toThrow(
      'plain JSON object',
    )
  })
})
