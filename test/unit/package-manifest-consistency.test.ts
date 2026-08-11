import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getPackageCheckerProfile } from '../../scripts/package-check/entry-rules.mjs'
import { checkPackageJsonManifestConsistency } from '../../scripts/package-check/manifest-consistency.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const nuxtPackageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))
const nuxtProfile = getPackageCheckerProfile('nuxt')

function cloneNuxtManifest() {
  return structuredClone(nuxtPackageJson)
}

function copyBinTargets(artifactRoot: string, manifest: typeof nuxtPackageJson) {
  for (const target of Object.values(manifest.bin) as string[]) {
    const relativeTarget = target.replace(/^\.\//u, '')
    const destination = resolve(artifactRoot, relativeTarget)
    const source = resolve(
      repositoryRoot,
      'src/runtime/cli',
      basename(relativeTarget).replace(/\.js$/u, '.ts'),
    )
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
  }
}

describe('package manifest consistency', () => {
  let artifactRoot: string

  beforeEach(() => {
    artifactRoot = mkdtempSync(join(tmpdir(), 'bcn-package-manifest-'))
    copyBinTargets(artifactRoot, nuxtPackageJson)
  })

  afterEach(() => {
    rmSync(artifactRoot, { recursive: true, force: true })
  })

  function check(manifest = cloneNuxtManifest()) {
    return checkPackageJsonManifestConsistency({
      manifest,
      entries: nuxtProfile.entries,
      expectedBins: nuxtProfile.bins,
      artifactRoot,
    })
  }

  it('accepts the current reviewed Nuxt manifest', () => {
    expect(check()).toEqual([])
  })

  it('applies the same contract independently to a cloned packed-candidate manifest', () => {
    const sourceManifest = cloneNuxtManifest()
    const packedCandidateManifest = structuredClone(sourceManifest)
    packedCandidateManifest.exports['./server'].import = './dist/runtime/server/renamed.js'

    expect(check(sourceManifest)).toEqual([])
    expect(check(packedCandidateManifest)).toContain(
      'package.json exports["./server"].import must be "./dist/runtime/server/index.js" (manifest source of truth)',
    )
  })

  it('rejects extra and missing public entries', () => {
    const extra = cloneNuxtManifest()
    extra.exports['./unreviewed'] = {
      types: './dist/unreviewed.d.ts',
    }
    expect(check(extra)).toContain(
      'package.json exports contains undeclared manifest entry "./unreviewed"',
    )

    const missing = cloneNuxtManifest()
    delete missing.exports['./errors']
    expect(check(missing)).toContain('package.json exports is missing manifest entry "./errors"')
  })

  it('rejects JavaScript and declaration target drift', () => {
    const wrongJavaScript = cloneNuxtManifest()
    wrongJavaScript.exports['./server'].import = './dist/runtime/server/renamed.js'
    expect(check(wrongJavaScript)).toContain(
      'package.json exports["./server"].import must be "./dist/runtime/server/index.js" (manifest source of truth)',
    )

    const wrongDeclaration = cloneNuxtManifest()
    wrongDeclaration.exports['./server'].types = './dist/runtime/server/renamed.d.ts'
    expect(check(wrongDeclaration)).toContain(
      'package.json exports["./server"].types must be "./dist/runtime/server/index.d.ts" (manifest source of truth)',
    )
  })

  it('binds the legacy main entry to the reviewed root runtime', () => {
    const manifest = cloneNuxtManifest()
    manifest.main = './dist/unreviewed.mjs'

    expect(check(manifest)).toContain(
      'package.json main must be "./dist/module.mjs" (manifest source of truth)',
    )
  })

  it('requires the package-level ESM interpretation used by every runtime entry', () => {
    const manifest = cloneNuxtManifest()
    manifest.type = 'commonjs'

    expect(check(manifest)).toContain(
      'package.json type must be "module" for the reviewed ESM entry contract',
    )
  })

  it('rejects undeclared export conditions and runtime imports on types-only entries', () => {
    const extraCondition = cloneNuxtManifest()
    extraCondition.exports['./server'].default = './dist/runtime/server/index.js'
    expect(check(extraCondition)).toContain(
      'package.json exports["./server"] has undeclared condition "default"',
    )

    const typesOnlyImport = cloneNuxtManifest()
    typesOnlyImport.exports['./convex-auth/_generated/component.js'].import =
      './dist/runtime/convex-auth/component/_generated/component.js'
    expect(check(typesOnlyImport)).toContain(
      'package.json exports["./convex-auth/_generated/component.js"] is types-only and must not declare an import target',
    )
  })

  it('requires the reviewed condition order so types resolve before runtime imports', () => {
    const manifest = cloneNuxtManifest()
    const server = manifest.exports['./server']
    manifest.exports['./server'] = {
      import: server.import,
      types: server.types,
    }

    expect(check(manifest)).toContain(
      'package.json exports["./server"] conditions must be exactly ["types","import"] in that order',
    )
  })

  it('rejects missing and unmatched typesVersions entries', () => {
    const missing = cloneNuxtManifest()
    delete missing.typesVersions['*'].server
    expect(check(missing)).toContain(
      'typesVersions["*"] is missing an entry for exports subpath "server"',
    )

    const extra = cloneNuxtManifest()
    extra.typesVersions['*'].unreviewed = ['./dist/unreviewed.d.ts']
    expect(check(extra)).toContain(
      'typesVersions["*"]["unreviewed"] has no matching exports subpath',
    )
  })

  it('binds the exact typesVersions selector, target, and array shape', () => {
    const wrongTarget = cloneNuxtManifest()
    wrongTarget.typesVersions['*'].server = ['./dist/unreviewed.d.ts']
    expect(check(wrongTarget)).toContain(
      'typesVersions["*"]["server"] must be exactly ["./dist/runtime/server/index.d.ts"] (manifest source of truth)',
    )

    const wrongShape = cloneNuxtManifest()
    wrongShape.typesVersions['*'].server = './dist/runtime/server/index.d.ts'
    expect(check(wrongShape)).toContain(
      'typesVersions["*"]["server"] must be exactly ["./dist/runtime/server/index.d.ts"] (manifest source of truth)',
    )

    const extraSelector = cloneNuxtManifest()
    extraSelector.typesVersions['>=5.0'] = {
      server: ['./dist/unreviewed.d.ts'],
    }
    expect(check(extraSelector)).toContain(
      'package.json typesVersions must contain exactly the "*" selector',
    )
  })

  it('rejects export targets that are not covered by package files', () => {
    const manifest = cloneNuxtManifest()
    manifest.files = manifest.files.filter((entry: string) => entry !== 'dist')

    expect(check(manifest)).toContain(
      'package.json exports["."] target "./dist/types.d.mts" is not covered by "files": ["LICENSES","THIRD_PARTY_NOTICES.md","security/upstream-convex-better-auth.json"]',
    )
  })

  it('rejects bin targets that traverse outside the artifact root', () => {
    const manifest = cloneNuxtManifest()
    manifest.bin['better-convex-nuxt-convex'] = './dist/../../outside.js'

    expect(check(manifest)).toContain(
      'package.json bin["better-convex-nuxt-convex"] must point inside ./dist/: ./dist/../../outside.js',
    )
  })

  it('binds the exact reviewed command names and targets', () => {
    const extra = cloneNuxtManifest()
    extra.bin['unreviewed-public-cli'] = './dist/runtime/cli/convex.js'
    expect(check(extra)).toContain(
      'package.json bin contains undeclared command "unreviewed-public-cli"',
    )

    const missing = cloneNuxtManifest()
    delete missing.bin['better-convex-nuxt-auth-schema']
    expect(check(missing)).toContain(
      'package.json bin is missing reviewed command "better-convex-nuxt-auth-schema"',
    )

    const retargeted = cloneNuxtManifest()
    retargeted.bin['better-convex-nuxt-auth-schema'] = './dist/runtime/cli/convex.js'
    expect(check(retargeted)).toContain(
      'package.json bin["better-convex-nuxt-auth-schema"] must be "./dist/runtime/cli/auth-schema.js" (manifest source of truth)',
    )
  })
})
