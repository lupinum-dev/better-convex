import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import * as tar from 'tar'
import { describe, expect, it } from 'vitest'

import buildConfig from '../../build.config'
import {
  buildContentManifest,
  buildDirectoryContentIdentity,
  checkPackedPathClasses,
  checkRequiredPackedFiles,
  packAndExtract,
  scanExtractedTarball,
  validateTarballEntryHeaders as validateHeaders,
} from '../../scripts/package-check/tarball.mjs'

const repositoryManifest = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'),
)

function writeArtifact(packageRoot: string, path: string, source: string) {
  const target = join(packageRoot, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, source)
}

function validate(...paths: string[]): string[] {
  const failures: string[] = []
  checkPackedPathClasses(
    'nuxt',
    {
      files: paths.map((path) => ({ path })),
    },
    failures,
  )
  return failures
}

function validateTarballEntryHeaders(
  packageId: string,
  entries: Array<{ path: string; size: number; type: string; mode?: number }>,
) {
  return validateHeaders(
    packageId,
    entries.map((entry) => ({ mode: 0o644, ...entry })),
  )
}

describe('packed artifact path classes', () => {
  it('uses release npm-pack semantics for the default current-tree artifact', () => {
    const npmCache = mkdtempSync(join(tmpdir(), 'bcn-npm-pack-cache-'))
    const previousCache = process.env.npm_config_cache
    process.env.npm_config_cache = npmCache
    let scratchDir: string | undefined
    try {
      const packed = packAndExtract('nuxt')
      scratchDir = packed.scratchDir
      const packedManifest = JSON.parse(
        readFileSync(join(packed.packageDir, 'package.json'), 'utf8'),
      )

      expect(packedManifest.packageManager).toBe(repositoryManifest.packageManager)
    } finally {
      if (previousCache === undefined) delete process.env.npm_config_cache
      else process.env.npm_config_cache = previousCache
      if (scratchDir) rmSync(scratchDir, { recursive: true, force: true })
      rmSync(npmCache, { recursive: true, force: true })
    }
  }, 30_000)

  it('keeps only the public generated component declaration after build', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bcn-build-cleanup-'))
    const outDir = join(root, 'dist')
    const generatedDir = join(outDir, 'runtime/convex-auth/component/_generated')
    try {
      for (const name of [
        'api.d.ts',
        'api.js',
        'component.d.ts',
        'component.js',
        'dataModel.d.ts',
        'server.d.ts',
      ]) {
        writeArtifact(outDir, `runtime/convex-auth/component/_generated/${name}`, '')
      }

      await buildConfig.hooks['build:done']({ options: { outDir } })

      expect(readdirSync(generatedDir).sort()).toEqual(['api.js', 'component.d.ts', 'component.js'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts only one canonical, file-only package/ archive tree', () => {
    expect(
      validateTarballEntryHeaders('nuxt', [
        { path: 'package/package.json', size: 10, type: 'File' },
        { path: 'package/dist/index.js', size: 20, type: 'File' },
      ]),
    ).toHaveLength(2)

    expect(() =>
      validateTarballEntryHeaders('nuxt', [{ path: 'evil/index.js', size: 1, type: 'File' }]),
    ).toThrow(/must stay under package/)
    expect(() =>
      validateTarballEntryHeaders('nuxt', [
        { path: 'package/index.js', size: 1, type: 'File', mode: -1 },
      ]),
    ).toThrow(/invalid mode/)
    expect(() =>
      validateTarballEntryHeaders('nuxt', [
        { path: 'package/index.js', size: 1, type: 'File' },
        { path: 'package/../evil.js', size: 1, type: 'File' },
      ]),
    ).toThrow(/must stay under package/)
    expect(() =>
      validateTarballEntryHeaders('nuxt', [
        { path: 'package/index.js', size: 1, type: 'File' },
        { path: 'package/INDEX.js', size: 1, type: 'File' },
      ]),
    ).toThrow(/duplicate portable path/)
    for (const path of [
      'package/index.js.',
      'package/index.js ',
      'package/dist/file:stream.js',
      'package/CON.js',
      'package/dist/lPt9.txt',
    ]) {
      expect(() => validateTarballEntryHeaders('nuxt', [{ path, size: 1, type: 'File' }])).toThrow(
        /must stay under package/,
      )
    }
    expect(() =>
      validateTarballEntryHeaders('nuxt', [
        { path: 'package/link', size: 0, type: 'SymbolicLink' },
      ]),
    ).toThrow(/unsupported SymbolicLink/)
    expect(() =>
      validateTarballEntryHeaders('nuxt', [{ path: 'package/hard', size: 0, type: 'Link' }]),
    ).toThrow(/unsupported Link/)
    expect(() =>
      validateTarballEntryHeaders('nuxt', [{ path: 'package', size: 0, type: 'Directory' }]),
    ).toThrow(/unsupported Directory/)
    expect(() =>
      validateTarballEntryHeaders('nuxt', [
        {
          path: 'package/dist/node_modules/convex/index.js',
          size: 1,
          type: 'File',
        },
      ]),
    ).toThrow(/must stay under package/)
    expect(() =>
      validateTarballEntryHeaders('nuxt', [
        { path: 'package/dist/.pnpm/convex/index.js', size: 1, type: 'File' },
      ]),
    ).toThrow(/must stay under package/)
    expect(() =>
      validateTarballEntryHeaders('nuxt', [
        { path: 'package/dist/runtime/package.json', size: 1, type: 'File' },
      ]),
    ).toThrow(/must stay under package/)
  })

  it('bounds archive entry count and declared uncompressed sizes before extraction', () => {
    const mib = 1024 * 1024
    expect(
      validateTarballEntryHeaders(
        'nuxt',
        Array.from({ length: 4 }, (_, index) => ({
          path: `package/dist/chunk-${index}.js`,
          size: 16 * mib,
          type: 'File',
        })),
      ),
    ).toHaveLength(4)

    expect(() =>
      validateTarballEntryHeaders('nuxt', [
        { path: 'package/dist/oversize.js', size: 16 * mib + 1, type: 'File' },
      ]),
    ).toThrow(/file exceeds 16777216 bytes/)

    expect(() =>
      validateTarballEntryHeaders('nuxt', [
        { path: 'package/dist/one.js', size: 16 * mib, type: 'File' },
        { path: 'package/dist/two.js', size: 16 * mib, type: 'File' },
        { path: 'package/dist/three.js', size: 16 * mib, type: 'File' },
        { path: 'package/dist/four.js', size: 16 * mib, type: 'File' },
        { path: 'package/dist/five.js', size: 1, type: 'File' },
      ]),
    ).toThrow(/exceeds 67108864 total bytes/)

    expect(() =>
      validateTarballEntryHeaders(
        'nuxt',
        Array.from({ length: 4_097 }, (_, index) => ({
          path: `package/dist/file-${index}.js`,
          size: 0,
          type: 'File',
        })),
      ),
    ).toThrow(/exceeds 4096 file entries/)
  })

  it('builds identical header-owned manifests under umask 022 and 077', () => {
    const root = mkdtempSync(join(tmpdir(), 'bcn-content-umask-'))
    const packedRoot = join(root, 'packed')
    const packageRoot = join(packedRoot, 'package')
    const tarballPath = join(root, 'fixture.tgz')
    let firstScratch: string | undefined
    let secondScratch: string | undefined
    const previousUmask = process.umask()
    try {
      writeArtifact(
        packageRoot,
        'package.json',
        '{"name":"better-convex-nuxt","version":"1.0.0"}\n',
      )
      writeArtifact(packageRoot, 'dist/cli.mjs', '#!/usr/bin/env node\n')
      chmodSync(join(packageRoot, 'package.json'), 0o644)
      chmodSync(join(packageRoot, 'dist/cli.mjs'), 0o755)
      tar.c(
        {
          cwd: packedRoot,
          file: tarballPath,
          gzip: true,
          noDirRecurse: true,
          portable: true,
          strict: true,
          sync: true,
        },
        ['package/dist/cli.mjs', 'package/package.json'],
      )

      process.umask(0o022)
      const first = packAndExtract('nuxt', tarballPath)
      firstScratch = first.scratchDir
      const firstManifest = buildContentManifest(first.packageDir, first.archiveEntries)

      process.umask(0o077)
      const second = packAndExtract('nuxt', tarballPath)
      secondScratch = second.scratchDir
      const secondManifest = buildContentManifest(second.packageDir, second.archiveEntries)

      expect(lstatSync(join(first.packageDir, 'package.json')).mode & 0o777).toBe(0o644)
      expect(lstatSync(join(second.packageDir, 'package.json')).mode & 0o777).toBe(0o600)
      expect(lstatSync(join(first.packageDir, 'dist/cli.mjs')).mode & 0o777).toBe(0o755)
      expect(lstatSync(join(second.packageDir, 'dist/cli.mjs')).mode & 0o777).toBe(0o700)
      expect(secondManifest).toEqual(firstManifest)
      expect(firstManifest.files).toEqual([
        expect.objectContaining({ path: 'dist/cli.mjs', mode: '755' }),
        expect.objectContaining({ path: 'package.json', mode: '644' }),
      ])
    } finally {
      process.umask(previousUmask)
      if (firstScratch) rmSync(firstScratch, { recursive: true, force: true })
      if (secondScratch) rmSync(secondScratch, { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects an unreviewed package owner instead of applying the Nuxt policy', () => {
    expect(() => checkPackedPathClasses('react', { files: [] }, [])).toThrow(
      'Unknown package certification descriptor: react',
    )
  })

  it('applies the smaller reviewed Vue artifact policy independently', () => {
    const accepted: string[] = []
    checkPackedPathClasses(
      'vue',
      {
        files: [
          { path: 'LICENSE' },
          { path: 'package.json' },
          { path: 'dist/index.mjs' },
          { path: 'dist/index.d.mts' },
        ],
      },
      accepted,
    )
    expect(accepted).toEqual([])

    const rejected: string[] = []
    checkPackedPathClasses('vue', { files: [{ path: 'README.md' }] }, rejected)
    expect(rejected).toContainEqual(expect.stringContaining('unplanned root path: README.md'))
  })

  it('allows package metadata, declarations, runtime files, and built DevTools assets', () => {
    expect(
      validate(
        'LICENSE',
        'LICENSES/Apache-2.0.txt',
        'README.md',
        'THIRD_PARTY_NOTICES.md',
        'package.json',
        'security/upstream-convex-better-auth.json',
        'dist/module.mjs',
        'dist/runtime/errors/index.d.ts',
        'dist/runtime/devtools/ui/dist/_nuxt/entry.js',
      ),
    ).toEqual([])
  })

  it.each([
    'research/notes.md',
    'dist/node_modules/convex/index.js',
    'dist/.pnpm/convex/index.js',
    'dist/runtime/package.json',
    'dist/runtime/convex-auth/component/_generated/api.d.ts',
    'dist/runtime/devtools/.output/public/index.html',
    'dist/runtime/devtools/ui/app.vue',
    'dist/runtime/devtools/ui/dist/_nuxt/entry.d.ts',
    'dist/runtime/server/tsconfig.json',
    'dist/tsconfig.tsbuildinfo',
  ])('rejects %s', (path) => {
    expect(validate(path)).not.toEqual([])
  })

  it('requires the built DevTools entry asset', () => {
    const failures: string[] = []
    checkRequiredPackedFiles('nuxt', { files: [] }, failures)
    expect(failures).toEqual([
      'packed tarball is missing required file: dist/runtime/devtools/ui/dist/index.html',
    ])

    failures.length = 0
    checkRequiredPackedFiles(
      'nuxt',
      { files: [{ path: 'dist/runtime/devtools/ui/dist/index.html' }] },
      failures,
    )
    expect(failures).toEqual([])
  })

  it('AST-checks unlinked packed modules for syntax and indirect loaders', () => {
    const packageRoot = mkdtempSync(join(tmpdir(), 'bcn-packed-paths-'))
    try {
      writeArtifact(
        packageRoot,
        'package.json',
        JSON.stringify({
          name: 'better-convex-nuxt',
          type: 'module',
          dependencies: {},
        }),
      )
      writeArtifact(packageRoot, 'dist/runtime/devtools/ui/dist/index.html', '<!doctype html>')
      writeArtifact(
        packageRoot,
        'dist/unlinked-loader.mjs',
        "require.call(null, 'hidden-package')\n",
      )
      writeArtifact(packageRoot, 'dist/unlinked-invalid.mjs', 'export type Hidden = true\n')
      writeArtifact(packageRoot, 'dist/unlinked.cjs', 'module.exports = true\n')
      writeArtifact(packageRoot, 'dist/unlinked-relative.mjs', "import './missing.mjs'\n")
      writeArtifact(packageRoot, 'dist/unlinked-virtual.mjs', "import '#unreviewed-runtime'\n")
      writeArtifact(packageRoot, 'dist/unlinked-allowed.mjs', "import '#app'\n")
      writeArtifact(packageRoot, 'dist/unlinked-node-valid.mjs', "import 'node:fs'\n")
      writeArtifact(
        packageRoot,
        'dist/unlinked-node-invalid.mjs',
        "import 'node:definitely_not_a_real_builtin'\n",
      )
      writeArtifact(packageRoot, 'dist/unlinked-duplicate.mjs', 'const x = 1\nconst x = 2\n')
      writeArtifact(packageRoot, 'dist/unlinked-with.mjs', 'with ({}) {}\n')
      writeArtifact(packageRoot, 'dist/unlinked-export.mjs', 'const x = 1\nexport { x, x }\n')
      writeArtifact(packageRoot, 'dist/unlinked-default.mjs', 'export default Missing\n')
      writeArtifact(packageRoot, 'dist/unlinked-break.mjs', 'break\n')
      writeArtifact(packageRoot, 'dist/unlinked-return.mjs', 'return\n')
      writeArtifact(packageRoot, 'dist/unlinked-new-target.mjs', 'new.target\n')
      writeArtifact(
        packageRoot,
        'dist/unlinked-private.mjs',
        'class Example { method() { return this.#missing } }\n',
      )
      writeArtifact(
        packageRoot,
        'dist/unlinked-super.mjs',
        'class Example { constructor() { super() } }\n',
      )
      writeArtifact(packageRoot, 'dist/child.d.ts', 'export interface Other {}\n')
      writeArtifact(packageRoot, 'dist/unlinked-default.d.ts', 'export default Missing\n')
      writeArtifact(
        packageRoot,
        'dist/unlinked-declaration.d.ts',
        [
          '/// <reference path="./missing-reference" />',
          '/// <reference lib="definitely-not-a-real-lib" />',
          "export { Missing } from './child.js'",
          '',
        ].join('\n'),
      )
      const manifest = buildDirectoryContentIdentity(packageRoot)
      const failures: string[] = []

      scanExtractedTarball('nuxt', packageRoot, failures, manifest)

      expect(failures).toContain(
        'packed dist/unlinked-loader.mjs uses unsupported module loader: require',
      )
      expect(failures).toContainEqual(
        expect.stringMatching(
          /packed dist\/unlinked-invalid\.mjs has TypeScript parse error\(s\): TS8008/u,
        ),
      )
      expect(failures).toContain(
        'packed dist/unlinked.cjs uses unsupported CommonJS runtime syntax',
      )
      expect(failures).toContain(
        'packed dist/unlinked-relative.mjs has unresolved runtime edge "./missing.mjs"',
      )
      expect(failures).toContain(
        'packed dist/unlinked-virtual.mjs imports unreviewed virtual specifier "#unreviewed-runtime"',
      )
      expect(failures).not.toContainEqual(expect.stringContaining('unlinked-allowed.mjs'))
      expect(failures).not.toContainEqual(expect.stringContaining('unlinked-node-valid.mjs'))
      expect(failures).toContain(
        'packed dist/unlinked-node-invalid.mjs imports unknown Node builtin "node:definitely_not_a_real_builtin"',
      )
      expect(failures).toContainEqual(
        expect.stringMatching(/unlinked-duplicate\.mjs has module-link error TS2451/u),
      )
      expect(failures).toContainEqual(
        expect.stringMatching(/unlinked-with\.mjs has module-link error TS(?:1101|2410)/u),
      )
      expect(failures).toContainEqual(
        expect.stringMatching(/unlinked-export\.mjs has module-link error TS2300/u),
      )
      expect(failures).toContainEqual(
        expect.stringMatching(/unlinked-default\.mjs has module-link error TS2304/u),
      )
      expect(failures).toContainEqual(
        expect.stringMatching(/unlinked-default\.d\.ts has module-link error TS2304/u),
      )
      expect(failures).toContainEqual(
        expect.stringMatching(
          /\[packed declarations\] dist\/unlinked-declaration\.d\.ts has module-link error TS2305/u,
        ),
      )
      expect(failures).toContain(
        'packed dist/unlinked-declaration.d.ts has unresolved types reference path "./missing-reference"',
      )
      expect(failures).toContain(
        'packed dist/unlinked-declaration.d.ts has unknown TypeScript lib reference "definitely-not-a-real-lib"',
      )
      for (const path of [
        'unlinked-break.mjs',
        'unlinked-return.mjs',
        'unlinked-new-target.mjs',
        'unlinked-private.mjs',
        'unlinked-super.mjs',
      ]) {
        expect(failures).toContain(`packed dist/${path} is not valid Node ESM syntax`)
      }
      expect(failures).not.toContainEqual(expect.stringContaining('hidden-package'))
    } finally {
      rmSync(packageRoot, { recursive: true, force: true })
    }
  })
})
