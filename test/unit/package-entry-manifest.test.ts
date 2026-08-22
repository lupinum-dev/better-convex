import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { checkEntryExportShape } from '../../scripts/package-check/declarations.mjs'
import {
  getPackageCheckerEntries,
  getPackageCheckerProfile,
  validatePackageCheckerRules,
} from '../../scripts/package-check/entry-rules.mjs'
import {
  getPackageEntry,
  getPackageEntryManifest,
  validatePackageEntries,
} from '../../scripts/package-entry-manifest.mjs'

const nuxtEntrySubpaths = [
  '.',
  './errors',
  './test',
  './better-auth/client',
  './better-auth/server',
  './better-auth/convex.config',
  './better-auth/_generated/component.js',
  './better-auth/test',
  './server',
]
const vueEntrySubpaths = ['.', './errors', './embedded']
const mcpEntrySubpaths = ['.', './vue']

type PackageEntry = {
  kind: 'runtime' | 'types-only'
  subpath: string
  distJs?: string
  distDts: string
  valueExports: string[]
  typeExports: string[]
  exactDeclaredExports: boolean
  forbiddenNames: string[]
}

type CheckerEntry = PackageEntry & {
  purity: {
    runtimeExternalSpecifiers: string[]
    typeExternalSpecifiers: string[]
  }
}

function cloneEntry(entry: ReturnType<typeof getPackageEntry>) {
  return {
    ...entry,
    valueExports: [...entry.valueExports],
    typeExports: [...entry.typeExports],
    forbiddenNames: [...entry.forbiddenNames],
  }
}

describe('package entry manifest', () => {
  it('selects the exact reviewed Nuxt owner and public-entry profile', () => {
    const manifest = getPackageEntryManifest('nuxt')

    expect(manifest).toMatchObject({
      packageId: 'nuxt',
      packageName: '@lupinum/better-convex-nuxt',
      packageDirectory: '.',
      profileId: 'nuxt-public-entries',
    })
    expect('sourceRoots' in manifest).toBe(false)
    expect(getPackageCheckerProfile('nuxt').sourceRoots).toEqual(['src/module.ts', 'src/runtime'])
    expect(manifest.entries.map((entry: PackageEntry) => entry.subpath)).toEqual(nuxtEntrySubpaths)
    expect(manifest.entries).toHaveLength(9)
    expect(manifest.bins).toEqual({
      'better-convex': './dist/runtime/cli/index.js',
    })
  })

  it('selects the exact reviewed Vue owner and exports-only entry profile', () => {
    const manifest = getPackageEntryManifest('vue')

    expect(manifest).toMatchObject({
      packageId: 'vue',
      packageName: '@lupinum/better-convex-vue',
      packageDirectory: 'packages/vue',
      profileId: 'vue-public-entries',
    })
    expect(manifest.entries.map((entry: PackageEntry) => entry.subpath)).toEqual(vueEntrySubpaths)
    expect(manifest.bins).toEqual({})
    expect(getPackageCheckerProfile('vue')).toMatchObject({
      manifestPolicy: { requireLegacyRootFields: false },
      sourceRoots: ['src'],
    })
  })

  it('keeps the MCP App subpath lifecycle contract exact', () => {
    expect(getPackageEntry('mcp', './vue')).toMatchObject({
      kind: 'runtime',
      valueExports: ['useMcpApp'],
      typeExports: [
        'McpAppError',
        'McpAppErrorCode',
        'McpAppHostVersion',
        'McpAppPhase',
        'UseMcpAppOptions',
        'UseMcpAppReturn',
      ],
      exactDeclaredExports: true,
    })
  })

  it('selects the exact reviewed MCP type-contract entry profile', () => {
    const manifest = getPackageEntryManifest('mcp')

    expect(manifest).toMatchObject({
      packageId: 'mcp',
      packageName: '@lupinum/better-convex-mcp',
      packageDirectory: 'packages/mcp',
      profileId: 'mcp-public-entries',
    })
    expect(manifest.entries.map((entry: PackageEntry) => entry.subpath)).toEqual(mcpEntrySubpaths)
    expect(manifest.bins).toEqual({})
    expect(getPackageCheckerProfile('mcp')).toMatchObject({
      manifestPolicy: { requireLegacyRootFields: false },
      sourceRoots: ['src'],
    })
    expect(manifest.entries[0]).toMatchObject({
      kind: 'runtime',
      valueExports: ['handleMcpRequest', 'McpUnsupportedCapabilityError', 'runMcpTool'],
      typeExports: [
        'HandleMcpRequestOptions',
        'McpAccessContext',
        'McpAccessVerifier',
        'McpRequestTools',
        'McpToolErrorMetadata',
        'McpVerificationExpectation',
        'RunMcpToolOptions',
        'VerifiedMcpAccess',
      ],
    })
  })

  it('keeps the experimental Tasks extension outside every public package entry', () => {
    for (const packageId of ['nuxt', 'vue', 'mcp'] as const) {
      const manifest = getPackageEntryManifest(packageId)
      const publicNames = manifest.entries.flatMap((entry: PackageEntry) => [
        ...entry.valueExports,
        ...entry.typeExports,
      ])
      expect(publicNames.filter((name: string) => /task/iu.test(name))).toEqual([])
    }
  })

  it('returns a deeply immutable reviewed manifest', () => {
    const manifest = getPackageEntryManifest('nuxt')

    expect(Object.isFrozen(manifest)).toBe(true)
    expect(Object.isFrozen(manifest.entries)).toBe(true)
    expect(Object.isFrozen(manifest.bins)).toBe(true)
    for (const entry of manifest.entries) {
      expect(Object.isFrozen(entry)).toBe(true)
      expect(Object.isFrozen(entry.valueExports)).toBe(true)
      expect(Object.isFrozen(entry.typeExports)).toBe(true)
      expect(Object.isFrozen(entry.forbiddenNames)).toBe(true)
    }
  })

  it('rejects unknown package owners and subpaths', () => {
    expect(() => getPackageEntryManifest('react')).toThrow(
      /Unknown package certification descriptor: react/,
    )
    expect(() => getPackageEntry('nuxt', './not-reviewed')).toThrow(
      /Unknown package entry for nuxt: \.\/not-reviewed/,
    )
  })

  it('models the generated component declaration as one canonical types-only entry', () => {
    const entry = getPackageEntry('nuxt', './better-auth/_generated/component.js')
    expect(entry).toMatchObject({
      kind: 'types-only',
      distDts: 'dist/runtime/convex-auth/component/_generated/component.d.ts',
      valueExports: [],
      typeExports: ['ComponentApi'],
      exactDeclaredExports: true,
    })
    expect('distJs' in entry).toBe(false)

    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    expect(packageJson.exports[entry.subpath]).toEqual({
      types: `./${entry.distDts}`,
    })
    expect(packageJson.typesVersions['*']['better-auth/_generated/component.js']).toEqual([
      `./${entry.distDts}`,
    ])
  })

  it('rejects JavaScript targets and value exports on a types-only entry', () => {
    const entry = cloneEntry(getPackageEntry('nuxt', './better-auth/_generated/component.js'))

    expect(() =>
      validatePackageEntries([
        {
          ...entry,
          valueExports: ['default'],
        },
      ]),
    ).toThrow(/cannot declare JavaScript or values/)

    expect(() =>
      validatePackageEntries([
        {
          ...entry,
          distJs: 'dist/invalid.js',
        },
      ]),
    ).toThrow(/invalid fields.*unexpected: distJs/)
  })

  it('checks a types-only declaration without requiring a JavaScript artifact', () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), 'bcn-types-only-entry-'))
    try {
      writeFileSync(join(artifactRoot, 'component.d.ts'), 'export interface ComponentApi {}\n')
      const failures: string[] = []

      checkEntryExportShape(
        {
          kind: 'types-only',
          subpath: './component.js',
          distDts: 'component.d.ts',
          valueExports: [],
          typeExports: ['ComponentApi'],
          exactDeclaredExports: true,
          forbiddenNames: [],
        },
        failures,
        artifactRoot,
      )

      expect(failures).toEqual([])

      writeFileSync(
        join(artifactRoot, 'component.d.ts'),
        'export interface ComponentApi {}\nexport type AccidentalPublicType = string\n',
      )
      checkEntryExportShape(
        {
          kind: 'types-only',
          subpath: './component.js',
          distDts: 'component.d.ts',
          valueExports: [],
          typeExports: ['ComponentApi'],
          exactDeclaredExports: true,
          forbiddenNames: [],
        },
        failures,
        artifactRoot,
      )
      expect(failures).toContainEqual(expect.stringContaining('AccidentalPublicType'))

      failures.length = 0
      writeFileSync(join(artifactRoot, 'other.d.ts'), 'export interface ComponentApi {}\n')
      writeFileSync(join(artifactRoot, 'component.d.ts'), "export * from './other.js'\n")
      checkEntryExportShape(
        {
          kind: 'types-only',
          subpath: './component.js',
          distDts: 'component.d.ts',
          valueExports: [],
          typeExports: ['ComponentApi'],
          exactDeclaredExports: true,
          forbiddenNames: [],
        },
        failures,
        artifactRoot,
      )
      expect(failures).toEqual([])

      writeFileSync(join(artifactRoot, 'component.d.ts'), "export * from './missing.js'\n")
      checkEntryExportShape(
        {
          kind: 'types-only',
          subpath: './component.js',
          distDts: 'component.d.ts',
          valueExports: [],
          typeExports: ['ComponentApi'],
          exactDeclaredExports: true,
          forbiddenNames: [],
        },
        failures,
        artifactRoot,
      )
      expect(failures).toContainEqual(
        expect.stringContaining('type space is missing expected export "ComponentApi"'),
      )
    } finally {
      rmSync(artifactRoot, { recursive: true, force: true })
    }
  })

  it('accepts the reviewed entries and rejects duplicate owners', () => {
    const entries = getPackageEntryManifest('nuxt').entries
    expect(validatePackageEntries(entries)).toBe(entries)

    const first = cloneEntry(entries[1]!)
    const second = cloneEntry(entries[2]!)
    expect(() => validatePackageEntries([first, { ...second, subpath: first.subpath }])).toThrow(
      /subpath must be unique/,
    )
    expect(() => validatePackageEntries([first, { ...second, distDts: first.distDts }])).toThrow(
      /artifact path must be unique/,
    )
  })

  it.each([
    ['subpath traversal', { subpath: './../server' }, /subpath must be canonical/],
    ['subpath empty segment', { subpath: './server//unsafe' }, /subpath must be canonical/],
    ['subpath backslash', { subpath: '.\\server' }, /subpath must be canonical/],
    ['declaration traversal', { distDts: 'dist/../outside.d.ts' }, /canonical distDts/],
    ['declaration backslash', { distDts: 'dist\\outside.d.ts' }, /canonical distDts/],
    ['declaration extension', { distDts: 'dist/outside.ts' }, /canonical distDts/],
    ['CommonJS declaration', { distDts: 'dist/outside.d.cts' }, /canonical distDts/],
    ['runtime traversal', { distJs: 'dist/../outside.js' }, /canonical distJs/],
    ['runtime backslash', { distJs: 'dist\\outside.js' }, /canonical distJs/],
    ['runtime extension', { distJs: 'dist/outside.ts' }, /canonical distJs/],
    ['CommonJS runtime', { distJs: 'dist/outside.cjs' }, /canonical distJs/],
  ])('rejects noncanonical %s paths', (_label, patch, expected) => {
    const entry = cloneEntry(getPackageEntry('nuxt', './server'))
    expect(() => validatePackageEntries([{ ...entry, ...patch }])).toThrow(expected)
  })

  it('requires runtime and declaration module kinds to match', () => {
    const entry = cloneEntry(getPackageEntry('nuxt', './server'))
    expect(() =>
      validatePackageEntries([
        { ...entry, distJs: 'dist/server.mjs', distDts: 'dist/server.d.ts' },
      ]),
    ).toThrow(/must pair its JavaScript and declaration module kinds/)
    expect(() =>
      validatePackageEntries([
        { ...entry, distJs: 'dist/server.js', distDts: 'dist/server.d.mts' },
      ]),
    ).toThrow(/must pair its JavaScript and declaration module kinds/)
  })

  it('rejects missing, unknown, duplicate, and contradictory export fields', () => {
    const entry = cloneEntry(getPackageEntry('nuxt', './server'))
    const missingField = cloneEntry(entry)
    Reflect.deleteProperty(missingField, 'exactDeclaredExports')

    expect(() => validatePackageEntries([missingField])).toThrow(
      /invalid fields.*missing: exactDeclaredExports/,
    )
    expect(() => validatePackageEntries([{ ...entry, accidentalOwner: 'nuxt' }])).toThrow(
      /invalid fields.*unexpected: accidentalOwner/,
    )
    expect(() =>
      validatePackageEntries([{ ...entry, typeExports: [entry.valueExports[0]!] }]),
    ).toThrow(/repeats a public export name/)
    expect(() =>
      validatePackageEntries([{ ...entry, forbiddenNames: [entry.valueExports[0]!] }]),
    ).toThrow(/allows and forbids the same export name/)
  })

  it('keeps checker rules in exact bijection with the reviewed package manifest', () => {
    const packageEntries = getPackageEntryManifest('nuxt').entries
    const checkerEntries = getPackageCheckerEntries('nuxt')
    const detachedRules = checkerEntries.map((entry: CheckerEntry) => ({
      subpath: entry.subpath,
      purity: {
        runtimeExternalSpecifiers: [...entry.purity.runtimeExternalSpecifiers],
        typeExternalSpecifiers: [...entry.purity.typeExternalSpecifiers],
      },
    }))

    expect(checkerEntries.map((entry: CheckerEntry) => entry.subpath)).toEqual(
      packageEntries.map((entry: PackageEntry) => entry.subpath),
    )
    expect(checkerEntries).toHaveLength(packageEntries.length)
    expect(validatePackageCheckerRules(packageEntries, detachedRules)).toBe(detachedRules)
    expect(() => validatePackageCheckerRules(packageEntries, detachedRules.slice(1))).toThrow(
      /Missing checker rules for package entry \./,
    )
    expect(() =>
      validatePackageCheckerRules(packageEntries, [
        ...detachedRules,
        {
          subpath: './not-reviewed',
          purity: { runtimeExternalSpecifiers: [], typeExternalSpecifiers: [] },
        },
      ]),
    ).toThrow(/Checker rules reference unknown package entry \.\/not-reviewed/)
    expect(() =>
      validatePackageCheckerRules(packageEntries, [detachedRules[0]!, ...detachedRules]),
    ).toThrow(/checker rule subpath must be unique/)
    expect(() =>
      validatePackageCheckerRules(packageEntries, [
        { subpath: detachedRules[0]!.subpath },
        ...detachedRules.slice(1),
      ]),
    ).toThrow(/invalid purity policy/)
    expect(() => getPackageCheckerEntries('react')).toThrow(
      /Unknown package certification descriptor: react/,
    )
  })

  it('keeps Vue checker rules in exact bijection with the reviewed package manifest', () => {
    const packageEntries = getPackageEntryManifest('vue').entries
    const checkerEntries = getPackageCheckerEntries('vue')

    expect(checkerEntries.map((entry: CheckerEntry) => entry.subpath)).toEqual(vueEntrySubpaths)
    expect(checkerEntries).toHaveLength(packageEntries.length)
    expect(checkerEntries[0]?.purity).toEqual({
      runtimeExternalSpecifiers: [
        'convex/browser',
        'convex/server',
        'convex/values',
        'ohash',
        'vue',
      ],
      typeExternalSpecifiers: ['convex/browser', 'convex/server', 'vue'],
    })
  })

  it('keeps the MCP checker rules in exact bijection with its reviewed type contract', () => {
    const packageEntries = getPackageEntryManifest('mcp').entries
    const checkerEntries = getPackageCheckerEntries('mcp')

    expect(checkerEntries.map((entry: CheckerEntry) => entry.subpath)).toEqual(mcpEntrySubpaths)
    expect(checkerEntries).toHaveLength(packageEntries.length)
    expect(checkerEntries[0]?.purity).toEqual({
      runtimeExternalSpecifiers: ['@modelcontextprotocol/server'],
      typeExternalSpecifiers: ['@modelcontextprotocol/server'],
    })
  })

  it('keeps the Convex auth packed dependency surface backend-only', () => {
    const checkerEntries = getPackageCheckerEntries('nuxt')
    const entry = checkerEntries.find(
      (candidate: CheckerEntry) => candidate.subpath === './better-auth/server',
    )
    if (!entry?.purity) throw new Error('Missing Convex auth package purity rule')
    const runtimeAllowed = new Set(entry.purity.runtimeExternalSpecifiers)
    const typeAllowed = new Set(entry.purity.typeExternalSpecifiers)

    for (const specifier of [
      '<computed dynamic import>',
      'fs',
      'node:path',
      '#app',
      '~/server',
      '@/server',
      'convex/browser',
      '@lupinum/better-convex-nuxt/server',
      'vue',
    ]) {
      expect(runtimeAllowed.has(specifier), specifier).toBe(false)
      expect(typeAllowed.has(specifier), specifier).toBe(false)
    }
    expect(runtimeAllowed.has('convex/server')).toBe(true)
    expect(typeAllowed.has('convex/server')).toBe(true)
    expect(runtimeAllowed.has('better-auth/db')).toBe(false)
    expect(typeAllowed.has('better-auth/db')).toBe(false)
  })
})
